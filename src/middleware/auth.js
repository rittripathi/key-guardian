const { settings } = require("../config");
const { User } = require("../models");
const { readSession } = require("../security");
const { HttpError } = require("../httpError");

/**
 * Attaches req.user (a User instance or null). Never rejects — use
 * requireAuth after this if the route needs a signed-in user.
 */
async function currentUserOptional(req, res, next) {
  try {
    const token = req.cookies ? req.cookies[settings.sessionCookie] : null;
    if (!token) {
      req.user = null;
      return next();
    }
    const userId = readSession(token);
    if (userId === null) {
      req.user = null;
      return next();
    }
    req.user = await User.findByPk(userId);
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Requires currentUserOptional to have run first. Raises 401 (which the
 * central error handler turns into a redirect to /login for HTML routes,
 * or a JSON 401 for /proxy and /api routes) when nobody is signed in.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new HttpError(401, "Not signed in"));
  }
  return next();
}

async function getUserByEmail(email) {
  return User.findOne({ where: { email: email.toLowerCase().trim() } });
}

module.exports = { currentUserOptional, requireAuth, getUserByEmail };
