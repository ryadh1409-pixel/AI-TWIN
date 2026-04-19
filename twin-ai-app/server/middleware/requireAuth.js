/**
 * Shared Firebase ID-token auth middleware for the Twin AI Express app.
 *
 * Usage:
 *   const { requireAuth, enforceUserId } = require('./middleware/requireAuth');
 *   app.post('/chat', requireAuth, enforceUserId, handler);
 *
 * Behavior:
 * - requireAuth:
 *     1. Expects an `Authorization: Bearer <Firebase ID token>` header.
 *     2. Verifies the token with firebase-admin. On success, sets
 *        `req.auth = { uid, email, token: decoded }`.
 *     3. On failure, responds 401 with a generic error (no internals leaked).
 *
 * - enforceUserId:
 *     Requires requireAuth to have run first.
 *     If the request carries a `userId` (body/query/params), it MUST match
 *     `req.auth.uid`. Otherwise it injects `req.body.userId = req.auth.uid`
 *     so downstream handlers stay compatible with the existing contract.
 *
 *     This closes the impersonation hole where any client could pass an
 *     arbitrary `userId` and read/write another user's memory.
 */

const { getAdmin } = require('../../../server/agent/firebase');

const AUTH_REQUIRED =
  String(process.env.AUTH_REQUIRED || 'true').toLowerCase() !== 'false';
const TRUSTED_DEV_USER =
  process.env.TRUSTED_DEV_USER_ID || 'local-user';

function extractBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof h !== 'string') return null;
  if (!h.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  return token || null;
}

async function requireAuth(req, res, next) {
  // Dev escape hatch: explicitly opt-out with AUTH_REQUIRED=false.
  // Never set this in production.
  if (!AUTH_REQUIRED) {
    req.auth = { uid: TRUSTED_DEV_USER, email: null, token: null };
    return next();
  }

  const admin = getAdmin();
  if (!admin) {
    console.error('[auth] firebase-admin not initialized — rejecting request.');
    return res.status(503).json({ error: 'Auth service unavailable.' });
  }

  const token = extractBearer(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: 'Missing Authorization header (Bearer ID token).' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded?.uid) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    req.auth = {
      uid: decoded.uid,
      email: decoded.email || null,
      token: decoded,
    };
    return next();
  } catch (err) {
    // Log full detail server-side; never echo to client.
    console.warn('[auth] verifyIdToken failed:', err?.message || err);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Ensures the effective userId === req.auth.uid.
 * - If body/query/params contain a `userId`, it must match. Mismatch => 403.
 * - Otherwise the uid is written into `req.body.userId` for handlers that
 *   pull userId from the body (e.g. `getUserId(req.body?.userId)`).
 */
function enforceUserId(req, res, next) {
  if (!req.auth?.uid) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const uid = req.auth.uid;

  const claimed =
    req.body?.userId ??
    req.query?.userId ??
    req.params?.userId ??
    null;

  if (claimed != null && String(claimed).trim() && String(claimed) !== uid) {
    console.warn(
      `[auth] userId mismatch: claimed=${String(claimed).slice(0, 32)} auth=${uid}`,
    );
    return res.status(403).json({ error: 'userId does not match auth.' });
  }

  // Ensure downstream `getUserId(req.body?.userId)` resolves to the auth uid.
  if (!req.body) req.body = {};
  req.body.userId = uid;
  return next();
}

module.exports = { requireAuth, enforceUserId };
