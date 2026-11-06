export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);

export function intParam(value, name = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `Invalid ${name}`);
  return parsed;
}

export function page(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

export function requiredString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} is required`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new HttpError(400, `${name} is too long`);
  return trimmed;
}

/** Final Express error handler. Never echoes internals or presigned URLs. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  console.error(`[${req.method} ${req.path}]`, err.code || '', err.message);
  return res.status(500).json({ error: 'Something went wrong' });
}
