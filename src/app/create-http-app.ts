import type { IdGeneratorPort, RepositoryPort, WorkerRuntimePort } from './ports';

export interface HttpRequest {
  method: string;
  path: string;
}

export interface HttpResponse {
  status: number;
  body: SuccessBody | FailureBody;
}

interface SuccessBody {
  ok: true;
  data: Readonly<Record<string, unknown>>;
  meta: Readonly<Record<string, unknown>>;
  requestId: string;
}

interface FailureBody {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  requestId: string;
}

export interface HttpApp {
  handle(request: unknown): Promise<HttpResponse>;
}

export interface HttpAppDependencies {
  idGenerator: IdGeneratorPort;
  repository: RepositoryPort;
  workerRuntime: WorkerRuntimePort;
}

export function createHttpApp(dependencies: HttpAppDependencies): HttpApp {
  return {
    async handle(request: unknown): Promise<HttpResponse> {
      const requestId = dependencies.idGenerator.generate();

      if (!isHttpRequest(request)) {
        return failure(400, requestId, 'INVALID_REQUEST', 'Invalid request');
      }

      const routeExists = request.path === '/api/v1/health' || request.path === '/api/v1/ready';

      if (!routeExists) {
        return failure(404, requestId, 'ROUTE_NOT_FOUND', 'Route not found');
      }

      if (request.method !== 'GET') {
        return failure(405, requestId, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      }

      if (request.path === '/api/v1/health') {
        return success(requestId, { status: 'healthy' });
      }

      try {
        const [repositoryReady, workerRuntimeReady] = await Promise.all([
          dependencies.repository.isReady(),
          dependencies.workerRuntime.isReady(),
        ]);

        if (!repositoryReady || !workerRuntimeReady) {
          return failure(503, requestId, 'APPLICATION_NOT_READY', 'Application not ready', true);
        }

        return success(requestId, { status: 'ready' });
      } catch {
        return failure(503, requestId, 'READINESS_CHECK_FAILED', 'Readiness check failed', true);
      }
    },
  };
}

function isHttpRequest(request: unknown): request is HttpRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return false;
  const candidate = request as Record<string, unknown>;
  return typeof candidate.method === 'string' && typeof candidate.path === 'string';
}

function success(requestId: string, data: Readonly<Record<string, unknown>>): HttpResponse {
  return { status: 200, body: { ok: true, data, meta: {}, requestId } };
}

function failure(
  status: number,
  requestId: string,
  code: string,
  message: string,
  retryable = false,
): HttpResponse {
  return { status, body: { ok: false, error: { code, message, retryable }, requestId } };
}
