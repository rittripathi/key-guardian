
const { Op } = require("sequelize");
const cache = require("./cache");
const { ApiKey, KeyLimit, KeyUsage } = require("./models");

class Denied {
  constructor(statusCode, reason) {
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

async function monthSpendFromDb(apiKeyId) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const total = await KeyUsage.sum("costUsd", {
    where: { apiKeyId, createdAt: { [Op.gte]: start } },
  });
  return total || 0.0;
}

async function cachedSpend(apiKeyId) {
  const value = await cache.peekSpend(apiKeyId);
  if (value !== null) return value;
  const total = await monthSpendFromDb(apiKeyId);
  await cache.setSpend(apiKeyId, total);
  return total;
}

async function loadKeyByAlias(alias) {
  return ApiKey.findOne({ where: { alias }, order: [["id", "ASC"]] });
}

async function loadLimit(apiKeyId) {
  return KeyLimit.findOne({ where: { apiKeyId } });
}

async function precheck(key, limit) {
  if (!limit) return null;

  if (limit.rateLimit > 0 && limit.rateMode === "block") {
    const used = await cache.peekRate(key.id, limit.rateWindowSeconds);
    if (used >= limit.rateLimit) {
      return new Denied(
        429,
        `Rate limit reached for '${key.alias}': ` +
          `${limit.rateLimit} requests / ${limit.rateWindowSeconds}s.`
      );
    }
  }

  if (limit.spendCapUsd > 0 && limit.spendMode === "block") {
    const spent = await cachedSpend(key.id);
    if (spent >= limit.spendCapUsd) {
      return new Denied(
        402,
        `Monthly spend cap reached for '${key.alias}': ` +
          `$${spent.toFixed(2)} of $${limit.spendCapUsd.toFixed(2)}.`
      );
    }
  }

  return null;
}

module.exports = {
  Denied,
  monthSpendFromDb,
  cachedSpend,
  loadKeyByAlias,
  loadLimit,
  precheck,
};
