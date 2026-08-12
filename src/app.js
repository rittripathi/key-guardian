const express = require("express");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const { configureTemplating } = require("./templating");
const { currentUserOptional } = require("./middleware/auth");
const { HttpError } = require("./httpError");

const healthRouter = require("./routes/health");
const proxyRouter = require("./routes/proxy");
const authRouter = require("./routes/auth");
const keysRouter = require("./routes/keys");
const alertsRouter = require("./routes/alerts");

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(morgan("dev"));

  configureTemplating(app);

  // Health check first: no auth, no body parsing needed.
  app.use(healthRouter);

  // The proxy hot path needs the exact raw request bytes (any content
  // type, any size within reason) to forward upstream untouched — so it
  // gets its own raw-body parser, scoped to /proxy only. If this ran
  // globally it would drain the request stream before express.urlencoded()/
  // express.json() below ever got a chance to parse dashboard form posts.
  // The proxy path also skips currentUserOptional: aliases authenticate
  // themselves, there's no dashboard session on this path.
  app.use("/proxy", express.raw({ type: () => true, limit: "20mb" }));
  app.use(proxyRouter);

  // Dashboard + auth routes: standard HTML form bodies, cookies, sessions.
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(currentUserOptional);

  app.use(authRouter);
  app.use(keysRouter);
  app.use(alertsRouter);

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith("/proxy") || req.path.startsWith("/api")) {
      return res.json({ error: { message: "Not found" } });
    }
    return res.render("error.html", { status_code: 404, detail: "Not found", user: req.user || null });
  });

  // Central error handler — mirrors main.py's HTTPException handler:
  // 401 outside /proxy and /api redirects to the login page; /proxy and
  // /api errors are always JSON; everything else renders error.html.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const statusCode = err instanceof HttpError ? err.statusCode : err.statusCode || 500;
    const detail = err instanceof HttpError ? err.detail : "Something went wrong.";

    if (!(err instanceof HttpError)) {
      console.error(err);
    }

    if (statusCode === 401 && !req.path.startsWith("/proxy") && !req.path.startsWith("/api")) {
      return res.redirect(303, "/login");
    }

    if (req.path.startsWith("/proxy") || req.path.startsWith("/api")) {
      return res.status(statusCode).json({ error: { message: detail } });
    }

    return res.status(statusCode).render("error.html", {
      status_code: statusCode,
      detail,
      user: req.user || null,
    });
  });

  return app;
}

module.exports = { createApp };
