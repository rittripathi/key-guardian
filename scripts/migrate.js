#!/usr/bin/env node
/**
 * Minimal migration runner: applies any .sql file in migrations/ that isn't
 * already recorded in the schema_migrations table, in filename order.
 * Equivalent in spirit to `alembic upgrade head`, without the extra
 * tooling/config Alembic needs.
 *
 * Usage: node scripts/migrate.js
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { settings } = require("../src/config");

async function main() {
  const clientConfig = { connectionString: settings.normalizedDatabaseUrl };
  if (settings.isNeon) {
    clientConfig.ssl = { require: true, rejectUnauthorized: false };
  }

  const client = new Client(clientConfig);
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(__dirname, "..", "migrations");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));

    let ranAny = false;
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;

      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      console.log(`applying ${file}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`  ok`);
        ranAny = true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }

    if (!ranAny) {
      console.log("nothing to do — database is up to date.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
