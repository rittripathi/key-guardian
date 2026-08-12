/**
 * Redis counters used for the zero-DB pre-checks on the proxy hot path.
 */
const Redis = require("ioredis");
const { settings } = require("./config");

let _redis = null;

function getRedis() {
  if (_redis === null) {
    _redis = new Redis(settings.redisUrl, {
      // Fail fast instead of buffering commands forever if Redis is down.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    _redis.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("redis error:", err.message);
    });
  }
  return _redis;
}

async function closeRedis() {
  if (_redis !== null) {
    await _redis.quit();
    _redis = null;
  }
}

function monthKey() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function rateKey(apiKeyId, window) {
  const bucket = Math.floor(Date.now() / 1000 / Math.max(window, 1));
  return `ks:rate:${apiKeyId}:${window}:${bucket}`;
}

function spendKey(apiKeyId) {
  return `ks:spend:${apiKeyId}:${monthKey()}`;
}

function authFailKey(apiKeyId) {
  return `ks:authfail:${apiKeyId}`;
}

async function peekRate(apiKeyId, window) {
  const value = await getRedis().get(rateKey(apiKeyId, window));
  return value ? parseInt(value, 10) : 0;
}

async function bumpRate(apiKeyId, window) {
  const r = getRedis();
  const key = rateKey(apiKeyId, window);
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, window + 5);
  }
  return count;
}

async function peekSpend(apiKeyId) {
  const value = await getRedis().get(spendKey(apiKeyId));
  return value !== null ? parseFloat(value) : null;
}

async function setSpend(apiKeyId, amount) {
  await getRedis().set(spendKey(apiKeyId), amount.toFixed(6), "EX", 60 * 60 * 24 * 40);
}

async function addSpend(apiKeyId, amount) {
  const r = getRedis();
  const key = spendKey(apiKeyId);
  const total = await r.incrbyfloat(key, amount);
  await r.expire(key, 60 * 60 * 24 * 40);
  return parseFloat(total);
}

async function bumpAuthFailures(apiKeyId) {
  const r = getRedis();
  const key = authFailKey(apiKeyId);
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, 600);
  }
  return count;
}

async function alertOnce(tag, ttl = 3600) {
  const result = await getRedis().set(`ks:alerted:${tag}`, "1", "EX", ttl, "NX");
  return result === "OK";
}

module.exports = {
  getRedis,
  closeRedis,
  monthKey,
  rateKey,
  spendKey,
  authFailKey,
  peekRate,
  bumpRate,
  peekSpend,
  setSpend,
  addSpend,
  bumpAuthFailures,
  alertOnce,
};
