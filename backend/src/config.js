// Reads and validates environment variables once, at startup.
import os from 'node:os';

const num = (value, fallback) => {
  const parsed = Number(value);
  return value === undefined || value === '' || Number.isNaN(parsed) ? fallback : parsed;
};

const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|vmware|virtualbox|docker|wireguard|openvpn|vpn|tailscale|zerotier|loopback/i;
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** This machine's real LAN addresses, skipping VPN and virtual adapters. */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces)
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, addresses]) => addresses)
    .filter((address) => address.family === 'IPv4' && !address.internal && PRIVATE_IP.test(address.address))
    .map((address) => address.address)
    // Home networks are usually 192.168.x.x. VPNs often use other private ranges.
    .sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}

export function loadConfig(env = process.env, interfaces = undefined) {
  const production = env.NODE_ENV === 'production';
  const devMode = env.AUTH_MODE === 'dev';

  // Dev auth accepts made-up tokens, so it must never reach the droplet.
  if (production && devMode) {
    throw new Error('AUTH_MODE=dev is not allowed when NODE_ENV=production');
  }

  // npm run dev:lan. Local testing only; production sits behind Nginx.
  const lan = env.AUDIFY_LAN === '1';
  if (production && lan) throw new Error('AUDIFY_LAN=1 is not allowed when NODE_ENV=production');
  const lanIps = lan ? (env.LAN_IP ? [env.LAN_IP] : lanAddresses(interfaces)) : [];
  if (lan && !lanIps.length) throw new Error('No LAN address found. Set LAN_IP in .env.development');
  const corsOrigin = env.CORS_ORIGIN || 'http://localhost:5173';
  const frontendPort = new URL(corsOrigin).port || '5173';
  const port = num(env.PORT, 3000);

  const config = {
    production,
    devMode,
    lan,
    lanIps,
    port,
    // Bound to localhost: only Nginx may reach Express.
    host: lan ? '0.0.0.0' : env.HOST || '127.0.0.1',
    corsOrigins: [corsOrigin, ...lanIps.map((ip) => `http://${ip}:${frontendPort}`)],
    db: {
      host: env.DB_HOST || '127.0.0.1',
      port: num(env.DB_PORT, 3306),
      database: env.DB_NAME || 'music_app',
      user: env.DB_USER || 'root',
      password: env.DB_PASSWORD || '',
    },
    firebase: {
      projectId: env.FIREBASE_PROJECT_ID,
      serviceAccountPath: env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH,
    },
    adminBootstrapEmail: (env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase(),
    r2: {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
    },
    storageMode: env.STORAGE_MODE || (devMode ? 'local' : 'r2'),
    localStorageDir: env.LOCAL_STORAGE_DIR || '.dev-storage',
    // Dev storage links must be reachable from the phone, not just this machine.
    publicBaseUrl: lan ? `http://${lanIps[0]}:${port}` : env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    processorServiceToken: env.PROCESSOR_SERVICE_TOKEN || '',
    musicbrainzContact: env.MUSICBRAINZ_CONTACT || '',
    github: {
      token: env.GITHUB_DISPATCH_TOKEN || '',
      repo: env.GITHUB_REPO || '',
    },
    processorMaxAttempts: num(env.PROCESSOR_MAX_ATTEMPTS, 3),
    processorClaimTimeoutMin: num(env.PROCESSOR_CLAIM_TIMEOUT_MIN, 30),
    undoWindowSeconds: num(env.UNDO_WINDOW_SECONDS, 8),
    // Extra server-side time so an Undo tapped at second 8 still lands.
    undoGraceSeconds: num(env.UNDO_GRACE_SECONDS, 2),
    playClockSkewMin: num(env.PLAY_CLOCK_SKEW_MIN, 5),
    uploadAbandonHours: num(env.UPLOAD_ABANDON_HOURS, 24),
    maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 500 * 1024 * 1024),
    presignGetSeconds: num(env.PRESIGN_GET_SECONDS, 4 * 60 * 60),
    presignPutSeconds: num(env.PRESIGN_PUT_SECONDS, 60 * 60),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 300),
    jobsEnabled: env.JOBS_ENABLED !== 'false',
  };

  if (production) {
    const missing = [];
    if (!config.firebase.projectId) missing.push('FIREBASE_PROJECT_ID');
    if (!config.firebase.serviceAccountPath) missing.push('FIREBASE_SERVICE_ACCOUNT_JSON_PATH');
    if (!config.processorServiceToken) missing.push('PROCESSOR_SERVICE_TOKEN');
    if (!config.adminBootstrapEmail) missing.push('ADMIN_BOOTSTRAP_EMAIL');
    for (const key of ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket']) {
      if (!config.r2[key]) missing.push(`R2 ${key}`);
    }
    if (missing.length) throw new Error(`Missing config: ${missing.join(', ')}`);
  }
  return config;
}
