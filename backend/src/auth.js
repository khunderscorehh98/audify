import { readFileSync } from 'node:fs';
import { timingSafeEqual, createHash } from 'node:crypto';
import admin from 'firebase-admin';
import { HttpError } from './lib/http.js';

export function createFirebaseVerifier(config) {
  const serviceAccount = JSON.parse(readFileSync(config.firebase.serviceAccountPath, 'utf8'));
  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: config.firebase.projectId,
  });
  return { verifyIdToken: (token) => app.auth().verifyIdToken(token) };
}

/**
 * Local development only (config.js refuses this in production).
 * A token looks like `dev:<email>`.
 */
export function createDevVerifier() {
  return {
    async verifyIdToken(token) {
      if (!token.startsWith('dev:')) throw new Error('Invalid dev token');
      const email = token.slice(4).toLowerCase();
      return {
        uid: `dev-${email}`,
        email,
        email_verified: true,
        name: email.split('@')[0].replace(/^./, (c) => c.toUpperCase()),
      };
    },
  };
}

const bearerToken = (req) => {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

/**
 * Finds the users row for a verified token, creating it on first sign-in.
 * The admin bootstrap only runs while no admin exists (patch 1, B1).
 */
export async function findOrCreateUser(db, config, claims) {
  const [rows] = await db.query('SELECT * FROM users WHERE firebase_uid = ?', [claims.uid]);
  if (rows.length) return rows[0];

  const email = claims.email ? String(claims.email).toLowerCase() : null;
  const displayName = (claims.name || (email ? email.split('@')[0] : 'New user')).slice(0, 100);

  let role = 'member';
  let status = 'pending';
  if (config.adminBootstrapEmail && email === config.adminBootstrapEmail && claims.email_verified === true) {
    const [admins] = await db.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    if (!admins.length) {
      role = 'admin';
      status = 'approved';
    }
  }

  // INSERT IGNORE-style upsert: two tabs signing in at once must not 500.
  await db.query(
    `INSERT INTO users (firebase_uid, display_name, email, role, status, approved_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [claims.uid, displayName, email, role, status, status === 'approved' ? new Date() : null],
  );
  const [created] = await db.query('SELECT * FROM users WHERE firebase_uid = ?', [claims.uid]);
  return created[0];
}

/** Requires a valid Firebase token. Status is not checked here. */
export function authenticate({ db, config, verifier }) {
  return async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, 'Sign in required');
    let claims;
    try {
      claims = await verifier.verifyIdToken(token);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    req.user = await findOrCreateUser(db, config, claims);
    next();
  };
}

export const isActiveMember = (user) =>
  user.status === 'approved' && !user.is_deleted && !user.is_archived;

/** The 403 carries user_status so the app can wipe downloads when blocked. */
export function requireMember(req, _res, next) {
  if (isActiveMember(req.user)) return next();
  // Archived or deleted accounts lose access the same way a blocked one does.
  const status = req.user.is_deleted || req.user.is_archived ? 'blocked' : req.user.status;
  throw new HttpError(403, 'Your account does not have access', { user_status: status });
}

export function requireAdmin(req, _res, next) {
  if (isActiveMember(req.user) && req.user.role === 'admin') return next();
  throw new HttpError(403, 'Forbidden');
}

const digest = (value) => createHash('sha256').update(value).digest();

/** Processor routes: service token only, compared in constant time. */
export function requireServiceToken(config) {
  return (req, _res, next) => {
    const token = bearerToken(req);
    const expected = config.processorServiceToken;
    // Hashing gives equal-length buffers, as timingSafeEqual requires.
    if (!expected || !token || !timingSafeEqual(digest(token), digest(expected))) {
      throw new HttpError(401, 'Invalid service token');
    }
    next();
  };
}
