#!/usr/bin/env node
/**
 * Run every 10 minutes as a Render Cron Job.
 *
 * 1. Pings /healthz so the free web service never spins down.
 * 2. Reconciles Redis's cached monthly spend against the authoritative
 *    Postgres rows for every key, so any drift (evicted Redis keys, a
 *    Redis restart, etc.) self-heals instead of accumulating.
 */
const { settings } = require("../src/config");
const cache = require("../src/cache");
const { ApiKey } = require("../src/models");
const { monthSpendFromDb } = require("../src/usage");
const { sequelize } = require("../src/db");

async function pingHealth() {
  const url = settings.publicBaseUrl.replace(/\/+$/, "") + "/healthz";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      console.log(`healthz -> ${resp.status}`);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`healthz ping failed: ${err.message}`);
  }
}

async function reconcileSpend() {
  const keys = await ApiKey.findAll({ attributes: ["id"], raw: true });
  for (const { id } of keys) {
    const total = await monthSpendFromDb(id);
    await cache.setSpend(id, total);
  }
  console.log(`reconciled spend for ${keys.length} keys`);
}

async function main() {
  await pingHealth();
  await reconcileSpend();
  await cache.closeRedis();
  await sequelize.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
