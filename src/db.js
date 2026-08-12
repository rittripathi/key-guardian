const { Sequelize } = require("sequelize");
const { settings } = require("./config");

const dialectOptions = {};
if (settings.isNeon) {

  dialectOptions.ssl = { require: true, rejectUnauthorized: false };
}

const sequelize = new Sequelize(settings.normalizedDatabaseUrl, {
  dialect: "postgres",
  logging: false,
  dialectOptions,
  pool: {
    max: 10, 
    min: 0,
    idle: 10000,
    acquire: 30000,
  },
});

module.exports = { sequelize };
