
class HttpError extends Error {
  constructor(statusCode, detail) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

module.exports = { HttpError };
