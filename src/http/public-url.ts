import { networkInterfaces } from 'node:os';
import type { FastifyRequest } from 'fastify';

type Interfaces = ReturnType<typeof networkInterfaces>;

const LOOPBACK_HOSTS = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/i;
/** Physical Wi-Fi/Ethernet first; container and VM bridges are never what a phone can reach. */
const PHYSICAL = /^(wl|en|eth)/;
const VIRTUAL = /^(docker|br-|virbr|veth|vmnet|vboxnet|lo)/;

/** Best guess at this machine's address on the home network, e.g. 192.168.1.20. */
export function lanAddress(interfaces: Interfaces = networkInterfaces()): string | undefined {
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([name, addresses]) =>
      (addresses ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address })),
    );
  const preferred = candidates.find((c) => PHYSICAL.test(c.name)) ?? candidates[0];
  return preferred?.address;
}

/**
 * Base URL a phone on the same network can open. If the browser asking already uses a
 * non-loopback address, that one works; otherwise PUBLIC_URL, then the detected LAN address.
 */
export function phoneBaseUrl(request: FastifyRequest, configured: string | undefined, interfaces?: Interfaces): string | undefined {
  const host = request.headers.host ?? '';
  if (host && !LOOPBACK_HOSTS.test(host)) return `${request.protocol}://${host}`;
  if (configured) return configured;
  const address = lanAddress(interfaces);
  const port = host.split(':')[1] ?? String(request.socket.localPort);
  return address ? `${request.protocol}://${address}:${port}` : undefined;
}
