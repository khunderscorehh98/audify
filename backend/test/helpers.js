// Integration tests run against a real MySQL. Set TEST_DB_PORT and friends;
// see ../../README.md ("Running the tests").
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { createApp } from '../src/app.js';
import { createDevVerifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

const DB = 'audify_test';
const root = path.resolve(import.meta.dirname, '../../db');

export async function startTestApp(overrides = {}) {
  const base = {
    host: process.env.TEST_DB_HOST || '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || '',
    charset: 'utf8mb4',
    multipleStatements: true,
  };
  const admin = await mysql.createConnection(base);
  const load = (file) =>
    readFileSync(path.join(root, file), 'utf8').replaceAll('music_app', DB);
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(load('schema.sql'));
  for (const n of [1, 2, 3]) await admin.query(load(`patches/patch_${n}.sql`));
  await admin.end();

  const config = {
    ...loadConfig({
      AUTH_MODE: 'dev',
      ADMIN_BOOTSTRAP_EMAIL: 'owner@example.com',
      PROCESSOR_SERVICE_TOKEN: 'service-secret',
      RATE_LIMIT_PER_MINUTE: '100000',
      UNDO_WINDOW_SECONDS: '1',
      UNDO_GRACE_SECONDS: '0',
    }),
    ...overrides,
  };
  config.db = { host: base.host, port: base.port, user: base.user, password: base.password, database: DB };

  const db = createPool(config);
  const deleted = [];
  const storage = {
    presignGet: async (key) => `https://r2.test/${key}?sig=get`,
    presignPut: async (key) => `https://r2.test/${key}?sig=put`,
    exists: async () => true,
    deleteKey: async (key) => void deleted.push(key),
    deletePrefix: async (key) => {
      deleted.push(key);
      return true;
    },
  };
  const dispatched = [];
  const dispatcher = { uploadReady: async (id) => void dispatched.push(id) };
  const musicbrainz = {
    search: async () => [{ title: 'Found', artist: 'Someone' }],
    cover: async () => ({ type: 'image/jpeg', body: Buffer.from('jpeg') }),
    genres: async () => ['Indie pop'],
  };
  const deps = { db, config, verifier: createDevVerifier(), storage, dispatcher, musicbrainz };
  const app = createApp(deps);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, route, { as, token, body } = {}) => {
    const response = await fetch(url + route, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(as ? { authorization: `Bearer dev:${as}` } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  return {
    deps,
    db,
    call,
    deleted,
    dispatched,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    },
  };
}

export const OWNER = 'owner@example.com';
export const MEMBER = 'danial@example.com';
export const SERVICE = 'service-secret';

/** Signs in the owner and an approved member. */
export async function seedUsers(t) {
  await t.call('GET', '/me', { as: OWNER });
  const member = await t.call('GET', '/me', { as: MEMBER });
  await t.call('PATCH', `/admin/users/${member.body.id}`, { as: OWNER, body: { status: 'approved' } });
  return member.body.id;
}

let hashCounter = 0;
export const fakeHash = () => (++hashCounter).toString(16).padStart(64, '0');

/** Drives one upload through the processor routes to pending_approval. */
export async function processUpload(t, { title = 'Night Drive', artist = 'Coastline Radio', album = { title: 'Late Hours' }, recording = null, hash, as = MEMBER } = {}) {
  const created = await t.call('POST', '/uploads', {
    as,
    body: { filename: `${title}.flac`, size_bytes: 1000, content_type: 'audio/flac' },
  });
  const id = created.body.id;
  await t.call('POST', `/uploads/${id}/complete`, { as });
  await t.call('POST', `/internal/processor/uploads/${id}/claim`, { token: SERVICE });
  const source = await t.call('GET', `/internal/processor/uploads/${id}/source`, { token: SERVICE });
  const uuid = source.body.upload_uuid;
  const sha = hash ?? fakeHash();
  const hashed = await t.call('POST', `/internal/processor/uploads/${id}/hash`, { token: SERVICE, body: { sha256: sha } });
  if (hashed.body.duplicate) return { id, duplicate: true };
  const result = await t.call('POST', `/internal/processor/uploads/${id}/result`, {
    token: SERVICE,
    body: {
      track: { title, duration_ms: 222000, metadata_status: 'auto_matched', mb_recording_id: recording },
      artists: [{ name: artist }],
      album: album ? { ...album, cover_prefix: `artwork/${uuid}/` } : null,
      genres: ['Indie pop'],
      files: [
        { kind: 'original', r2_key: `tracks/${uuid}/original.flac`, mime_type: 'audio/flac', codec: 'flac', size_bytes: 1000, sha256: sha },
        { kind: 'opus', r2_key: `tracks/${uuid}/opus.webm`, mime_type: 'audio/webm', codec: 'opus', bitrate_kbps: 96, size_bytes: 100, sha256: fakeHash() },
        { kind: 'aac', r2_key: `tracks/${uuid}/aac.m4a`, mime_type: 'audio/mp4', codec: 'aac', bitrate_kbps: 128, size_bytes: 120, sha256: fakeHash() },
      ],
    },
  });
  return { id, uuid, trackId: result.body.track_id, resultStatus: result.status };
}

export async function publish(t, options) {
  const upload = await processUpload(t, options);
  await t.call('POST', `/admin/uploads/${upload.id}/approve`, { as: OWNER, body: {} });
  return upload;
}
