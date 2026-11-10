import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { createDevVerifier, createFirebaseVerifier } from './auth.js';
import { createDispatcher } from './dispatch.js';
import { createR2Storage } from './storage/r2.js';
import { createLocalStorage } from './storage/local.js';
import { startJobs } from './jobs.js';
import { createMusicBrainz } from './lib/musicbrainz.js';
import { createDeezer } from './lib/deezer.js';

const config = loadConfig();
const db = createPool(config);
const verifier = config.devMode ? createDevVerifier() : createFirebaseVerifier(config);
const storage = config.storageMode === 'local' ? createLocalStorage(config) : createR2Storage(config);
const dispatcher = createDispatcher(config);
const musicbrainz = createMusicBrainz({ contact: config.musicbrainzContact });
const deezer = createDeezer();
const deps = { db, config, verifier, storage, dispatcher, musicbrainz, deezer };

const app = createApp(deps);
if (config.jobsEnabled) startJobs(deps);

const server = app.listen(config.port, config.host, () => {
  console.log(`Audify API on ${config.host}:${config.port}${config.devMode ? ' (DEV MODE)' : ''}`);
  if (config.lan && config.devMode) {
    console.log('WARNING: anyone on this network can sign in as any email, including the admin.');
  }
});

const shutdown = () => {
  server.close(() => db.end().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
