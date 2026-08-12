/**
 * Mirrors FastAPI's HTTPException: a small error carrying a status code and
 * a user-facing detail message. Thrown (or passed to next()) from anywhere
 * in a route/middleware, it's turned into the right response by the central
 * error handler in app.js.
 */
class HttpError extends Error {
  constructor(statusCode, detail) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

module.exports = { HttpError };
