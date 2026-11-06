import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authenticate, isActiveMember } from './auth.js';
import { errorHandler, HttpError } from './lib/http.js';
import { PLAYABLE } from './lib/tracks.js';
import { memberRouter } from './routes/member.js';
import { adminRouter } from './routes/admin.js';
import { internalRouter } from './routes/internal.js';

const publicUser = (user) => ({
  id: user.id,
  display_name: user.display_name,
  email: user.email,
  role: user.role,
  status: user.is_deleted || user.is_archived ? 'blocked' : user.status,
});

/** Everything is injected, so tests can swap auth, storage and dispatch. */
export function createApp(deps) {
  const { db, config, storage } = deps;
  const app = express();

  app.set('trust proxy', 'loopback'); // Patch 1, B7
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  if (storage.devRouter) app.use('/dev-storage', storage.devRouter);

  app.use(cors({ origin: config.corsOrigins }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path.startsWith('/internal/'),
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Service token only; a user token never gets past this router.
  app.use('/internal/processor', internalRouter(deps));

  const auth = authenticate(deps);

  // /me works for any status so the app can show pending or blocked screens.
  app.get('/me', auth, async (req, res) => {
    const user = publicUser(req.user);
    if (req.user.role === 'admin' && isActiveMember(req.user)) {
      const [[counts]] = await db.query(
        `SELECT (SELECT COUNT(*) FROM uploads WHERE status = 'pending_approval') AS uploads,
                (SELECT COUNT(*) FROM users WHERE status = 'pending' AND is_deleted = 0 AND is_archived = 0) AS users`,
      );
      user.pending = counts;
    }
    res.json(user);
  });

  // Patch 2 §3: the one member route that doesn't require `approved`, so a
  // blocked phone can still learn it must wipe its downloads.
  app.post('/offline/check', auth, async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
      throw new HttpError(400, 'ids must be a list of up to 5000 song IDs');
    }
    const status = publicUser(req.user).status;
    if (!isActiveMember(req.user)) return res.json({ remove: ids, user_status: status });
    if (!ids.length) return res.json({ remove: [], user_status: status });

    const [rows] = await db.query(`SELECT t.id FROM tracks t WHERE t.id IN (?) AND ${PLAYABLE}`, [ids]);
    const playable = new Set(rows.map((row) => row.id));
    res.json({ remove: ids.filter((id) => !playable.has(id)), user_status: status });
  });

  app.use('/admin', auth, adminRouter(deps));
  app.use('/', auth, memberRouter(deps));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
