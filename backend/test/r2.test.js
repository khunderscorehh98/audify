import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createR2Storage } from '../src/storage/r2.js';

// Signing happens locally, so these tests need neither R2 nor a network.
const storage = createR2Storage({
  r2: { accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'audify' },
  presignGetSeconds: 14400,
  presignPutSeconds: 3600,
});

describe('R2 presigned URLs', () => {
  it('use the S3 API domain, never r2.dev', async () => {
    const url = new URL(await storage.presignGet('tracks/x/opus.webm'));
    assert.match(url.hostname, /\.r2\.cloudflarestorage\.com$/);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '14400');
  });

  it('sign Content-Type on PUT, so a browser must send exactly that type', async () => {
    const url = new URL(await storage.presignPut('inbox/x', 'audio/flac'));
    assert.match(url.searchParams.get('X-Amz-SignedHeaders'), /content-type/);
  });

  it('carry no SDK checksum parameters, which a browser PUT cannot satisfy', async () => {
    const url = new URL(await storage.presignPut('inbox/x', 'audio/flac'));
    const checksum = [...url.searchParams.keys()].filter((key) => /checksum/i.test(key));
    assert.deepEqual(checksum, []);
  });
});
