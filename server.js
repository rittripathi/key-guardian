const { createApp } = require("./src/app");
const { settings } = require("./src/config");
const { sequelize } = require("./src/db");
const { closeRedis } = require("./src/cache");

async function main() {
  // Fail fast with a clear message if Postgres isn't reachable, rather than
  // starting up and having every request 500.
  await sequelize.authenticate();

  const app = createApp();
  const server = app.listen(settings.port, () => {
    console.log(`KeyShort listening on :${settings.port}`);
  });

  // Mirrors the FastAPI lifespan's shutdown: close the DB pool and Redis
  // cleanly instead of dropping connections mid-flight.
  async function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      try {
        await closeRedis();
        await sequelize.close();
      } finally {
        process.exit(0);
      }
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("failed to start:", err);
  process.exit(1);
});
