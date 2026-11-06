// Starts the backend and frontend together.
//   npm run dev       this machine only
//   npm run dev:lan   also reachable from other devices on the network
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { lanAddresses } from '../backend/src/config.js';

const root = path.resolve(import.meta.dirname, '..');
const lan = process.argv.includes('--lan');

for (const app of ['backend', 'frontend']) {
  const env = path.join(root, app, '.env.development');
  if (!existsSync(env)) {
    copyFileSync(`${env}.example`, env);
    console.log(`Created ${app}/.env.development from the example`);
  }
}

const childEnv = { ...process.env, AUDIFY_LAN: lan ? '1' : '0' };

for (const app of ['backend', 'frontend']) {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: path.join(root, app),
    env: childEnv,
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code) => {
    if (code) console.error(`${app} stopped with code ${code}`);
  });
}

console.log('\nAudify is starting');
console.log('  This machine: http://localhost:5173');
if (lan) {
  const addresses = process.env.LAN_IP ? [process.env.LAN_IP] : lanAddresses();
  for (const address of addresses) console.log(`  On your network: http://${address}:5173`);
  console.log('  Trusted networks only: development sign-in lets anyone act as the admin.');
}
console.log('');
