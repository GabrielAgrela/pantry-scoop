import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { lanAddress, phoneBaseUrl } from '../../src/http/public-url.ts';

const nic = (address: string, internal = false) => ({ address, internal, family: 'IPv4' as const, netmask: '', mac: '', cidr: null });
const interfaces = {
  lo: [nic('127.0.0.1', true)],
  'br-07ebf2192ccf': [nic('192.168.32.1')],
  docker0: [nic('172.17.0.1')],
  wlp2s0: [nic('192.168.1.20')],
};
const request = (host: string) => ({ headers: { host }, protocol: 'http', socket: { localPort: 3210 } }) as unknown as FastifyRequest;

describe('lanAddress', () => {
  it('prefers the Wi-Fi/Ethernet address over container and VM bridges', () => {
    assert.equal(lanAddress(interfaces), '192.168.1.20');
    assert.equal(lanAddress({ lo: interfaces.lo, docker0: interfaces.docker0 }), undefined);
  });
});

describe('phoneBaseUrl', () => {
  it('reuses a LAN host the browser already uses', () => {
    assert.equal(phoneBaseUrl(request('192.168.1.20:3210'), undefined, interfaces), 'http://192.168.1.20:3210');
  });

  it('swaps loopback for PUBLIC_URL or the detected LAN address', () => {
    assert.equal(phoneBaseUrl(request('127.0.0.1:3210'), 'http://pantry.home', interfaces), 'http://pantry.home');
    assert.equal(phoneBaseUrl(request('localhost:3210'), undefined, interfaces), 'http://192.168.1.20:3210');
  });
});
