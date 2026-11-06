import { idToken } from './auth.js';

function apiBase() {
  const url = new URL(import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');
  // In development, follow the address the page came from, so a phone on the
  // network reaches the API on this machine rather than on itself.
  if (import.meta.env.DEV && url.hostname === 'localhost') url.hostname = location.hostname;
  return url.origin;
}

const BASE = apiBase();
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

export class OfflineError extends Error {
  constructor() {
    super("You're offline");
    this.offline = true;
  }
}

let onForbidden = () => {};
/** The session store registers here so a block takes effect on any request. */
export const setForbiddenHandler = (handler) => {
  onForbidden = handler;
};

async function request(method, path, body) {
  const token = await idToken();
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OfflineError();
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 403 && data?.user_status) onForbidden(data.user_status);
    throw new ApiError(response.status, data);
  }
  return data;
}

/** For images the API proxies. */
async function blob(path) {
  const token = await idToken();
  let response;
  try {
    response = await fetch(BASE + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OfflineError();
  }
  if (!response.ok) throw new ApiError(response.status, null);
  return response.blob();
}

export const api = {
  blob,
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path) => request('PUT', path),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
