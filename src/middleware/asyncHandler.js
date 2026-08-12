/**
 * Express 4 doesn't forward rejected promises from async route handlers to
 * the error middleware automatically. Wrap every async handler with this so
 * a thrown/rejected error lands in next(err) instead of hanging the request.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
