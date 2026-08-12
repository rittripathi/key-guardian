const express = require("express");
const { Op } = require("sequelize");
const { settings } = require("../config");
const { ApiKey, KeyLimit, KeyUsage, Alert } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const { HttpError } = require("../httpError");
const { PROVIDERS, authHeaders, probePath, resolveBaseUrl } = require("../providers");
const { decryptSecret, encryptSecret, hashSecret } = require("../security");
const { cachedSpend } = require("../usage");
const cache = require("../cache");

const router = express.Router();

const ALIAS_RE = /^[a-zA-Z0-9_-]{2,32}$/;

async function ownedKey(user, alias) {
  const key = await ApiKey.findOne({ where: { userId: user.id, alias } });
  if (!key) throw new HttpError(404, "Alias not found");
  return key;
}

async function nextAlias() {
  // Aliases are globally unique (the proxy route has no user context to
  // scope by), so the suggestion has to avoid every alias in the system,
  // not just this user's.
  const rows = await ApiKey.findAll({ attributes: ["alias"], raw: true });
  const used = new Set();
  for (const { alias } of rows) {
    const m = /^key(\d+)$/.exec(alias);
    if (m) used.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `key${n}`;
}

async function keyView(key) {
  const limit = await KeyLimit.findOne({ where: { apiKeyId: key.id } });
  const spend = await cachedSpend(key.id);

  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  const requestsToday = await KeyUsage.count({
    where: { apiKeyId: key.id, createdAt: { [Op.gte]: todayStart } },
  });

  const rateUsed =
    limit && limit.rateLimit ? await cache.peekRate(key.id, limit.rateWindowSeconds) : 0;

  return {
    key,
    limit,
    spend,
    spend_pct:
      limit && limit.spendCapUsd
        ? Math.min(100, Math.floor((spend / limit.spendCapUsd) * 100))
        : 0,
    rate_used: rateUsed,
    rate_pct:
      limit && limit.rateLimit ? Math.min(100, Math.floor((rateUsed / limit.rateLimit) * 100)) : 0,
    requests_today: requestsToday || 0,
  };
}

// ---------------- dashboard ----------------

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.user) return res.redirect(303, "/login");

    const keys = await ApiKey.findAll({
      where: { userId: req.user.id },
      order: [["id", "ASC"]],
    });

    const active = [];
    const revoked = [];
    for (const k of keys) {
      const view = await keyView(k);
      (k.active ? active : revoked).push(view);
    }

    const unread = await Alert.count({ where: { userId: req.user.id, read: false } });

    res.render("dashboard.html", {
      user: req.user,
      active_keys: active,
      revoked_keys: revoked,
      unread: unread || 0,
    });
  })
);

// ---------------- create ----------------

router.get(
  "/keys/new",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.render("key_new.html", {
      user: req.user,
      providers: PROVIDERS,
      suggested_alias: await nextAlias(),
      created: null,
      error: null,
    });
  })
);

router.post(
  "/keys/new",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body;
    const provider = body.provider || "openai";
    const label = body.label || "";
    const baseUrl = body.base_url || "";
    const passphrase = body.passphrase || "";
    const rateLimit = parseInt(body.rate_limit, 10) || 0;
    const rateWindowSeconds = parseInt(body.rate_window_seconds, 10) || 60;
    const spendCapUsd = parseFloat(body.spend_cap_usd) || 0.0;
    const mode = body.mode || "block";

    let alias = (body.alias || "").trim() || (await nextAlias());
    const secret = (body.secret || "").trim();

    let error = null;
    if (!ALIAS_RE.test(alias)) {
      error = "Alias must be 2-32 characters: letters, numbers, dashes or underscores.";
    } else if (await ApiKey.findOne({ where: { alias } })) {
      error = `The alias '${alias}' is already taken. Aliases are global, try another.`;
    } else if (!secret) {
      error = "Paste the provider API key.";
    } else if (provider === "custom" && !baseUrl.trim()) {
      error = "A custom provider needs a base URL.";
    }

    if (error) {
      return res.status(400).render("key_new.html", {
        user: req.user,
        providers: PROVIDERS,
        suggested_alias: alias,
        created: null,
        error,
      });
    }

    const key = await ApiKey.create({
      userId: req.user.id,
      alias,
      label: label.trim(),
      provider,
      baseUrl: baseUrl.trim(),
      secretCiphertext: encryptSecret(secret),
      secretLast4: secret.slice(-4),
      passphraseHash: passphrase.trim() ? await hashSecret(passphrase.trim()) : null,
      active: true,
    });

    await KeyLimit.create({
      apiKeyId: key.id,
      rateLimit: Math.max(0, rateLimit),
      rateWindowSeconds: Math.max(1, rateWindowSeconds),
      rateMode: mode,
      spendCapUsd: Math.max(0.0, spendCapUsd),
      spendMode: mode,
    });

    res.render("key_new.html", {
      user: req.user,
      providers: PROVIDERS,
      suggested_alias: await nextAlias(),
      created: key,
      has_passphrase: Boolean(passphrase.trim()),
      error: null,
    });
  })
);

// ---------------- test connection ----------------

router.post(
  "/api/keys/:alias/test",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    if (!key.active) {
      res.set("Content-Type", "text/html");
      return res.send(
        '<span class="badge badge-bad">Revoked &mdash; re-activate this alias first</span>'
      );
    }

    const base = resolveBaseUrl(key.provider, key.baseUrl);
    const url = `${base}${probePath(key.provider)}`;
    const headers = authHeaders(key.provider, decryptSecret(key.secretCiphertext));

    const started = Date.now();
    let response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        response = await fetch(url, { method: "GET", headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      res.set("Content-Type", "text/html");
      return res.send(
        `<span class="badge badge-bad">Could not reach provider &mdash; ${err.constructor.name}</span>`
      );
    }

    const ms = Date.now() - started;
    const responseText = await response.text();

    await KeyUsage.create({
      apiKeyId: key.id,
      path: probePath(key.provider),
      model: "",
      statusCode: response.status,
      costUsd: 0.0,
      latencyMs: ms,
      isTest: true,
      clientIp: "dashboard",
    });

    res.set("Content-Type", "text/html");
    if (response.status < 400) {
      return res.send(
        `<span class="badge badge-good">Success &mdash; provider responded ` +
          `${response.status} in ${ms}ms</span>`
      );
    }

    const detail = responseText.slice(0, 180).replace(/</g, "&lt;");
    return res.send(
      `<span class="badge badge-bad">Provider returned ${response.status}</span>` +
        `<pre class="probe-error">${detail}</pre>`
    );
  })
);

// ---------------- detail / settings ----------------

router.get(
  "/keys/:alias",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    const view = await keyView(key);

    const recent = await KeyUsage.findAll({
      where: { apiKeyId: key.id },
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    const keyAlerts = await Alert.findAll({
      where: { apiKeyId: key.id },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    res.render("key_detail.html", {
      user: req.user,
      view,
      recent,
      alerts: keyAlerts,
      providers: PROVIDERS,
    });
  })
);

router.post(
  "/keys/:alias/limits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    const body = req.body;

    let limit = await KeyLimit.findOne({ where: { apiKeyId: key.id } });
    if (!limit) {
      limit = await KeyLimit.create({ apiKeyId: key.id });
    }

    limit.rateLimit = Math.max(0, parseInt(body.rate_limit, 10) || 0);
    limit.rateWindowSeconds = Math.max(1, parseInt(body.rate_window_seconds, 10) || 60);
    limit.rateMode = body.rate_mode || "block";
    limit.spendCapUsd = Math.max(0.0, parseFloat(body.spend_cap_usd) || 0.0);
    limit.spendMode = body.spend_mode || "block";
    await limit.save();

    res.redirect(303, `/keys/${key.alias}`);
  })
);

router.post(
  "/keys/:alias/passphrase",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    const passphrase = (req.body.passphrase || "").trim();
    key.passphraseHash = passphrase ? await hashSecret(passphrase) : null;
    await key.save();
    res.redirect(303, `/keys/${key.alias}`);
  })
);

router.post(
  "/keys/:alias/rename",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    const newAlias = (req.body.new_alias || "").trim();
    const label = req.body.label || "";

    if (ALIAS_RE.test(newAlias)) {
      const clash = await ApiKey.findOne({
        where: { alias: newAlias, id: { [Op.ne]: key.id } },
      });
      if (!clash) {
        key.alias = newAlias;
      }
    }
    key.label = label.trim();
    await key.save();

    res.redirect(303, `/keys/${key.alias}`);
  })
);

// ---------------- soft delete ----------------

router.post(
  "/keys/:alias/revoke",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Soft delete only: flip the flag, keep every usage row and alert.
    const key = await ownedKey(req.user, req.params.alias);
    key.active = false;
    key.revokedAt = new Date();
    await key.save();
    res.redirect(303, "/");
  })
);

router.post(
  "/keys/:alias/activate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    key.active = true;
    key.revokedAt = null;
    await key.save();
    res.redirect(303, `/keys/${key.alias}`);
  })
);

router.post(
  "/keys/:alias/rotate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    const secret = (req.body.secret || "").trim();
    if (secret) {
      key.secretCiphertext = encryptSecret(secret);
      key.secretLast4 = secret.slice(-4);
      await key.save();
    }
    res.redirect(303, `/keys/${key.alias}`);
  })
);

router.get(
  "/keys/:alias/curl",
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = await ownedKey(req.user, req.params.alias);
    const base = settings.publicBaseUrl.replace(/\/+$/, "");
    const token = key.passphraseHash ? `${key.alias}<passphrase>` : key.alias;
    res.set("Content-Type", "text/html");
    res.send(
      `curl ${base}/proxy/${key.alias}/v1/chat/completions ` + `-H "Authorization: Bearer ${token}"`
    );
  })
);

module.exports = router;
