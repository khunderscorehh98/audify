import { openAsBlob, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toFailure, RetryableError } from './errors.js';
import { buildLabels } from './metadata.js';
import * as media from './media.js';

const extensionOf = (filename, format) => {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : format.codec === 'pcm' ? 'wav' : 'bin';
};

const ORIGINAL_MIME = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  aac: 'audio/mp4',
  alac: 'audio/mp4',
  pcm: 'audio/wav',
  opus: 'audio/ogg',
  vorbis: 'audio/ogg',
};

async function putFile(url, file, contentType, fetchImpl) {
  let response;
  try {
    const body = await openAsBlob(file);
    response = await fetchImpl(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  } catch {
    throw new RetryableError('Could not store a file');
  }
  if (!response.ok) throw new RetryableError(`Storage returned ${response.status}`);
}

/** Runs one upload. Logs upload IDs only: Actions logs are public. */
export async function processUpload(id, { api, lookup, log = console.log, fetchImpl = fetch, tools = media }) {
  const claim = await api.claim(id);
  if (claim.status !== 200) {
    log(`upload ${id}: skipped (${claim.data.reason ?? claim.status})`);
    return 'skipped';
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audify-'));
  try {
    const source = await api.source(id);
    const input = path.join(dir, 'input');
    await tools.downloadTo(source.url, input, fetchImpl);

    const sha256 = await tools.sha256File(input);
    if ((await api.hash(id, sha256)).duplicate) {
      log(`upload ${id}: duplicate`);
      return 'duplicate';
    }

    const { format, tags } = await tools.inspect(input);
    const found = await lookup(input);
    if (found.outage) log(`upload ${id}: metadata services unavailable, using file tags`);

    const labels = buildLabels({
      tags,
      filename: source.original_filename,
      durationMs: format.durationMs,
      found,
    });

    // Artwork: Cover Art Archive first, then whatever is embedded in the file.
    let image = found.match?.image ?? tags.picture;
    const releaseId = labels.album?.mb_release_id;
    if (image && releaseId && (await api.albumLookup(releaseId)).has_cover) image = null;
    if (!labels.album) image = null;

    const plan = tools.renditionPlan(format);
    for (const rendition of plan) {
      await tools.encode(input, path.join(dir, rendition.name), rendition.args);
    }

    const originalName = `original.${extensionOf(source.original_filename, format)}`;
    const originalType = ORIGINAL_MIME[format.codec] ?? 'application/octet-stream';
    const signed = await api.presign(id, {
      files: [
        { name: originalName, content_type: originalType },
        ...plan.map((rendition) => ({ name: rendition.name, content_type: rendition.contentType })),
      ],
      artwork: Boolean(image),
    });

    await putFile(signed.urls[originalName].url, input, originalType, fetchImpl);
    const stat = await fs.stat(input);
    const files = [
      {
        kind: 'original',
        r2_key: signed.urls[originalName].key,
        mime_type: originalType,
        codec: format.codec,
        bitrate_kbps: format.bitrateKbps,
        sample_rate_hz: format.sampleRate,
        bit_depth: format.lossless ? format.bitDepth : null,
        channels: format.channels,
        size_bytes: stat.size,
        sha256,
      },
    ];

    for (const rendition of plan) {
      const file = path.join(dir, rendition.name);
      await putFile(signed.urls[rendition.name].url, file, rendition.contentType, fetchImpl);
      files.push({
        kind: rendition.kind,
        r2_key: signed.urls[rendition.name].key,
        mime_type: rendition.mime,
        codec: rendition.codec,
        bitrate_kbps: rendition.bitrate,
        channels: format.channels,
        size_bytes: (await fs.stat(file)).size,
        sha256: await tools.sha256File(file),
      });
    }

    if (image) {
      const rendered = await tools.renderArtwork(image, (size) => path.join(dir, `${size}.jpg`));
      for (const { size, file } of rendered) {
        await putFile(signed.urls[`artwork/${size}.jpg`].url, file, 'image/jpeg', fetchImpl);
      }
      labels.album.cover_prefix = signed.artwork_prefix;
    }

    await api.result(id, { ...labels, files });
    log(`upload ${id}: ready for approval`);
    return 'processed';
  } catch (error) {
    const failure = toFailure(error);
    // failure.error is a fixed, safe message, so it can go in public logs.
    log(`upload ${id}: ${failure.retryable ? 'temporary' : 'permanent'} failure: ${failure.error}`);
    // Local runs only: the raw message may hold filenames or URLs.
    if (process.env.NODE_ENV === 'development') log(`  detail: ${error.message}`);
    await api.fail(id, failure).catch(() => log(`upload ${id}: could not report failure`));
    return 'failed';
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
