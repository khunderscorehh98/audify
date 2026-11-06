import { RetryableError } from './errors.js';

/** Client for /internal/processor. Holds no R2 credentials, only the API token. */
export function createApi({ baseUrl, token, fetchImpl = fetch }) {
  const request = async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/internal/processor${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new RetryableError('API could not be reached');
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };

  const expectOk = async (method, path, body) => {
    const { status, data } = await request(method, path, body);
    if (status >= 400) throw new RetryableError(`API returned ${status}`);
    return data;
  };

  return {
    pending: () => expectOk('GET', '/uploads/pending'),
    claim: (id) => request('POST', `/uploads/${id}/claim`),
    source: (id) => expectOk('GET', `/uploads/${id}/source`),
    hash: (id, sha256) => expectOk('POST', `/uploads/${id}/hash`, { sha256 }),
    albumLookup: (mbReleaseId) =>
      expectOk('GET', `/albums/lookup?mb_release_id=${encodeURIComponent(mbReleaseId)}`),
    presign: (id, body) => expectOk('POST', `/uploads/${id}/presign`, body),
    result: (id, body) => expectOk('POST', `/uploads/${id}/result`, body),
    fail: (id, failure) => expectOk('POST', `/uploads/${id}/fail`, failure),
  };
}
