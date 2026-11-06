import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermanentError, RetryableError, toFailure } from '../src/errors.js';
import { needsFlacRendition, normaliseCodec, renditionPlan } from '../src/media.js';
import { buildLabels, createLookups, pickRelease, rateLimiter } from '../src/metadata.js';
import { processUpload } from '../src/pipeline.js';

const tags = { title: null, artist: null, artists: [], album: null, year: null, trackNumber: null, discNumber: null, genres: [], picture: null };

describe('renditions', () => {
  it('never makes FLAC from a lossy source or a second copy of FLAC', () => {
    const kinds = (format) => renditionPlan(format).map((item) => item.kind);
    assert.deepEqual(kinds({ codec: 'mp3', lossless: false }), ['opus', 'aac']);
    assert.deepEqual(kinds({ codec: 'flac', lossless: true }), ['opus', 'aac']);
    assert.deepEqual(kinds({ codec: 'alac', lossless: true }), ['opus', 'aac', 'flac']);
    assert.deepEqual(kinds({ codec: 'pcm', lossless: true }), ['opus', 'aac', 'flac']);
    assert.equal(needsFlacRendition({ codec: 'aac', lossless: false }), false);
  });

  it('strips tags and art from streaming copies, as specified', () => {
    const [opus, aac] = renditionPlan({ codec: 'mp3', lossless: false });
    assert.ok(opus.args.join(' ').includes('-vn -map_metadata -1 -c:a libopus -b:a 96k -vbr on'));
    assert.ok(aac.args.join(' ').includes('-movflags +faststart'));
  });

  it('normalises codec names', () => {
    assert.equal(normaliseCodec({ codec: 'MPEG 1 Layer 3', container: 'MPEG' }), 'mp3');
    assert.equal(normaliseCodec({ codec: 'FLAC', container: 'FLAC' }), 'flac');
    assert.equal(normaliseCodec({ codec: 'ALAC', container: 'M4A/mp42' }), 'alac');
    assert.equal(normaliseCodec({ codec: 'PCM', container: 'WAVE' }), 'pcm');
    assert.equal(normaliseCodec({ codec: 'MPEG-4/AAC', container: 'M4A' }), 'aac');
  });
});

describe('failures', () => {
  it('sorts errors and hides unknown messages', () => {
    assert.deepEqual(toFailure(new PermanentError('Not audio')), { error: 'Not audio', retryable: false });
    assert.deepEqual(toFailure(new RetryableError('R2 timeout')), { error: 'R2 timeout', retryable: true });
    const leaky = toFailure(new Error('https://r2.example/secret?sig=abc my song.mp3'));
    assert.equal(leaky.error, 'Unexpected processing error');
  });
});

describe('labels', () => {
  it('falls back to tags, then the filename, flagged for review', () => {
    const labels = buildLabels({ tags, filename: 'my_song-final.mp3', durationMs: 1000, found: { match: null } });
    assert.equal(labels.track.title, 'my song final');
    assert.equal(labels.artists[0].name, 'Unknown artist');
    assert.equal(labels.track.metadata_status, 'needs_review');
    assert.equal(labels.album, null);
  });

  it('uses MusicBrainz data and flags low scores', () => {
    const found = {
      match: {
        score: 0.62,
        acoustidId: 'a',
        recordingId: 'r',
        details: {
          title: 'Northbound',
          'artist-credit': [{ artist: { id: 'x', name: 'Lumen Park', 'sort-name': 'Lumen Park' } }],
          genres: [{ name: 'indie pop' }],
        },
        release: {
          id: 'rel',
          title: 'Late Hours',
          date: '2021-03',
          media: [{ position: 1, tracks: [{ position: 7, recording: { id: 'r' } }] }],
        },
      },
    };
    const labels = buildLabels({ tags, filename: 'x', durationMs: 1000, found });
    assert.equal(labels.track.metadata_status, 'needs_review');
    assert.equal(labels.track.track_number, 7);
    assert.equal(labels.album.release_date, '2021-03-01');
    assert.equal(labels.artists[0].mb_artist_id, 'x');
  });

  it('prefers official albums over compilations', () => {
    const chosen = pickRelease([
      { id: 'comp', status: 'Official', 'release-group': { 'primary-type': 'Album', 'secondary-types': ['Compilation'] } },
      { id: 'album', status: 'Official', 'release-group': { 'primary-type': 'Album' } },
      { id: 'boot', status: 'Bootleg' },
    ]);
    assert.equal(chosen.id, 'album');
  });
});

describe('external services', () => {
  it('spaces MusicBrainz calls a second apart', async () => {
    const waits = [];
    const turn = rateLimiter(1, async (ms) => void waits.push(ms));
    await turn();
    await turn();
    await turn();
    assert.equal(waits.length, 2);
    assert.ok(waits[0] > 900 && waits[1] > 1900);
  });

  it('reports an outage instead of throwing, so the upload still finishes', async () => {
    const lookup = createLookups({
      acoustIdKey: 'key',
      contact: 'me',
      fpcalc: 'definitely-not-installed',
      sleep: async () => {},
    });
    assert.deepEqual(await lookup('file'), { match: null, outage: true });
  });

  it('skips lookups without an AcoustID key', async () => {
    const lookup = createLookups({ contact: 'me' });
    assert.deepEqual(await lookup('file'), { match: null, outage: false });
  });
});

describe('pipeline order and reporting', () => {
  const fakeTools = (overrides = {}) => ({
    downloadTo: async () => {},
    sha256File: async () => 'a'.repeat(64),
    inspect: async () => ({
      format: { codec: 'mp3', lossless: false, durationMs: 1000 },
      tags: { ...tags, title: 'Song', artist: 'Artist' },
    }),
    renditionPlan: () => [],
    encode: async () => {},
    renderArtwork: async () => [],
    ...overrides,
  });

  const fakeApi = (overrides = {}) => {
    const calls = [];
    const record = (name, value) => async (...args) => {
      calls.push([name, ...args]);
      return typeof value === 'function' ? value(...args) : value;
    };
    return {
      calls,
      claim: record('claim', { status: 200, data: {} }),
      source: record('source', { url: 'u', original_filename: 'a.mp3' }),
      hash: record('hash', { duplicate: false }),
      albumLookup: record('albumLookup', { has_cover: false }),
      presign: record('presign', { urls: {}, artwork_prefix: 'artwork/x/' }),
      result: record('result', {}),
      fail: record('fail', {}),
      ...overrides,
    };
  };

  it('stops at a held claim', async () => {
    const api = fakeApi({ claim: async () => ({ status: 409, data: { reason: 'held' } }) });
    const outcome = await processUpload(1, { api, lookup: async () => ({}), tools: fakeTools(), log: () => {} });
    assert.equal(outcome, 'skipped');
  });

  it('stops at a duplicate without converting anything', async () => {
    let encoded = false;
    const api = fakeApi({ hash: async () => ({ duplicate: true }) });
    const tools = fakeTools({ encode: async () => (encoded = true) });
    const outcome = await processUpload(1, { api, lookup: async () => ({}), tools, log: () => {} });
    assert.equal(outcome, 'duplicate');
    assert.equal(encoded, false);
  });

  it('reports a corrupt file as permanent', async () => {
    const api = fakeApi();
    const tools = fakeTools({
      inspect: async () => {
        throw new PermanentError('File could not be read as audio');
      },
    });
    await processUpload(1, { api, lookup: async () => ({}), tools, log: () => {} });
    assert.deepEqual(api.calls.find(([name]) => name === 'fail')[2], {
      error: 'File could not be read as audio',
      retryable: false,
    });
  });

  it('logs nothing but IDs', async () => {
    const lines = [];
    const api = fakeApi();
    const tools = fakeTools({
      renditionPlan: () => [],
      inspect: async () => {
        throw new Error('secret-song.mp3 at https://r2/?sig=abc');
      },
    });
    await processUpload(7, { api, lookup: async () => ({}), tools, log: (line) => lines.push(line) });
    assert.ok(lines.every((line) => !/secret|sig=|https/.test(line)));
  });
});
