import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestRelease, createMusicBrainz, searchTerm, toMatches } from '../src/lib/musicbrainz.js';

const recording = (overrides = {}) => ({
  id: 'rec-1',
  score: 100,
  title: 'Northbound',
  'artist-credit': [{ name: 'Lumen Park', artist: { id: 'art-1', name: 'Lumen Park' } }],
  releases: [{ id: 'rel-1', title: 'Late Hours', date: '2021-03-01', status: 'Official', 'release-group': { 'primary-type': 'Album' } }],
  tags: [{ name: 'rock', count: 1 }, { name: 'indie pop', count: 5 }],
  ...overrides,
});

describe('MusicBrainz matches', () => {
  it('maps a recording to what the form needs', () => {
    assert.deepEqual(toMatches({ recordings: [recording()] }), [
      {
        recording_id: 'rec-1',
        title: 'Northbound',
        artist: 'Lumen Park',
        artist_id: 'art-1',
        album: 'Late Hours',
        release_id: 'rel-1',
        year: 2021,
        genres: ['Indie pop', 'Rock'],
      },
    ]);
  });

  it('drops weak matches and repeats', () => {
    const matches = toMatches({
      recordings: [recording(), recording({ id: 'rec-2' }), recording({ id: 'rec-3', score: 40, title: 'Other' })],
    });
    assert.equal(matches.length, 1);
  });

  it('copes with a recording that has no release or tags', () => {
    const [match] = toMatches({ recordings: [recording({ releases: undefined, tags: undefined })] });
    assert.deepEqual([match.album, match.release_id, match.year, match.genres], ['', null, null, []]);
  });

  it('copes with an empty response', () => {
    assert.deepEqual(toMatches({}), []);
    assert.deepEqual(toMatches(null), []);
  });

  it('prefers the official album', () => {
    const chosen = bestRelease([
      { id: 'comp', status: 'Official', 'release-group': { 'primary-type': 'Album', 'secondary-types': ['Compilation'] } },
      { id: 'album', status: 'Official', 'release-group': { 'primary-type': 'Album' } },
      { id: 'boot', status: 'Bootleg' },
    ]);
    assert.equal(chosen.id, 'album');
  });

  it('escapes search input', () => {
    assert.equal(searchTerm('a"b\\c'), '"a\\"b\\\\c"');
  });
});

describe('MusicBrainz client', () => {
  it('identifies itself and sends both fields', async () => {
    let seen;
    const client = createMusicBrainz({
      contact: 'me@example.com',
      fetchImpl: async (url, options) => {
        seen = { url: new URL(url), headers: options.headers };
        return Response.json({ recordings: [] });
      },
    });
    await client.search('Northbound', 'Lumen Park');
    assert.equal(seen.url.searchParams.get('query'), 'recording:"Northbound" AND artist:"Lumen Park"');
    assert.match(seen.headers['User-Agent'], /me@example\.com/);
  });

  it('looks for genres on the song, then the album, then the artist', async () => {
    const asked = [];
    const client = createMusicBrainz({
      fetchImpl: async (url) => {
        asked.push(new URL(url).pathname.split('/')[3]);
        if (url.includes('/recording/')) return Response.json({ genres: [] });
        if (url.includes('/release/')) return new Response('', { status: 404 });
        return Response.json({ genres: [{ name: 'malay pop', count: 2 }, { name: 'rock', count: 9 }] });
      },
    });
    const genres = await client.genres({ recordingId: 'r', releaseId: 'a', artistId: 'b' });
    assert.deepEqual(asked, ['recording', 'release', 'artist']);
    assert.deepEqual(genres, ['Rock', 'Malay pop']);
  });

  it('stops at the first source with genres', async () => {
    let calls = 0;
    const client = createMusicBrainz({
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ genres: [{ name: 'jazz', count: 1 }] });
      },
    });
    assert.deepEqual(await client.genres({ recordingId: 'r', artistId: 'b' }), ['Jazz']);
    assert.equal(calls, 1);
  });

  it('turns outages into a clear error', async () => {
    const client = createMusicBrainz({ fetchImpl: async () => new Response('', { status: 503 }) });
    await assert.rejects(client.search('a', 'b'), (error) => error.status === 502);
  });

  it('treats a missing cover as no cover', async () => {
    const client = createMusicBrainz({ fetchImpl: async () => new Response('', { status: 404 }) });
    assert.equal(await client.cover('rel-1'), null);
  });

  it('refuses a cover that is not an image', async () => {
    const client = createMusicBrainz({
      fetchImpl: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    });
    await assert.rejects(client.cover('rel-1'), (error) => error.status === 502);
  });
});
