import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lanAddresses, loadConfig } from '../src/config.js';

const ip = (address, internal = false) => ({ address, family: 'IPv4', internal });

const adapters = {
  Ethernet: [ip('192.168.1.20'), { address: 'fe80::1', family: 'IPv6', internal: false }],
  'WireGuard Tunnel': [ip('10.5.0.2')],
  'vEthernet (WSL)': [ip('172.20.0.1')],
  'Loopback Pseudo-Interface 1': [ip('127.0.0.1', true)],
  Public: [ip('203.0.113.9')],
};

describe('network access', () => {
  it('stays on localhost unless turned on', () => {
    const config = loadConfig({ AUTH_MODE: 'dev' }, adapters);
    assert.equal(config.host, '127.0.0.1');
    assert.deepEqual(config.corsOrigins, ['http://localhost:5173']);
    assert.equal(config.publicBaseUrl, 'http://localhost:3000');
  });

  it('opens up, and allows only the LAN frontend origin', () => {
    const config = loadConfig({ AUTH_MODE: 'dev', AUDIFY_LAN: '1' }, adapters);
    assert.equal(config.host, '0.0.0.0');
    assert.deepEqual(config.corsOrigins, ['http://localhost:5173', 'http://192.168.1.20:5173']);
    assert.equal(config.publicBaseUrl, 'http://192.168.1.20:3000');
  });

  it('skips VPN, virtual, loopback and public addresses', () => {
    assert.deepEqual(lanAddresses(adapters), ['192.168.1.20']);
  });

  it('prefers a home network address over other private ranges', () => {
    const found = lanAddresses({ 'Unnamed Adapter': [ip('10.8.0.2')], Ethernet: [ip('192.168.1.20')] });
    assert.deepEqual(found, ['192.168.1.20', '10.8.0.2']);
  });

  it('lets LAN_IP override detection', () => {
    const config = loadConfig({ AUTH_MODE: 'dev', AUDIFY_LAN: '1', LAN_IP: '192.168.1.50' }, adapters);
    assert.equal(config.publicBaseUrl, 'http://192.168.1.50:3000');
  });

  it('refuses network mode in production', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', AUDIFY_LAN: '1' }), /not allowed/);
  });

  it('explains itself when no address is found', () => {
    assert.throws(() => loadConfig({ AUTH_MODE: 'dev', AUDIFY_LAN: '1' }, {}), /LAN_IP/);
  });
});
