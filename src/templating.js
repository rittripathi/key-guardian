const path = require("path");
const nunjucks = require("nunjucks");
const { settings } = require("./config");

function money(value) {
  const num = value === null || value === undefined ? 0 : Number(value);
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function since(value) {
  if (!value) return "-";
  const then = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function configureTemplating(app) {
  const env = nunjucks.configure(path.join(__dirname, "..", "views"), {
    autoescape: true,
    express: app,
    watch: false,
  });

  env.addFilter("money", money);
  env.addFilter("since", since);
  env.addGlobal("base_url", settings.publicBaseUrl);

  return env;
}

module.exports = { configureTemplating, money, since };
