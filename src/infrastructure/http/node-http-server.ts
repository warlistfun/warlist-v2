import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { isAbsolute, extname, relative, resolve, sep } from 'node:path';

import type { ApplicationLifecycle } from '../../app/ports';
import type { HttpApp, HttpResponse } from '../../app/create-http-app';

const host = '127.0.0.1' as const;

export interface NodeHttpServer extends ApplicationLifecycle {
  address(): Readonly<{ host: typeof host; port: number }> | undefined;
}

export function createNodeHttpServer(dependencies: {
  readonly config: unknown;
  readonly app: HttpApp;
}): NodeHttpServer {
  const config = parseConfig(dependencies.config);
  let server: Server | undefined;
  let address: Readonly<{ host: typeof host; port: number }> | undefined;
  let cleanupIncomplete = false;
  let transition = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  }

  return {
    start(): Promise<void> {
      return enqueue(async () => {
        if (cleanupIncomplete) throw new Error('HTTP listener cleanup is incomplete');
        if (server?.listening) return;

        const webRoot = await validateWebRoot(config.webRoot);
        const candidate = createServer((request, response) => {
          void handleRequest(
            dependencies.app,
            webRoot,
            request.method,
            request.url,
            response,
          ).catch(() => writeInternalError(response));
        });
        candidate.on('clientError', (_error, socket) => socket.destroy());
        server = candidate;
        cleanupIncomplete = true;
        try {
          await listen(candidate, config.port);
          const listeningAddress = candidate.address();
          if (!listeningAddress || typeof listeningAddress === 'string') {
            throw new Error('HTTP listener address is unavailable');
          }
          address = Object.freeze({ host, port: listeningAddress.port });
          cleanupIncomplete = false;
        } catch {
          address = undefined;
          server = undefined;
          cleanupIncomplete = false;
          candidate.closeAllConnections();
          throw new Error('HTTP listener failed to start');
        }
      });
    },
    stop(): Promise<void> {
      return enqueue(async () => {
        const current = server;
        address = undefined;
        if (!current) return;
        if (!current.listening) {
          server = undefined;
          cleanupIncomplete = false;
          return;
        }
        try {
          await close(current);
          server = undefined;
          cleanupIncomplete = false;
        } catch {
          cleanupIncomplete = true;
          throw new Error('HTTP listener failed to stop');
        }
      });
    },
    address() {
      return address;
    },
  };
}

async function handleRequest(
  app: HttpApp,
  webRoot: string,
  method: string | undefined,
  rawUrl: string | undefined,
  response: ServerResponse,
): Promise<void> {
  const pathname = parsePathname(rawUrl);
  if (pathname === '/api' || pathname?.startsWith('/api/')) {
    writeJson(response, await app.handle({ method, path: pathname }));
    return;
  }
  if (!pathname) {
    writeText(response, 400, 'Bad request');
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    writeText(response, 405, 'Method not allowed');
    return;
  }

  const decodedPath = decodeStaticPath(pathname);
  if (!decodedPath) {
    writeText(response, 404, 'Not found');
    return;
  }
  const requested = extname(decodedPath) ? decodedPath : '/index.html';
  const file = await resolveStaticFile(webRoot, requested);
  if (!file) {
    writeText(response, 404, 'Not found');
    return;
  }
  const body = await readFile(file);
  response.writeHead(200, {
    'content-type': contentType(file),
    'content-length': body.byteLength,
    'x-content-type-options': 'nosniff',
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function writeJson(response: ServerResponse, result: HttpResponse): void {
  const body = Buffer.from(JSON.stringify(result.body));
  response.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function writeInternalError(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = Buffer.from(
    JSON.stringify({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', retryable: true },
      requestId: 'unavailable',
    }),
  );
  response.writeHead(500, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function writeText(response: ServerResponse, status: number, message: string): void {
  const body = Buffer.from(message);
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.byteLength,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function parsePathname(rawUrl: string | undefined): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  try {
    return new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return undefined;
  }
}

function decodeStaticPath(pathname: string): string | undefined {
  try {
    const decoded = decodeURIComponent(pathname);
    if (
      !decoded.startsWith('/') ||
      decoded.includes('\0') ||
      decoded.includes('\\') ||
      decoded.split('/').some((segment) => segment === '..')
    ) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

async function validateWebRoot(input: string): Promise<string> {
  try {
    const root = await realpath(input);
    const index = await realpath(resolve(root, 'index.html'));
    if (
      !(await stat(root)).isDirectory() ||
      !(await stat(index)).isFile() ||
      !isWithin(root, index)
    ) {
      throw new Error();
    }
    return root;
  } catch {
    throw new Error('Built Web entrypoint is unavailable');
  }
}

async function resolveStaticFile(root: string, path: string): Promise<string | undefined> {
  try {
    const candidate = await realpath(resolve(root, `.${path}`));
    return isWithin(root, candidate) && (await stat(candidate)).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const onError = (): void => {
      server.off('listening', onListening);
      reject(new Error('HTTP listener failed to start'));
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolvePromise();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port, exclusive: true });
  });
}

function close(server: Server): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

function parseConfig(input: unknown): Readonly<{ port: number; webRoot: string }> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid HTTP server configuration');
  }
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Reflect.ownKeys(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== 2 ||
      !keys.every((key) => key === 'port' || key === 'webRoot') ||
      !descriptors.port?.enumerable ||
      !Object.hasOwn(descriptors.port, 'value') ||
      !descriptors.webRoot?.enumerable ||
      !Object.hasOwn(descriptors.webRoot, 'value')
    ) {
      throw new Error();
    }
    const port: unknown = descriptors.port.value;
    const webRoot: unknown = descriptors.webRoot.value;
    if (
      typeof port !== 'number' ||
      !Number.isSafeInteger(port) ||
      port < 0 ||
      port > 65_535 ||
      typeof webRoot !== 'string' ||
      !isAbsolute(webRoot)
    ) {
      throw new Error();
    }
    return Object.freeze({ port, webRoot });
  } catch {
    throw new Error('Invalid HTTP server configuration');
  }
}
