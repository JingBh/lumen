import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { BlockList, isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'

export const LAN_PORT = 7390

// A local network's addresses: private IPv4, IPv4 link-local, IPv6 unique-local and link-local. Never the internet.
const LAN = new BlockList()
LAN.addSubnet('10.0.0.0', 8)
LAN.addSubnet('172.16.0.0', 12)
LAN.addSubnet('192.168.0.0', 16)
LAN.addSubnet('169.254.0.0', 16)
LAN.addSubnet('fc00::', 7, 'ipv6')
LAN.addSubnet('fe80::', 10, 'ipv6')
// The machine itself may look too.
const LOOPBACK = new BlockList()
LOOPBACK.addSubnet('127.0.0.0', 8)
LOOPBACK.addAddress('::1', 'ipv6')

/** Whether `list` holds the address; an IPv4 address mapped into IPv6 counts as itself. */
const within = (list: BlockList, address = ''): boolean => {
  const ip = address.split('%')[0]
  return isIP(ip) > 0 && list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4')
}

/** This machine's addresses on local networks, one URL each, with the interface it is on. A link-local IPv6 address needs that interface, which a URL cannot name. */
export const lanUrls = (port: number): { iface: string; url: string }[] =>
  Object.entries(networkInterfaces()).flatMap(([iface, list = []]) =>
    list.filter((a) => !a.internal && !a.scopeid && within(LAN, a.address)).map((a) => ({ iface, url: `http://${a.family === 'IPv6' ? `[${a.address}]` : a.address}:${port}/` }))
  )

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' }

export interface LanServer {
  port: number
  /** Send an event to every page that is open. */
  broadcast(event: string, data: unknown): void
  close(): void
}

/**
 * Serve the window's page to other devices on the local network: the files in `root`, and at /events the screen as it
 * changes. `first` is what a page that has just connected is sent. Only local addresses are answered, and only when
 * asked for by this machine's own address, so a web page elsewhere cannot reach it under a name of its own.
 */
export const startLanServer = async (root: string, first: () => [string, unknown][]): Promise<LanServer> => {
  const pages = new Set<ServerResponse>()
  let port = LAN_PORT
  const write = (res: ServerResponse, event: string, data: unknown): void => void res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const server = createServer((req, res) => {
    const hosts = ['localhost', '127.0.0.1', '[::1]', ...lanUrls(port).map(({ url }) => new URL(url).hostname)].map((h) => `${h}:${port}`)
    if (!(within(LAN, req.socket.remoteAddress) || within(LOOPBACK, req.socket.remoteAddress)) || !hosts.includes(req.headers.host ?? '')) {
      res.writeHead(403).end()
      return
    }
    const path = URL.parse(req.url ?? '', 'http://lumen')?.pathname
    if (req.method !== 'GET' || !path) return void res.writeHead(400).end()
    if (path === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      for (const [event, data] of first()) write(res, event, data)
      pages.add(res)
      req.on('close', () => pages.delete(res))
      return
    }
    const file = normalize(join(root, path === '/' ? 'lan.html' : path))
    const type = TYPES[extname(file)]
    if (!file.startsWith(root + sep) || !type) return void res.writeHead(404).end()
    readFile(file).then(
      (body) => res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(body),
      () => res.writeHead(404).end()
    )
  })
  for (; ; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, () => {
          server.off('error', reject)
          resolve()
        })
      })
      return {
        port,
        broadcast: (event, data) => pages.forEach((res) => write(res, event, data)),
        close: () => {
          pages.forEach((res) => res.end())
          server.close()
          server.closeAllConnections()
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port >= LAN_PORT + 9) throw e
    }
  }
}
