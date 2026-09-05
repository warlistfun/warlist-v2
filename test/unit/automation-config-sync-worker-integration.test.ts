import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import type { ChildMessage, ParentMessage } from '../../src/interfaces/worker-ipc/contract';
import { createAutomationConfigSyncDispatcher } from '../../src/modules/automation/application/automation-config-sync-dispatcher';
import { createActiveTenantWorkerService } from '../../src/modules/whatsapp/application/active-tenant-worker-service';
import { createWorkerDiagnosticsService } from '../../src/modules/whatsapp/application/worker-diagnostics-service';
import { createWorkerOwnershipService } from '../../src/modules/whatsapp/application/worker-ownership-service';
import {
  createWorkerRuntimeService,
  type CancelScheduledTask,
  type ScheduleTaskPort,
  type WorkerCommandTransportPort,
} from '../../src/modules/whatsapp/application/worker-runtime-service';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { FixedClock, SequenceIdGenerator } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000702';

void test('propagates a claimed revision through fenced IPC APPLY_CONFIG before marking it applied', async () => {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_worker_sync' });
  await repository.compareAndSaveConfig(
    { tenantId, configuration: { automation: { enabled: false } } },
    null,
  );
  const committed = await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    1,
  );

  const transport = new ManualTransport();
  const runtime = createWorkerRuntimeService({
    transport,
    scheduler: new ManualScheduler(),
    idGenerator: new SequenceIdGenerator('request'),
    commandTimeoutMs: 5_000,
    diagnostics: createWorkerDiagnosticsService({ sink: { record() {} } }),
  });
  await runtime.start();
  const ownership = createWorkerOwnershipService({
    commands: runtime,
    diagnostics: createWorkerDiagnosticsService({ sink: { record() {} } }),
  });
  const workers = createActiveTenantWorkerService({ lifecycle: ownership });

  const boot = workers.bootActiveTenants([
    {
      tenantId,
      childId: 'child_example_sync',
      correlationId: 'correlation_example_start',
      configVersion: 1,
    },
  ]);
  await flush();
  transport.acknowledge(transport.sent[0]!);
  await boot;

  const dispatcher = createAutomationConfigSyncDispatcher({
    repository,
    worker: workers,
    clock: new FixedClock(new Date('2026-08-21T12:00:00.000Z')),
    idGenerator: new SequenceIdGenerator('sync'),
  });
  const dispatch = dispatcher.dispatchOne();
  await flush();

  const apply = transport.sent[1]!;
  assert.deepEqual(
    {
      type: apply.type,
      tenantId: apply.tenantId,
      generation: apply.generation,
      childId: apply.childId,
      correlationId: apply.correlationId,
      payload: apply.payload,
    },
    {
      type: 'APPLY_CONFIG',
      tenantId,
      generation: 1,
      childId: 'child_example_sync',
      correlationId: 'sync-1',
      payload: { configVersion: committed.config.revision },
    },
  );
  assert.equal(JSON.stringify(apply).includes('automation'), false);

  transport.acknowledge(apply);
  assert.equal((await dispatch)?.status, 'APPLIED');
  await runtime.stop();
  await repository.stop();
});

void test('child exit fences a pending config acknowledgement before durable apply', async () => {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_exit_fence' });
  await repository.compareAndSaveConfig(
    { tenantId, configuration: { automation: { enabled: false } } },
    null,
  );
  await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    1,
  );

  const transport = new ManualTransport();
  const runtime = createWorkerRuntimeService({
    transport,
    scheduler: new ManualScheduler(),
    idGenerator: new SequenceIdGenerator('request'),
    commandTimeoutMs: 5_000,
    diagnostics: createWorkerDiagnosticsService({ sink: { record() {} } }),
  });
  await runtime.start();
  const ownership = createWorkerOwnershipService({
    commands: runtime,
    diagnostics: createWorkerDiagnosticsService({ sink: { record() {} } }),
  });
  const workers = createActiveTenantWorkerService({ lifecycle: ownership });
  const boot = workers.bootActiveTenants([
    {
      tenantId,
      childId: 'child_example_sync',
      correlationId: 'correlation_example_start',
      configVersion: 1,
    },
  ]);
  await flush();
  transport.acknowledge(transport.sent[0]!);
  await boot;

  const dispatch = createAutomationConfigSyncDispatcher({
    repository,
    worker: workers,
    clock: new FixedClock(new Date('2026-08-21T12:00:00.000Z')),
    idGenerator: new SequenceIdGenerator('sync'),
  }).dispatchOne();
  await flush();
  const apply = transport.sent[1]!;

  ownership.recordChildExit(tenantId, 1, 'child_example_sync', 'correlation_example_start');
  transport.acknowledge(apply);

  const result = await dispatch;
  assert.equal(result?.status, 'RETRYABLE_FAILURE');
  assert.equal(result?.failureCode, 'WORKER_CHILD_EXITED');
  await runtime.stop();
  await repository.stop();
});

class ManualScheduler implements ScheduleTaskPort {
  schedule(delayMs: number, task: () => void): CancelScheduledTask {
    void delayMs;
    void task;
    return () => undefined;
  }
}

class ManualTransport implements WorkerCommandTransportPort {
  readonly sent: ParentMessage[] = [];
  private handler: ((message: unknown) => void) | undefined;

  start(handler: (message: unknown) => void): Promise<void> {
    this.handler = handler;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.handler = undefined;
    return Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.handler !== undefined);
  }

  send(message: ParentMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  acknowledge(message: ParentMessage): void {
    if (message.type === 'SEND_DELIVERY')
      throw new Error('delivery has a result, not acknowledgement');
    assert.ok(this.handler);
    const payload =
      message.type === 'REQUEST_PAIRING' ||
      message.type === 'STOP_WORKER' ||
      message.type === 'RESET_WORKER'
        ? { commandType: message.type }
        : { commandType: message.type, configVersion: message.payload.configVersion };
    const ack: ChildMessage = {
      protocolVersion: message.protocolVersion,
      requestId: message.requestId,
      correlationId: message.correlationId,
      tenantId: message.tenantId,
      generation: message.generation,
      childId: message.childId,
      type: 'COMMAND_ACK',
      payload,
    };
    this.handler(ack);
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
