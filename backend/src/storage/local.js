// Local development stand-in for R2, used only with AUTH_MODE=dev.
// "Presigned" URLs point at /dev-storage on this server, which is mounted
// only in dev mode and supports PUT and Range GET like R2 does.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import express from 'express';

const MIME = {
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
};

export function createLocalStorage(config) {
  const root = path.resolve(config.localStorageDir);
  const secret = randomBytes(16);
  const sign = (key, op, expires) =>
    createHmac('sha256', secret).update(`${op}:${key}:${expires}`).digest('hex');

  const resolveKey = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Bad key');
    return full;
  };
  const url = (key, op, seconds) => {
    const expires = Math.floor(Date.now() / 1000) + seconds;
    const query = new URLSearchParams({ op, expires, sig: sign(key, op, expires) });
    return `${config.publicBaseUrl}/dev-storage/${key}?${query}`;
  };
  const verified = (key, op, expires, sig) => {
    if (op === undefined || Number(expires) < Date.now() / 1000) return false;
    const expected = Buffer.from(sign(key, op, expires));
    const given = Buffer.from(String(sig));
    return expected.length === given.length && timingSafeEqual(expected, given);
  };

  const router = express.Router();
  router.use(async (req, res) => {
    const key = decodeURIComponent(req.path.slice(1));
    const { op, expires, sig } = req.query;
    if (config.corsOrigins.includes(req.get('origin'))) res.set('Access-Control-Allow-Origin', req.get('origin'));
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT');
    res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);

    const expectedOp = req.method === 'PUT' ? 'put' : 'get';
    if (op !== expectedOp || !verified(key, op, expires, sig)) return res.sendStatus(403);
    const full = resolveKey(key);

    if (req.method === 'PUT') {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await pipeline(req, createWriteStream(full));
      return res.sendStatus(200);
    }

    const stat = await fs.stat(full).catch(() => null);
    if (!stat) return res.sendStatus(404);
    res.set('Content-Type', MIME[path.extname(full)] || 'application/octet-stream');
    res.set('Accept-Ranges', 'bytes');
    const range = /bytes=(\d*)-(\d*)/.exec(req.get('range') || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(stat.size - Number(range[2]), 0);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.set('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD') return res.end();
      return pipeline(createReadStream(full, { start, end }), res);
    }
    res.set('Content-Length', String(stat.size));
    if (req.method === 'HEAD') return res.end();
    return pipeline(createReadStream(full), res);
  });

  return {
    devRouter: router,
    presignGet: async (key, seconds = config.presignGetSeconds) => url(key, 'get', seconds),
    presignPut: async (key, _contentType, seconds = config.presignPutSeconds) => url(key, 'put', seconds),
    exists: async (key) => Boolean(await fs.stat(resolveKey(key)).catch(() => null)),
    async deleteKey(key) {
      const full = resolveKey(key);
      await fs.rm(full, { force: true });
      // R2 has no folders; this removes the song's folder once it's empty.
      await fs.rmdir(path.dirname(full)).catch(() => {});
    },
    async deletePrefix(prefix) {
      await fs.rm(path.resolve(root, prefix), { recursive: true, force: true });
      return true;
    },
  };
}
