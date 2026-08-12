
const express = require("express");
const cache = require("../cache");
const pricing = require("../pricing");
const { KeyUsage } = require("../models");
const { notify } = require("../notify");
const { authHeaders, resolveBaseUrl } = require("../providers");
const { decryptSecret, verifySecret } = require("../security");
const { cachedSpend, loadKeyByAlias, loadLimit, precheck } = require("../usage");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

const MAX_CAPTURE = 512 * 1024;

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "authorization",
  "x-api-key",
  "cookie",
]);

const RESPONSE_HEADER_SKIP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function splitToken(raw) {
  let token = (raw || "").trim();
  if (token.toLowerCase().startsWith("bearer ")) {
    token = token.slice(7).trim();
  }
  return token;
}

async function recordUsage({
  apiKeyId,
  userId,
  alias,
  path,
  statusCode,
  body,
  latencyMs,
  clientIp,
  isTest = false,
}) {
  /* Runs after the response is fully delivered. Never touches the client's latency. */
  try {
    const [model, promptTokens, completionTokens] = pricing.parseUsage(body);
    const cost = isTest
      ? 0.0
      : pricing.estimateCost(model, promptTokens, completionTokens, statusCode);

    await KeyUsage.create({
      apiKeyId,
      path: path.slice(0, 255),
      model: model.slice(0, 120),
      statusCode,
      promptTokens,
      completionTokens,
      costUsd: cost,
      latencyMs,
      isTest,
      clientIp: clientIp.slice(0, 64),
    });

    const limit = await loadLimit(apiKeyId);

    if (limit && limit.rateLimit > 0) {
      const used = await cache.bumpRate(apiKeyId, limit.rateWindowSeconds);
      if (used > limit.rateLimit && (await cache.alertOnce(`rate:${apiKeyId}`, 900))) {
        await notify({
          userId,
          apiKeyId,
          kind: "rate_spike",
          severity: "warning",
          message:
            `Alias <b>${alias}</b> exceeded its rate limit ` +
            `(${used}/${limit.rateLimit} per ${limit.rateWindowSeconds}s).`,
        });
      }
    }

    if (cost > 0) {
      const total = await cache.addSpend(apiKeyId, cost);
      if (limit && limit.spendCapUsd > 0) {
        const ratio = total / limit.spendCapUsd;
        if (ratio >= 1.0 && (await cache.alertOnce(`spend100:${apiKeyId}`, 86400))) {
          await notify({
            userId,
            apiKeyId,
            kind: "spend_100",
            severity: "critical",
            message:
              `Alias <b>${alias}</b> hit its $${limit.spendCapUsd.toFixed(2)} ` +
              `monthly cap ($${total.toFixed(2)} spent). ` +
              (limit.spendMode === "block"
                ? "Further calls are blocked."
                : "Notify-only mode."),
          });
        } else if (ratio >= 0.8 && (await cache.alertOnce(`spend80:${apiKeyId}`, 86400))) {
          await notify({
            userId,
            apiKeyId,
            kind: "spend_80",
            severity: "warning",
            message:
              `Alias <b>${alias}</b> is at ${(ratio * 100).toFixed(0)}% of its ` +
              `$${limit.spendCapUsd.toFixed(2)} monthly cap ($${total.toFixed(2)}).`,
          });
        }
      }
    }
  } catch (err) {
    // accounting must never surface to the caller
    console.error("usage accounting failed:", err);
  }
}

async function reportAuthFailure(apiKeyId, userId, alias) {
  const count = await cache.bumpAuthFailures(apiKeyId);
  if (count >= 5 && (await cache.alertOnce(`authfail:${apiKeyId}`, 1800))) {
    await notify({
      userId,
      apiKeyId,
      kind: "auth_failures",
      severity: "critical",
      message:
        `${count} failed passphrase attempts on alias <b>${alias}</b> ` +
        "in the last 10 minutes. The alias may be leaked.",
    });
  }
}

async function forward(req, res, key, upstreamPath, body, { isTest = false } = {}) {
  const baseUrl = resolveBaseUrl(key.provider, key.baseUrl);
  if (!baseUrl) {
    return res
      .status(500)
      .json({ error: { message: `Alias '${key.alias}' has no base URL configured.` } });
  }

  const url = new URL(`${baseUrl}/${upstreamPath.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(req.query)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.append(k, v);
    }
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === "string") {
      headers[k] = v;
    }
  }
  Object.assign(headers, authHeaders(key.provider, decryptSecret(key.secretCiphertext)));
  delete headers["accept-encoding"];

  const started = Date.now();
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  // Mirrors the Python service's shared httpx.AsyncClient timeout profile:
  // 10s to establish the connection and get a response, then up to 600s of
  // *inactivity* between chunks while streaming (reset on every chunk, so a
  // slow-but-steady completion isn't killed but a stalled one is).
  const CONNECT_TIMEOUT_MS = 10_000;
  const READ_TIMEOUT_MS = 600_000;
  const controller = new AbortController();
  let watchdog = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(watchdog);
    const reason = err.name === "AbortError" ? "Upstream connection timed out." : `Upstream request failed: ${err.message}`;
    return res.status(502).json({ error: { message: reason } });
  }

  res.status(upstream.status);
  for (const [k, v] of upstream.headers.entries()) {
    if (!RESPONSE_HEADER_SKIP.has(k.toLowerCase())) {
      res.setHeader(k, v);
    }
  }

  const captured = [];
  let capturedLen = 0;

  try {
    if (upstream.body) {
      const reader = upstream.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
        const { done, value } = await reader.read();
        if (done) break;
        if (capturedLen < MAX_CAPTURE) {
          const remaining = MAX_CAPTURE - capturedLen;
          const slice = value.length > remaining ? value.subarray(0, remaining) : value;
          captured.push(Buffer.from(slice));
          capturedLen += slice.length;
        }
        res.write(Buffer.from(value));
      }
    }
  } catch (err) {
    // Headers (and possibly some body) already went to the client — too
    // late to change the status code. End the connection; whatever we
    // captured so far still gets recorded below for accounting.
  } finally {
    clearTimeout(watchdog);
  }
  res.end();

  const latencyMs = Date.now() - started;
  // Fire-and-forget: runs after the response has been sent, never delays the client.
  recordUsage({
    apiKeyId: key.id,
    userId: key.userId,
    alias: key.alias,
    path: upstreamPath,
    statusCode: upstream.status,
    body: Buffer.concat(captured),
    latencyMs,
    clientIp,
    isTest,
  }).catch((err) => console.error("usage accounting failed:", err));

  return undefined;
}

router.get(
  "/proxy/:alias/status",
  asyncHandler(async (req, res) => {
    const key = await loadKeyByAlias(req.params.alias);
    if (!key) {
      return res.status(404).json({ error: { message: "Unknown alias." } });
    }
    const limit = await loadLimit(key.id);
    res.json({
      alias: key.alias,
      active: key.active,
      provider: key.provider,
      spend_this_month: Math.round((await cachedSpend(key.id)) * 10000) / 10000,
      spend_cap_usd: limit ? limit.spendCapUsd : 0,
      rate_limit: limit ? limit.rateLimit : 0,
    });
  })
);

const proxyHandler = asyncHandler(async (req, res) => {
    const upstreamPath = req.params[0] || "";
    const token = splitToken(req.headers.authorization || req.headers["x-api-key"] || "");

    // 1. Resolve the alias. The path segment wins; the token may carry alias+passphrase.
    const key = await loadKeyByAlias(req.params.alias);
    if (!key) {
      return res.status(404).json({ error: { message: `Unknown alias '${req.params.alias}'.` } });
    }

    // 2. Soft delete: revoked keys stop here, history stays intact.
    if (!key.active) {
      return res
        .status(403)
        .json({ error: { message: `Alias '${req.params.alias}' has been revoked.` } });
    }

    // 3. Optional passphrase: caller must send "<alias><passphrase>" as the token.
    if (key.passphraseHash) {
      if (!token.startsWith(key.alias)) {
        await reportAuthFailure(key.id, key.userId, key.alias);
        return res.status(401).json({
          error: { message: "This alias requires a passphrase: send '<alias><passphrase>'." },
        });
      }
      const supplied = token.slice(key.alias.length);
      if (!supplied || !(await verifySecret(key.passphraseHash, supplied))) {
        await reportAuthFailure(key.id, key.userId, key.alias);
        return res.status(401).json({ error: { message: "Invalid passphrase for this alias." } });
      }
    }

    // 4 + 5. Redis-only pre-checks.
    const limit = await loadLimit(key.id);
    const denied = await precheck(key, limit);
    if (denied) {
      return res
        .status(denied.statusCode)
        .json({ error: { message: denied.reason, type: "keyshort_limit" } });
    }

    return forward(req, res, key, upstreamPath, req.body);
});

router
  .route("/proxy/:alias/*")
  .get(proxyHandler)
  .post(proxyHandler)
  .put(proxyHandler)
  .patch(proxyHandler)
  .delete(proxyHandler);

module.exports = router;

