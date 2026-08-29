import { fork } from 'node:child_process';
import { isAbsolute } from 'node:path';

import {
  decodeChildMessage,
  decodeParentMessage,
  type ChildMessage,
  type ParentMessage,
} from '../../../interfaces/worker-ipc/contract';
import type { WorkerCommandTransportPort } from '../application/worker-runtime-service';

export interface WorkerChildProcessPort {
  readonly connected: boolean;
  on(event: 'message' | 'exit' | 'error', listener: (...arguments_: unknown[]) => void): this;
  off(event: 'message' | 'exit' | 'error', listener: (...arguments_: unknown[]) => void): this;
  send(message: ParentMessage, callback: (error: Error | null) => void): boolean;
  disconnect(): void;
  kill(): boolean;
}

export type SpawnWorkerChildPort = (
  modulePath: string,
  arguments_: readonly string[],
) => WorkerChildProcessPort;

interface ActiveChild {
  readonly process: WorkerChildProcessPort;
  readonly start: Extract<ParentMessage, { type: 'START_WORKER' }>;
  readonly onMessage: (...arguments_: unknown[]) => void;
  readonly onExit: (...arguments_: unknown[]) => void;
  readonly onError: (...arguments_: unknown[]) => void;
  lastCommand: ParentMessage;
}

export function createNodeWorkerCommandTransport(dependencies: {
  readonly modulePath: string;
  readonly credentialRoot: string;
  readonly spawn?: SpawnWorkerChildPort;
  readonly onChildExit?: (
    identity: Readonly<{
      tenantId: string;
      generation: number;
      childId: string;
      correlationId: string;
    }>,
  ) => void;
}): WorkerCommandTransportPort {
  if (!isAbsolute(dependencies.modulePath) || !isAbsolute(dependencies.credentialRoot)) {
    throw new Error('Worker module and credential root must be absolute paths');
  }

  const spawn = dependencies.spawn ?? defaultSpawn;
  let ready = false;
  let handler: ((message: unknown) => void) | undefined;
  const active = new Map<string, ActiveChild>();

  function detach(child: ActiveChild): void {
    child.process.off('message', child.onMessage);
    child.process.off('exit', child.onExit);
    child.process.off('error', child.onError);
    if (active.get(child.start.tenantId) === child) active.delete(child.start.tenantId);
  }

  function unavailable(child: ActiveChild): void {
    if (active.get(child.start.tenantId) !== child) return;
    detach(child);
    dependencies.onChildExit?.({
      tenantId: child.start.tenantId,
      generation: child.start.generation,
      childId: child.start.childId,
      correlationId:
        child.lastCommand.type === 'STOP_WORKER'
          ? child.lastCommand.correlationId
          : child.start.correlationId,
    });
    handler?.(commandError(child.lastCommand));
  }

  function spawnChild(message: Extract<ParentMessage, { type: 'START_WORKER' }>): ActiveChild {
    const process = spawn(dependencies.modulePath, [dependencies.credentialRoot]);
    const child: ActiveChild = {
      process,
      start: message,
      lastCommand: message,
      onMessage(input?: unknown): void {
        if (active.get(child.start.tenantId) !== child) return;
        let decoded: ChildMessage;
        try {
          decoded = decodeChildMessage(input);
        } catch {
          return;
        }
        if (
          (decoded.type === 'CONNECTION_UPDATE' ||
            decoded.type === 'PAIRING_UPDATE' ||
            decoded.type === 'INBOUND_EVENT') &&
          !sameIdentity(child.start, decoded)
        ) {
          return;
        }
        handler?.(decoded);
        if (
          decoded.type === 'COMMAND_ACK' &&
          (decoded.payload.commandType === 'STOP_WORKER' ||
            decoded.payload.commandType === 'RESET_WORKER') &&
          matchesCommand(child.lastCommand, decoded)
        ) {
          detach(child);
          if (process.connected) process.disconnect();
        }
      },
      onExit(): void {
        unavailable(child);
      },
      onError(): void {
        if (active.get(child.start.tenantId) !== child) return;
        handler?.(commandError(child.lastCommand));
        child.process.kill();
      },
    };
    process.on('message', child.onMessage);
    process.on('exit', child.onExit);
    process.on('error', child.onError);
    active.set(message.tenantId, child);
    return child;
  }

  function sendToChild(child: ActiveChild, message: ParentMessage): Promise<void> {
    child.lastCommand = message;
    return new Promise<void>((resolve, reject) => {
      try {
        child.process.send(message, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(asError(error));
      }
    });
  }

  return {
    start(nextHandler, signal): Promise<void> {
      if (signal.aborted) return Promise.reject(new Error('Worker transport start aborted'));
      handler = nextHandler;
      ready = true;
      return Promise.resolve();
    },
    stop(signal): Promise<void> {
      ready = false;
      handler = undefined;
      return Promise.all(
        [...active.values()].map(
          (child) =>
            new Promise<void>((resolve) => {
              const complete = (): void => {
                signal.removeEventListener('abort', abort);
                child.process.off('exit', complete);
                detach(child);
                resolve();
              };
              const abort = (): void => {
                child.process.kill();
              };
              signal.addEventListener('abort', abort, { once: true });
              child.process.on('exit', complete);
              if (child.process.connected) child.process.disconnect();
              else child.process.kill();
            }),
        ),
      ).then(() => undefined);
    },
    isReady(): Promise<boolean> {
      return Promise.resolve(ready);
    },
    send(input): Promise<void> {
      if (!ready) return Promise.reject(new Error('Worker transport is stopped'));
      let message: ParentMessage;
      try {
        message = decodeParentMessage(input);
      } catch (error) {
        return Promise.reject(asError(error));
      }

      if (message.type === 'START_WORKER') {
        if (active.has(message.tenantId)) {
          return Promise.reject(new Error('Worker child is already active'));
        }
        return sendToChild(spawnChild(message), message);
      }
      const child = active.get(message.tenantId);
      if (!child || !sameWorker(child.start, message)) {
        return Promise.reject(new Error('Worker child identity does not match'));
      }
      return sendToChild(child, message);
    },
  };
}

function defaultSpawn(modulePath: string, arguments_: readonly string[]): WorkerChildProcessPort {
  return fork(modulePath, [...arguments_], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
}

function sameWorker(start: ParentMessage, message: ParentMessage): boolean {
  return (
    start.tenantId === message.tenantId &&
    start.generation === message.generation &&
    start.childId === message.childId
  );
}

function sameIdentity(parent: ParentMessage, child: ChildMessage): boolean {
  return (
    parent.protocolVersion === child.protocolVersion &&
    parent.requestId === child.requestId &&
    parent.correlationId === child.correlationId &&
    parent.tenantId === child.tenantId &&
    parent.generation === child.generation &&
    parent.childId === child.childId
  );
}

function matchesCommand(
  parent: ParentMessage,
  child: Extract<ChildMessage, { type: 'COMMAND_ACK' | 'COMMAND_ERROR' }>,
): boolean {
  return sameIdentity(parent, child) && parent.type === child.payload.commandType;
}

function commandError(message: ParentMessage): ChildMessage {
  return {
    protocolVersion: message.protocolVersion,
    requestId: message.requestId,
    correlationId: message.correlationId,
    tenantId: message.tenantId,
    generation: message.generation,
    childId: message.childId,
    type: 'COMMAND_ERROR',
    payload: {
      commandType: message.type,
      error: {
        code: 'WA_RUNTIME_UNAVAILABLE',
        message: 'Worker runtime is unavailable',
        retryable: true,
      },
    },
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Worker child process failed');
}
