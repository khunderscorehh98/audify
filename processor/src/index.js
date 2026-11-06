// Entry point for GitHub Actions and local runs.
//   node src/index.js          every waiting upload (nightly and manual runs)
//   node src/index.js 42       one upload (repository_dispatch)
import { createApi } from './api.js';
import { createLookups } from './metadata.js';
import { processUpload } from './pipeline.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
};

// `npm run process` loads backend/.env.development, so locally the API is known.
if (process.env.NODE_ENV === 'development' && !process.env.API_BASE_URL) {
  process.env.API_BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
}

const api = createApi({
  baseUrl: required('API_BASE_URL').replace(/\/$/, ''),
  token: required('PROCESSOR_SERVICE_TOKEN'),
});
const lookup = createLookups({
  acoustIdKey: process.env.ACOUSTID_API_KEY,
  contact: process.env.MUSICBRAINZ_CONTACT,
});

const arg = process.argv[2];
if (arg !== undefined && !/^\d+$/.test(arg)) {
  console.error('Upload ID must be a number');
  process.exit(1);
}

const ids = arg ? [Number(arg)] : (await api.pending()).ids;
console.log(`processing ${ids.length} upload(s)`);
for (const id of ids) {
  await processUpload(id, { api, lookup });
}
