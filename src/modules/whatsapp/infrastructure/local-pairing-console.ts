import { createServer, type IncomingMessage, type Server } from 'node:http';

const host = '127.0.0.1' as const;

type State = 'IDLE' | 'CODE_DISPLAYED' | 'FAILED';

export interface LocalPairingConsole {
  start(): Promise<Readonly<{ host: typeof host; port: number }>>;
  stop(): Promise<void>;
  status(): Readonly<{ state: State }>;
}

export function createLocalPairingConsole(dependencies: {
  readonly requestCode: (target: string) => Promise<string>;
}): LocalPairingConsole {
  let server: Server | undefined;
  let state: State = 'IDLE';

  return {
    async start() {
      if (!server) {
        server = createServer((request, response) => {
          void handle(request).then(({ status, body }) => {
            response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            response.end(body);
          });
        });
        await listen(server);
      }
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local pairing console address is unavailable');
      return Object.freeze({ host, port: address.port });
    },
    async stop() {
      if (!server) return;
      const current = server;
      server = undefined;
      await new Promise<void>((resolve, reject) => current.close((error) => (error ? reject(error) : resolve())));
    },
    status() {
      return Object.freeze({ state });
    },
  };

  async function handle(request: IncomingMessage) {
    if (request.method === 'GET') return page(200);
    if (request.method !== 'POST') return page(405, 'Method not allowed');
    const target = parseTarget(await readBody(request));
    if (!target) return page(400, 'Enter a valid disposable account number');
    try {
      const code = await dependencies.requestCode(target);
      if (!code) throw new Error();
      state = 'CODE_DISPLAYED';
      return page(200, undefined, code);
    } catch {
      state = 'FAILED';
      return page(400, 'Pairing code is unavailable. Try again.');
    }
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => { server.off('error', reject); resolve(); });
    server.listen({ host, port: 0, exclusive: true });
  });
}

function parseTarget(body: string): string | null {
  try {
    const value = new URLSearchParams(body).get('target');
    return value !== null && /^[1-9][0-9]{7,14}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function page(status: 200 | 400 | 405, message?: string, code?: string) {
  const detail = code ? `<p id="pairing-code">${code}</p>` : message ? `<p role="alert">${message}</p>` : '';
  return { status, body: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WARLIST disposable pairing</title><main><h1>Disposable pairing</h1><form method="post"><label for="target">Disposable account number</label><input id="target" name="target" inputmode="numeric" autocomplete="off" required pattern="[1-9][0-9]{7,14}"><button type="submit">Request pairing code</button></form>${detail}</main>` };
}
