import { api } from './api.js';

async function toJpeg(bitmap, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  // Centre-crop to a square.
  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

/** Patch 3 §6: resize here, upload to a new prefix, then switch the album over. */
export async function replaceArtwork(albumId, file) {
  const bitmap = await createImageBitmap(file);
  const { prefix, urls } = await api.post(`/admin/albums/${albumId}/artwork`);
  for (const size of [96, 256, 512]) {
    const response = await fetch(urls[size], {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: await toJpeg(bitmap, size),
    });
    if (!response.ok) throw new Error('Artwork upload failed');
  }
  await api.post(`/admin/albums/${albumId}/artwork/complete`, { prefix });
}

/**
 * Applies the cover of a match picked in Autocomplete. `saved` is the API's
 * answer after saving, since picking a match can change the album. An album
 * that already has a cover keeps it; Replace artwork is there for that.
 */
export async function applyMatchCover(releaseId, saved) {
  if (!releaseId || !saved?.album_id || saved.album_has_cover) return false;
  const image = await api.blob(`/admin/lookup/cover/${releaseId}`);
  await replaceArtwork(saved.album_id, image);
  return true;
}
