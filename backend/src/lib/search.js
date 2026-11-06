/**
 * Turns typed text into a MySQL boolean-mode query (patch 2 §4, patch 3 §3).
 * Splits on anything that is not a letter, combining mark or number, so
 * operators can never reach MySQL and Arabic/Hindi/Thai words stay whole.
 * Returns '' when nothing searchable remains; callers then skip MySQL.
 */
export function toBooleanQuery(input) {
  const words = String(input ?? '')
    .normalize('NFKC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.map((word) => `+${word}*`).join(' ');
}
