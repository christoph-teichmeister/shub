import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTailscale } from './tailscale.ts';

test('parseTailscale reads name, https, online phones and whether serve points at shub', () => {
  const status = {
    BackendState: 'Running',
    Self: { DNSName: 'pc.tail1.ts.net.' },
    CertDomains: ['pc.tail1.ts.net'],
    Peer: {
      a: { HostName: 'Pixel', OS: 'android', Online: true },
      b: { HostName: 'iPhone', OS: 'iOS', Online: false },
      c: { HostName: 'nas', OS: 'linux', Online: true },
    },
  };
  const serve = { Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4780' } } } } };
  assert.deepEqual(parseTailscale(status, serve, 4780), {
    installed: true,
    running: true,
    dnsName: 'pc.tail1.ts.net',
    https: true,
    phones: ['Pixel'],
    served: true,
  });
  const other = parseTailscale({ ...status, CertDomains: null }, serve, 47801);
  assert.equal(other.served, false);
  assert.equal(other.https, false);
});
