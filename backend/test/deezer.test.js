import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDeezer, isDeezerImage, toDeezerMatch } from '../src/lib/deezer.js';

const item = {
  title: 'Cindai (Remastered)',
  title_short: 'Cindai',
  artist: { name: 'Siti Nurhaliza' },
  album: { id: 42, title: 'Cindai', cover_medium: 'https://e-cdns-images.dzcdn.net/m.jpg', cover_xl: 'https://e-cdns-images.dzcdn.net/xl.jpg' },
};

describe('Deezer matches', () => {
  it('maps a song and its album', () => {
    const match = toDeezerMatch(item, { release_date: '1997-05-01', genres: { data: [{ name: 'Pop' }] } });
    assert.equal(match.source, 'deezer');
    assert.equal(match.title, 'Cindai');
    assert.equal(match.year, 1997);
    assert.deepEqual(match.genres, ['Pop']);
    assert.deepEqual(match.cover, { type: 'deezer', url: item.album.cover_xl });
    assert.equal(match.recording_id, null);
  });

  it('only trusts covers from Deezer image servers', () => {
    assert.equal(isDeezerImage('https://e-cdns-images.dzcdn.net/a.jpg'), true);
    assert.equal(isDeezerImage('http://e-cdns-images.dzcdn.net/a.jpg'), false);
    assert.equal(isDeezerImage('https://evil.example/dzcdn.net/a.jpg'), false);
    assert.equal(isDeezerImage('https://dzcdn.net.evil.example/a.jpg'), false);
    assert.equal(toDeezerMatch({ ...item, album: { ...item.album, cover_xl: 'https://evil.example/x.jpg' } }).cover, null);
  });
});

describe('Deezer client', () => {
  it('falls back to a loose search, then adds each album', async () => {
    const asked = [];
    const client = createDeezer({
      fetchImpl: async (url) => {
        asked.push(new URL(url).pathname);
        if (url.includes('/album/')) return Response.json({ release_date: '1997-01-01', genres: { data: [] } });
        if (url.includes('artist%3A')) return Response.json({ data: [] });
        return Response.json({ data: [item] });
      },
    });
    const matches = await client.search('Cindai', 'Siti Nurhaliza');
    assert.deepEqual(asked, ['/search', '/search', '/album/42']);
    assert.equal(matches[0].year, 1997);
  });

  it('treats an error inside a 200 as unavailable', async () => {
    const client = createDeezer({ fetchImpl: async () => Response.json({ error: { code: 4, message: 'Quota limit exceeded' } }) });
    await assert.rejects(client.search('a', 'b'), (error) => error.status === 502);
  });

  it('refuses covers from anywhere else', async () => {
    const client = createDeezer({ fetchImpl: async () => Response.json({}) });
    await assert.rejects(client.cover('https://evil.example/x.jpg'), (error) => error.status === 400);
  });
});
