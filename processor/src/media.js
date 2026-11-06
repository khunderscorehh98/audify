import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import { PermanentError, RetryableError } from './errors.js';

const run = promisify(execFile);

export const ARTWORK_SIZES = [96, 256, 512];

export async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export async function downloadTo(url, file, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new RetryableError('Could not download the upload');
  }
  if (!response.ok) throw new RetryableError(`Download returned ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

/** Reads format and tags. A file that can't be parsed isn't usable audio. */
export async function inspect(file) {
  let parsed;
  try {
    parsed = await parseFile(file, { duration: true });
  } catch {
    throw new PermanentError('File could not be read as audio');
  }
  const { format, common } = parsed;
  if (!format.duration || format.duration <= 0) throw new PermanentError('File has no audio');
  return {
    format: {
      codec: normaliseCodec(format),
      lossless: Boolean(format.lossless),
      container: format.container ?? '',
      durationMs: Math.round(format.duration * 1000),
      sampleRate: format.sampleRate ?? null,
      bitDepth: format.bitsPerSample ?? null,
      channels: format.numberOfChannels ?? null,
      bitrateKbps: format.lossless || !format.bitrate ? null : Math.round(format.bitrate / 1000),
    },
    tags: {
      title: common.title ?? null,
      artist: common.artist ?? null,
      artists: common.artists ?? [],
      album: common.album ?? null,
      year: common.year ?? null,
      trackNumber: common.track?.no ?? null,
      discNumber: common.disk?.no ?? null,
      genres: common.genre ?? [],
      picture: common.picture?.[0]?.data ?? null,
    },
  };
}

export function normaliseCodec(format) {
  const text = `${format.codec ?? ''} ${format.container ?? ''}`.toLowerCase();
  if (text.includes('flac')) return 'flac';
  if (text.includes('alac')) return 'alac';
  if (text.includes('pcm') || text.includes('wave')) return 'pcm';
  if (text.includes('opus')) return 'opus';
  if (text.includes('vorbis')) return 'vorbis';
  // AAC first: its codec name is "MPEG-4/AAC", which also contains "mpeg".
  if (text.includes('aac') || text.includes('mp4a')) return 'aac';
  if (text.includes('mpeg') || text.includes('mp3')) return 'mp3';
  return (format.codec ?? 'unknown').toLowerCase().slice(0, 50);
}

/** FLAC originals stream as themselves; only ALAC/WAV need a FLAC copy (patch 1). */
export const needsFlacRendition = (format) => format.lossless && format.codec !== 'flac';

export function renditionPlan(format) {
  const plan = [
    {
      kind: 'opus',
      name: 'opus.webm',
      contentType: 'audio/webm',
      mime: 'audio/webm; codecs="opus"',
      codec: 'opus',
      bitrate: 96,
      args: ['-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on'],
    },
    {
      kind: 'aac',
      name: 'aac.m4a',
      contentType: 'audio/mp4',
      mime: 'audio/mp4; codecs="mp4a.40.2"',
      codec: 'aac',
      bitrate: 128,
      args: ['-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
    },
  ];
  if (needsFlacRendition(format)) {
    plan.push({
      kind: 'flac',
      name: 'lossless.flac',
      contentType: 'audio/flac',
      mime: 'audio/flac',
      codec: 'flac',
      bitrate: null,
      args: ['-vn', '-c:a', 'flac'],
    });
  }
  return plan;
}

export async function encode(input, output, args, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg') {
  try {
    await run(ffmpeg, ['-y', '-v', 'error', '-i', input, ...args, output], { maxBuffer: 1024 * 1024 });
  } catch (error) {
    if (error.code === 'ENOENT') throw new RetryableError('ffmpeg is not installed');
    throw new PermanentError('Audio could not be converted');
  }
}

/** Square JPEGs for the player and lock screen. */
export async function renderArtwork(image, outputFor) {
  const files = [];
  for (const size of ARTWORK_SIZES) {
    const file = outputFor(size);
    await sharp(image)
      .resize(size, size, { fit: 'cover' })
      .flatten({ background: '#171b22' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(file);
    files.push({ size, file });
  }
  return files;
}
