import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { toBooleanQuery } from '../src/lib/search.js';
import { loadConfig } from '../src/config.js';
import { drainCleanupQueue, purgeAbandoned, purgeRejected } from '../src/jobs.js';
import { MEMBER, OWNER, SERVICE, processUpload, publish, seedUsers, startTestApp } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('search query builder', () => {
  it('splits safely and keeps other scripts whole', () => {
    assert.equal(toBooleanQuery('coast'), '+coast*');
    assert.equal(toBooleanQuery('Harbour & Pine'), '+Harbour* +Pine*');
    assert.equal(toBooleanQuery('AC/DC'), '+AC* +DC*');
    assert.equal(toBooleanQuery('+-<>()~*"@'), '');
    assert.equal(toBooleanQuery('गाना'), '+गाना*');
    assert.equal(toBooleanQuery('เพลงรัก'), '+เพลงรัก*');
  });
});

describe('config', () => {
  it('refuses dev auth in production', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev' }), /not allowed/);
  });
});

describe('Audify API', () => {
  let t;
  before(async () => {
    t = await startTestApp();
  });
  after(async () => t.stop());
  beforeEach(async () => {
    t.deleted.length = 0;
    await t.db.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['r2_cleanup_queue', 'play_history', 'liked_tracks', 'playlist_tracks', 'playlists', 'uploads', 'track_files', 'track_genres', 'genres', 'track_artists', 'album_artists', 'tracks', 'albums', 'artists', 'users']) {
      await t.db.query(`DELETE FROM ${table}`);
    }
    await t.db.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  describe('users and access', () => {
    it('bootstraps only the first admin', async () => {
      const owner = await t.call('GET', '/me', { as: OWNER });
      assert.equal(owner.body.role, 'admin');
      assert.equal(owner.body.status, 'approved');
      await t.db.query('UPDATE users SET firebase_uid = ?', ['other']);
      const second = await t.call('GET', '/me', { as: OWNER });
      assert.equal(second.body.role, 'member');
      assert.equal(second.body.status, 'pending');
    });

    it('makes the owner admin once their email is verified', async () => {
      await t.db.query("INSERT INTO users (firebase_uid, display_name, email) VALUES ('dev-owner@example.com', 'Owner', 'owner@example.com')");
      const owner = await t.call('GET', '/me', { as: OWNER });
      assert.deepEqual([owner.body.role, owner.body.status], ['admin', 'approved']);
    });

    it('never upgrades someone else, or a blocked owner', async () => {
      await t.call('GET', '/me', { as: OWNER });
      const other = await t.call('GET', '/me', { as: 'new@example.com' });
      assert.equal(other.body.role, 'member');
      await t.db.query("UPDATE users SET role = 'member', status = 'blocked' WHERE email = 'owner@example.com'");
      const blocked = await t.call('GET', '/me', { as: OWNER });
      assert.equal(blocked.body.status, 'blocked');
    });

    it('new users are pending and locked out', async () => {
      const me = await t.call('GET', '/me', { as: 'new@example.com' });
      assert.equal(me.body.status, 'pending');
      const search = await t.call('GET', '/search?q=x', { as: 'new@example.com' });
      assert.equal(search.status, 403);
      assert.equal(search.body.user_status, 'pending');
    });

    it('rejects missing and bad tokens', async () => {
      assert.equal((await t.call('GET', '/me')).status, 401);
      assert.equal((await t.call('GET', '/me', { token: 'nonsense' })).status, 401);
    });

    it('members get 403 on /admin, and the two token types never cross', async () => {
      await seedUsers(t);
      assert.equal((await t.call('GET', '/admin/summary', { as: MEMBER })).status, 403);
      assert.equal((await t.call('GET', '/admin/summary', { token: SERVICE })).status, 401);
      assert.equal((await t.call('GET', '/internal/processor/uploads/pending', { as: OWNER })).status, 401);
      assert.equal((await t.call('GET', '/internal/processor/uploads/pending', { token: SERVICE })).status, 200);
    });

    it('the admin cannot archive, block or delete their own account', async () => {
      await seedUsers(t);
      const { body: me } = await t.call('GET', '/me', { as: OWNER });
      assert.equal((await t.call('POST', `/admin/users/${me.id}/archive`, { as: OWNER })).status, 403);
      assert.equal((await t.call('PATCH', `/admin/users/${me.id}`, { as: OWNER, body: { status: 'blocked' } })).status, 403);
      assert.equal((await t.call('DELETE', `/admin/users/${me.id}`, { as: OWNER })).status, 403);
    });
  });

  describe('upload pipeline', () => {
    beforeEach(async () => seedUsers(t));

    it('runs from upload to live', async () => {
      const upload = await processUpload(t);
      assert.equal(upload.resultStatus, 201);
      assert.equal(t.dispatched.at(-1), upload.id);

      let list = await t.call('GET', '/tracks', { as: MEMBER });
      assert.equal(list.body.total, 0, 'unpublished songs stay hidden');
      assert.equal((await t.call('GET', `/tracks/${upload.trackId}/stream`, { as: MEMBER })).status, 404);

      const preview = await t.call('GET', `/admin/tracks/${upload.trackId}/preview`, { as: OWNER });
      assert.equal(preview.status, 200);

      const queue = await t.call('GET', '/admin/uploads', { as: OWNER });
      assert.equal(queue.body.items.length, 1);
      await t.call('POST', `/admin/uploads/${upload.id}/approve`, { as: OWNER, body: { title: 'Night Drive (Edit)', genres: ['Rock'] } });

      list = await t.call('GET', '/tracks', { as: MEMBER });
      assert.equal(list.body.total, 1);
      assert.equal(list.body.items[0].title, 'Night Drive (Edit)');
      assert.ok(list.body.items[0].album.cover[96].includes(`artwork/${upload.uuid}/96.jpg`));

      const stream = await t.call('GET', `/tracks/${upload.trackId}/stream?format=opus`, { as: MEMBER });
      assert.ok(stream.body.url.includes('opus.webm'));
      const mine = await t.call('GET', '/uploads/mine', { as: MEMBER });
      assert.equal(mine.body.items[0].status, 'approved');
    });

    it('a FLAC original serves as the lossless stream; others return 404', async () => {
      const flac = await publish(t);
      const stream = await t.call('GET', `/tracks/${flac.trackId}/stream?format=flac`, { as: MEMBER });
      assert.ok(stream.body.url.includes('original.flac'));
      await t.db.query("UPDATE track_files SET codec = 'mp3' WHERE kind = 'original'");
      assert.equal((await t.call('GET', `/tracks/${flac.trackId}/stream?format=flac`, { as: MEMBER })).status, 404);
    });

    it('detects duplicate originals and offers restore', async () => {
      const first = await publish(t, { hash: 'a'.repeat(64) });
      await t.call('POST', `/admin/tracks/${first.trackId}/archive`, { as: OWNER });

      const second = await processUpload(t, { title: 'Same file', hash: 'a'.repeat(64) });
      assert.equal(second.duplicate, true);
      const [[row]] = await t.db.query('SELECT status, duplicate_of_track_id FROM uploads WHERE id = ?', [second.id]);
      assert.equal(row.status, 'duplicate');
      assert.equal(row.duplicate_of_track_id, first.trackId);

      const queue = await t.call('GET', '/admin/uploads?status=duplicate', { as: OWNER });
      assert.equal(queue.body.items[0].duplicate_of.can_restore, true);

      await t.call('POST', `/admin/uploads/${second.id}/restore-existing`, { as: OWNER });
      assert.equal((await t.call('GET', '/tracks', { as: MEMBER })).body.total, 1);
    });

    it('allows the same recording twice and flags it', async () => {
      const recording = '11111111-1111-1111-1111-111111111111';
      await publish(t, { recording });
      const second = await processUpload(t, { title: 'Night Drive MP3', recording });
      assert.equal(second.resultStatus, 201);
      const { body } = await t.call('GET', `/admin/uploads/${second.id}`, { as: OWNER });
      assert.equal(body.possible_duplicate_of, 'Night Drive');
    });

    it('allows identical renditions on two tracks', async () => {
      const a = await publish(t, { title: 'A' });
      const b = await publish(t, { title: 'B' });
      await t.db.query("UPDATE track_files SET sha256 = ? WHERE kind = 'opus' AND track_id IN (?)", ['f'.repeat(64), [a.trackId, b.trackId]]);
    });

    it('cancels an upload and removes its file', async () => {
      const { body } = await t.call('POST', '/uploads', { as: MEMBER, body: { filename: 'a.mp3', size_bytes: 10 } });
      assert.equal((await t.call('DELETE', `/uploads/${body.id}`, { as: OWNER })).status, 404, "not someone else's upload");
      assert.equal((await t.call('DELETE', `/uploads/${body.id}`, { as: MEMBER })).status, 204);
      assert.equal((await t.call('GET', '/uploads/mine', { as: MEMBER })).body.items.length, 0);
      await drainCleanupQueue(t.deps);
      assert.equal(t.deleted.length, 1);
    });

    it('can still cancel while waiting for processing, but not after', async () => {
      const { body } = await t.call('POST', '/uploads', { as: MEMBER, body: { filename: 'a.mp3', size_bytes: 10 } });
      await t.call('POST', `/uploads/${body.id}/complete`, { as: MEMBER });
      await t.call('POST', `/internal/processor/uploads/${body.id}/claim`, { token: SERVICE });
      assert.equal((await t.call('DELETE', `/uploads/${body.id}`, { as: MEMBER })).status, 409);
      const second = await t.call('POST', '/uploads', { as: MEMBER, body: { filename: 'b.mp3', size_bytes: 10 } });
      await t.call('POST', `/uploads/${second.body.id}/complete`, { as: MEMBER });
      assert.equal((await t.call('DELETE', `/uploads/${second.body.id}`, { as: MEMBER })).status, 204);
    });

    it('rejects /result writing outside its own prefix', async () => {
      const created = await t.call('POST', '/uploads', { as: MEMBER, body: { filename: 'x.mp3', size_bytes: 10 } });
      const id = created.body.id;
      await t.call('POST', `/uploads/${id}/complete`, { as: MEMBER });
      await t.call('POST', `/internal/processor/uploads/${id}/claim`, { token: SERVICE });
      const result = await t.call('POST', `/internal/processor/uploads/${id}/result`, {
        token: SERVICE,
        body: {
          track: { title: 'x', duration_ms: 1000 },
          artists: [{ name: 'x' }],
          files: [{ kind: 'original', r2_key: 'tracks/someone-else/original.mp3', mime_type: 'audio/mpeg', codec: 'mp3', size_bytes: 1, sha256: 'b'.repeat(64) }],
        },
      });
      assert.equal(result.status, 400);
    });
  });

  describe('claiming', () => {
    let id;
    beforeEach(async () => {
      await seedUsers(t);
      const created = await t.call('POST', '/uploads', { as: MEMBER, body: { filename: 'a.mp3', size_bytes: 10 } });
      id = created.body.id;
      await t.call('POST', `/uploads/${id}/complete`, { as: MEMBER });
    });
    const claim = () => t.call('POST', `/internal/processor/uploads/${id}/claim`, { token: SERVICE });

    it('gives distinct answers', async () => {
      assert.equal((await claim()).status, 200);
      const held = await claim();
      assert.equal(held.status, 409);
      assert.equal(held.body.reason, 'held');
      await t.db.query("UPDATE uploads SET status = 'approved' WHERE id = ?", [id]);
      assert.equal((await claim()).body.reason, 'not_claimable');
    });

    it('reclaims a crashed run, then gives up', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await claim()).status, 200);
        await t.db.query('UPDATE uploads SET claimed_at = UTC_TIMESTAMP() - INTERVAL 31 MINUTE WHERE id = ?', [id]);
      }
      const pending = await t.call('GET', '/internal/processor/uploads/pending', { token: SERVICE });
      assert.deepEqual(pending.body.ids, [id]);
      assert.equal((await claim()).body.reason, 'exhausted');
      const [[row]] = await t.db.query('SELECT status FROM uploads WHERE id = ?', [id]);
      assert.equal(row.status, 'failed');
    });

    it('retryable failures go back in the queue; permanent ones stop', async () => {
      await claim();
      const retry = await t.call('POST', `/internal/processor/uploads/${id}/fail`, { token: SERVICE, body: { error: 'R2 timeout', retryable: true } });
      assert.equal(retry.body.status, 'uploaded');
      await claim();
      const stop = await t.call('POST', `/internal/processor/uploads/${id}/fail`, { token: SERVICE, body: { error: 'Not audio', retryable: false } });
      assert.equal(stop.body.status, 'failed');

      const failed = await t.call('GET', '/admin/uploads?status=failed', { as: OWNER });
      assert.equal(failed.body.items[0].error_message, 'Not audio');
      await t.call('POST', `/admin/uploads/${id}/retry`, { as: OWNER });
      const [[row]] = await t.db.query('SELECT status, attempts FROM uploads WHERE id = ?', [id]);
      assert.deepEqual([row.status, row.attempts], ['uploaded', 0]);
    });

    it('dismiss removes a failed upload and all its files, and only then', async () => {
      assert.equal((await t.call('POST', `/admin/uploads/${id}/dismiss`, { as: OWNER })).status, 409);
      await claim();
      await t.call('POST', `/internal/processor/uploads/${id}/fail`, { token: SERVICE, body: { error: 'x', retryable: false } });
      assert.equal((await t.call('POST', `/admin/uploads/${id}/dismiss`, { as: OWNER })).status, 204);
      await drainCleanupQueue(t.deps);
      assert.equal(t.deleted.length, 3);
      assert.equal((await t.call('GET', '/uploads/mine', { as: MEMBER })).body.items.length, 0);
    });
  });

  describe('approve, reject, undo', () => {
    beforeEach(async () => seedUsers(t));

    it('undo returns a rejected upload to the queue', async () => {
      const upload = await processUpload(t);
      await t.call('POST', `/admin/uploads/${upload.id}/reject`, { as: OWNER });
      assert.equal((await t.call('GET', '/uploads/mine', { as: MEMBER })).body.items.length, 0);
      assert.equal((await t.call('POST', `/admin/uploads/${upload.id}/undo`, { as: OWNER })).status, 200);
      await sleep(1100);
      await purgeRejected(t.deps);
      const queue = await t.call('GET', '/admin/uploads', { as: OWNER });
      assert.equal(queue.body.items.length, 1);
    });

    it('undo after approve takes the song back down', async () => {
      const upload = await publish(t);
      await t.call('POST', `/admin/uploads/${upload.id}/undo`, { as: OWNER });
      assert.equal((await t.call('GET', '/tracks', { as: MEMBER })).body.total, 0);
    });

    it('undo is refused after the window, and the rejected upload disappears', async () => {
      const upload = await processUpload(t);
      await t.call('POST', `/admin/uploads/${upload.id}/reject`, { as: OWNER });
      await sleep(2100);
      assert.equal((await t.call('POST', `/admin/uploads/${upload.id}/undo`, { as: OWNER })).status, 409);
      await purgeRejected(t.deps);
      await drainCleanupQueue(t.deps);
      const [rows] = await t.db.query('SELECT id FROM uploads');
      assert.equal(rows.length, 0);
      const [artists] = await t.db.query('SELECT id FROM artists');
      assert.equal(artists.length, 0, 'orphan artist removed');
      assert.ok(t.deleted.includes(`artwork/${upload.uuid}/`));
    });

    it('rejecting one upload keeps the album another pending upload uses', async () => {
      const first = await processUpload(t, { title: 'A', album: { title: 'Shared' } });
      const second = await processUpload(t, { title: 'B', album: { title: 'Shared' } });
      await t.call('POST', `/admin/uploads/${first.id}/reject`, { as: OWNER });
      await sleep(1100);
      await purgeRejected(t.deps);
      await drainCleanupQueue(t.deps);

      const [[album]] = await t.db.query('SELECT cover_r2_key FROM albums');
      assert.equal(album.cover_r2_key, `artwork/${first.uuid}/`);
      assert.ok(!t.deleted.includes(`artwork/${first.uuid}/`), 'shared cover is not deleted');
      assert.ok(t.deleted.includes(`artwork/${second.uuid}/`), 'the second upload lost the race');
    });

    it('approval restores a hidden album and says so on the card', async () => {
      const first = await publish(t, { title: 'A' });
      await t.call('POST', `/admin/tracks/${first.trackId}/archive`, { as: OWNER });
      const [[album]] = await t.db.query('SELECT id FROM albums');
      assert.equal((await t.call('POST', `/admin/albums/${album.id}/archive`, { as: OWNER })).status, 204);

      const second = await processUpload(t, { title: 'B' });
      const card = await t.call('GET', `/admin/uploads/${second.id}`, { as: OWNER });
      assert.deepEqual(card.body.will_restore, ['Late Hours']);

      await t.call('POST', `/admin/uploads/${second.id}/approve`, { as: OWNER, body: {} });
      assert.equal((await t.call('GET', `/albums/${album.id}`, { as: MEMBER })).status, 200);
    });
  });

  describe('autocomplete', () => {
    const recording = '22222222-2222-2222-2222-222222222222';
    const release = '33333333-3333-3333-3333-333333333333';
    beforeEach(async () => seedUsers(t));

    it('is admin only, and needs both fields', async () => {
      assert.equal((await t.call('POST', '/admin/lookup', { as: MEMBER, body: { title: 'a', artist: 'b' } })).status, 403);
      assert.equal((await t.call('POST', '/admin/lookup', { as: OWNER, body: { title: 'a' } })).status, 400);
      const found = await t.call('POST', '/admin/lookup', { as: OWNER, body: { title: 'a', artist: 'b' } });
      assert.equal(found.body.matches[0].title, 'Found');
    });

    it('finds genres for a picked match', async () => {
      const found = await t.call('POST', '/admin/lookup/genres', { as: OWNER, body: { recording_id: recording } });
      assert.deepEqual(found.body.genres, ['Indie pop']);
      assert.equal((await t.call('POST', '/admin/lookup/genres', { as: MEMBER, body: {} })).status, 403);
      assert.equal((await t.call('POST', '/admin/lookup/genres', { as: OWNER, body: { artist_id: 'x' } })).status, 400);
    });

    it('refuses a bad release ID', async () => {
      assert.equal((await t.call('GET', '/admin/lookup/cover?release=nonsense', { as: OWNER })).status, 400);
      assert.equal((await t.call('GET', '/admin/lookup/cover', { as: OWNER })).status, 400);
    });

    it('falls back to Deezer when MusicBrainz finds nothing or is down', async () => {
      const original = t.deps.musicbrainz.search;
      t.deps.musicbrainz.search = async () => [];
      let found = await t.call('POST', '/admin/lookup', { as: OWNER, body: { title: 'Cindai', artist: 'Siti' } });
      assert.equal(found.body.matches[0].source, 'deezer');
      t.deps.musicbrainz.search = async () => {
        throw new Error('down');
      };
      found = await t.call('POST', '/admin/lookup', { as: OWNER, body: { title: 'Cindai', artist: 'Siti' } });
      assert.equal(found.body.matches[0].source, 'deezer');
      t.deps.musicbrainz.search = original;
    });

    it('saves a picked match and reports the album', async () => {
      const { id, trackId } = await processUpload(t, { album: null });
      const approved = await t.call('POST', `/admin/uploads/${id}/approve`, {
        as: OWNER,
        body: { album: 'Late Hours', artist: 'Lumen Park', year: 2021, mb_recording_id: recording, mb_release_id: release },
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.album_has_cover, false);
      const [[row]] = await t.db.query(
        'SELECT t.mb_recording_id, al.id, al.mb_release_id FROM tracks t JOIN albums al ON al.id = t.album_id WHERE t.id = ?',
        [trackId],
      );
      assert.deepEqual([row.mb_recording_id, row.mb_release_id, row.id], [recording, release, approved.body.album_id]);
    });

    it('links an existing album rather than duplicating it', async () => {
      const { trackId } = await publish(t);
      const saved = await t.call('PATCH', `/admin/tracks/${trackId}`, {
        as: OWNER,
        body: { album: 'Late Hours', mb_release_id: release },
      });
      assert.equal(saved.body.album_has_cover, true);
      const [albums] = await t.db.query('SELECT mb_release_id FROM albums');
      assert.deepEqual(albums.map((album) => album.mb_release_id), [release]);
    });
  });

  describe('admin CRUD', () => {
    beforeEach(async () => seedUsers(t));

    it('blocks archiving an artist or album with active songs', async () => {
      const { trackId } = await publish(t);
      const [[artist]] = await t.db.query('SELECT id FROM artists');
      const [[album]] = await t.db.query('SELECT id FROM albums');
      const blocked = await t.call('POST', `/admin/artists/${artist.id}/archive`, { as: OWNER });
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /Can't archive Coastline Radio yet — 1 song is still active/);
      assert.equal((await t.call('DELETE', `/admin/albums/${album.id}`, { as: OWNER })).status, 409);
      await t.call('POST', `/admin/tracks/${trackId}/archive`, { as: OWNER });
      assert.equal((await t.call('POST', `/admin/artists/${artist.id}/archive`, { as: OWNER })).status, 204);
    });

    it('hides archived songs everywhere and restores them in place', async () => {
      const { trackId } = await publish(t);
      const playlist = await t.call('POST', '/playlists', { as: MEMBER, body: { name: 'Car rides' } });
      await t.call('POST', `/playlists/${playlist.body.id}/tracks`, { as: MEMBER, body: { track_id: trackId } });
      await t.call('PUT', `/likes/${trackId}`, { as: MEMBER });

      await t.call('POST', `/admin/tracks/${trackId}/archive`, { as: OWNER });
      assert.equal((await t.call('GET', `/playlists/${playlist.body.id}`, { as: MEMBER })).body.tracks.length, 0);
      assert.equal((await t.call('GET', '/likes', { as: MEMBER })).body.items.length, 0);
      assert.equal((await t.call('GET', '/search?q=night', { as: MEMBER })).body.tracks.length, 0);

      await t.call('POST', `/admin/tracks/${trackId}/unarchive`, { as: OWNER });
      assert.equal((await t.call('GET', `/playlists/${playlist.body.id}`, { as: MEMBER })).body.tracks.length, 1);
      assert.equal((await t.call('GET', '/likes', { as: MEMBER })).body.items.length, 1);
    });

    it('hard delete needs Deleted first, then removes R2 files', async () => {
      const { trackId, uuid } = await publish(t);
      assert.equal((await t.call('DELETE', `/admin/tracks/${trackId}/permanent`, { as: OWNER })).status, 409);
      await t.call('DELETE', `/admin/tracks/${trackId}`, { as: OWNER });
      const listed = await t.call('GET', '/admin/tracks?view=deleted', { as: OWNER });
      assert.equal(listed.body.counts.deleted, 1);
      assert.equal((await t.call('DELETE', `/admin/tracks/${trackId}/permanent`, { as: OWNER })).status, 204);
      await drainCleanupQueue(t.deps);
      assert.ok(t.deleted.includes(`tracks/${uuid}/opus.webm`));
    });

    it('refuses hard-deleting an album a soft-deleted song still uses', async () => {
      const { trackId } = await publish(t);
      const [[album]] = await t.db.query('SELECT id FROM albums');
      await t.call('DELETE', `/admin/tracks/${trackId}`, { as: OWNER });
      await t.call('DELETE', `/admin/albums/${album.id}`, { as: OWNER });
      const refused = await t.call('DELETE', `/admin/albums/${album.id}/permanent`, { as: OWNER });
      assert.equal(refused.status, 409);
    });

    it('replaces artwork and queues the old cover', async () => {
      const { uuid } = await publish(t);
      const [[album]] = await t.db.query('SELECT id FROM albums');
      const started = await t.call('POST', `/admin/albums/${album.id}/artwork`, { as: OWNER });
      await t.call('POST', `/admin/albums/${album.id}/artwork/complete`, { as: OWNER, body: { prefix: started.body.prefix } });
      await drainCleanupQueue(t.deps);
      assert.ok(t.deleted.includes(`artwork/${uuid}/`));
    });
  });

  describe('offline check', () => {
    it('returns what is not playable, including hard-deleted IDs', async () => {
      await seedUsers(t);
      const live = await publish(t, { title: 'Live' });
      const archived = await publish(t, { title: 'Archived' });
      await t.call('POST', `/admin/tracks/${archived.trackId}/archive`, { as: OWNER });
      const check = await t.call('POST', '/offline/check', { as: MEMBER, body: { ids: [live.trackId, archived.trackId, 99999] } });
      assert.deepEqual(check.body.remove, [archived.trackId, 99999]);
    });

    it('tells a blocked user to remove everything', async () => {
      const memberId = await seedUsers(t);
      const live = await publish(t);
      await t.call('PATCH', `/admin/users/${memberId}`, { as: OWNER, body: { status: 'blocked' } });
      const check = await t.call('POST', '/offline/check', { as: MEMBER, body: { ids: [live.trackId] } });
      assert.equal(check.status, 200);
      assert.deepEqual(check.body.remove, [live.trackId]);
      assert.equal(check.body.user_status, 'blocked');
      const other = await t.call('GET', '/tracks', { as: MEMBER });
      assert.equal(other.status, 403);
      assert.equal(other.body.user_status, 'blocked');
    });

    it('validates its input', async () => {
      await seedUsers(t);
      assert.equal((await t.call('POST', '/offline/check', { as: MEMBER, body: { ids: ['1; DROP'] } })).status, 400);
    });
  });

  describe('plays', () => {
    const play = (trackId, extra = {}) => ({
      client_play_id: randomUUID(),
      track_id: trackId,
      played_at: new Date().toISOString(),
      ms_played: 1000,
      was_offline: true,
      ...extra,
    });

    it('stores a retried play once', async () => {
      await seedUsers(t);
      const { trackId } = await publish(t);
      const item = play(trackId);
      await t.call('POST', '/plays', { as: MEMBER, body: { plays: [item] } });
      await t.call('POST', '/plays', { as: MEMBER, body: { plays: [item] } });
      const [rows] = await t.db.query('SELECT id FROM play_history');
      assert.equal(rows.length, 1);
    });

    it('handles bad, deleted, overlong and skewed plays individually', async () => {
      await seedUsers(t);
      const { trackId } = await publish(t);
      const bad = play(trackId, { played_at: 'not a date' });
      const future = play(trackId, { played_at: new Date(Date.now() + 3600_000).toISOString() });
      const skewed = play(trackId, { played_at: new Date(Date.now() + 120_000).toISOString() });
      const gone = play(99999);
      const long = play(trackId, { ms_played: 999_999_999 });
      const { body } = await t.call('POST', '/plays', { as: MEMBER, body: { plays: [bad, future, skewed, gone, long] } });
      assert.equal(body.failed.length, 2);
      assert.deepEqual(body.dropped, [gone.client_play_id]);
      assert.equal(body.accepted.length, 2);
      const [[row]] = await t.db.query('SELECT MAX(ms_played) AS most FROM play_history');
      assert.equal(row.most, 222000);
    });
  });

  describe('search', () => {
    it('finds by prefix, artist and accent-free text, and hides unpublished', async () => {
      await seedUsers(t);
      await publish(t, { title: 'Night Drive', artist: 'Coastline Radio', album: { title: 'Coastal Lines' } });
      await publish(t, { title: 'Halo', artist: 'Beyoncé', album: null });
      await publish(t, { title: 'Who Are You', artist: 'The Who', album: null });
      await processUpload(t, { title: 'Coast Secret', artist: 'Unknown', album: null });

      const coast = await t.call('GET', '/search?q=coast', { as: MEMBER });
      assert.deepEqual(coast.body.tracks.map((track) => track.title), ['Night Drive']);
      assert.equal(coast.body.artists[0].name, 'Coastline Radio');
      assert.equal(coast.body.albums[0].title, 'Coastal Lines');

      const accent = await t.call('GET', '/search?q=beyonce', { as: MEMBER });
      assert.equal(accent.body.artists[0].name, 'Beyoncé');
      const who = await t.call('GET', '/search?q=The%20Who', { as: MEMBER });
      assert.equal(who.body.artists[0].name, 'The Who');
      const empty = await t.call('GET', '/search?q=%2B-%3C%3E', { as: MEMBER });
      assert.deepEqual(empty.body.tracks, []);
    });
  });

  describe('playlists are private', () => {
    it("can't read or change another user's playlist", async () => {
      await seedUsers(t);
      const playlist = await t.call('POST', '/playlists', { as: OWNER, body: { name: 'Mine' } });
      assert.equal((await t.call('GET', `/playlists/${playlist.body.id}`, { as: MEMBER })).status, 404);
      assert.equal((await t.call('DELETE', `/playlists/${playlist.body.id}`, { as: MEMBER })).status, 404);
    });

    it('never holds the same song twice', async () => {
      await seedUsers(t);
      const { trackId } = await publish(t);
      const { body } = await t.call('POST', '/playlists', { as: MEMBER, body: { name: 'P' } });
      await t.call('POST', `/playlists/${body.id}/tracks`, { as: MEMBER, body: { track_id: trackId } });
      const again = await t.call('POST', `/playlists/${body.id}/tracks`, { as: MEMBER, body: { track_id: trackId } });
      assert.equal(again.body.added, false);
    });
  });

  describe('abandoned uploads', () => {
    it('are cleaned up after the limit', async () => {
      await seedUsers(t);
      const { body } = await t.call('POST', '/uploads', { as: MEMBER, body: { filename: 'a.mp3', size_bytes: 1 } });
      await t.db.query('UPDATE uploads SET created_at = UTC_TIMESTAMP() - INTERVAL 25 HOUR WHERE id = ?', [body.id]);
      assert.equal(await purgeAbandoned(t.deps), 1);
    });
  });

  describe('R2 cleanup queue', () => {
    it('runs new deletes straight away, whatever time zone MySQL is in', async () => {
      await t.db.query("INSERT INTO r2_cleanup_queue (r2_key, reason, next_attempt_at) VALUES ('tracks/y/opus.webm', 'test', UTC_TIMESTAMP() + INTERVAL 8 HOUR)");
      await drainCleanupQueue(t.deps);
      assert.ok(t.deleted.includes('tracks/y/opus.webm'));
    });

    it('backs off on failure and keeps the row', async () => {
      await t.db.query("INSERT INTO r2_cleanup_queue (r2_key, reason) VALUES ('tracks/x/opus.webm', 'test')");
      const original = t.deps.storage.deleteKey;
      t.deps.storage.deleteKey = async () => {
        throw new Error('R2 down');
      };
      await drainCleanupQueue(t.deps);
      t.deps.storage.deleteKey = original;
      const [[row]] = await t.db.query('SELECT attempts, last_error, next_attempt_at > UTC_TIMESTAMP() AS later FROM r2_cleanup_queue');
      assert.deepEqual([row.attempts, row.last_error, row.later], [1, 'R2 down', 1]);
    });
  });
});
