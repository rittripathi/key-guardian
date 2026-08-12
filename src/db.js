const { Sequelize } = require("sequelize");
const { settings } = require("./config");

const dialectOptions = {};
if (settings.isNeon) {
  // Neon requires TLS; rejectUnauthorized:false mirrors the "ssl: True" the
  // Python service passed to asyncpg (Neon's cert chain isn't always in the
  // default trust store on small containers).
  dialectOptions.ssl = { require: true, rejectUnauthorized: false };
}

const sequelize = new Sequelize(settings.normalizedDatabaseUrl, {
  dialect: "postgres",
  logging: false,
  dialectOptions,
  pool: {
    max: 10, // pool_size(5) + max_overflow(5) from the Python config
    min: 0,
    idle: 10000,
    acquire: 30000,
  },
});

module.exports = { sequelize };
