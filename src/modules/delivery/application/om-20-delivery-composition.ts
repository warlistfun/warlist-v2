import { RepositoryError } from '../../../app/business-repository';
import type { WorkerInboundMessage } from '../../../interfaces/worker-ipc/contract';
import type { AutomationDecision } from '../../automation/application/automation-evaluator';

interface DeliveryAuthority {
  readonly id: string;
  readonly claimFence: number;
  readonly claimOwner: string | null;
  readonly leaseUntil: string | null;
  readonly workerGeneration: number | null;
  readonly childId: string | null;
}

interface DecisionResult {
  readonly revision: number;
  readonly decision: AutomationDecision;
  readonly operation?: Readonly<{
    id: string;
    status: 'PREPARED' | 'CLAIMED' | 'SENDING' | 'SENT' | 'AMBIGUOUS' | 'CONFIRMED';
  }>;
}

interface AdmissionResult {
  readonly operationId: string;
  readonly attemptId: string;
  readonly confirmedAt: string;
}

interface ConfirmationResult {
  readonly operation: Readonly<{
    id: string;
    status: string;
    scheduledStartAt?: string | null;
  }>;
  readonly confirmedAt?: string;
}

type Input = Readonly<{
  tenantId: string;
  messageId: string;
  correlationId: string;
  workerGeneration: number;
  childId: string;
  message: WorkerInboundMessage;
}>;

export type Om20InboundResult =
  | Readonly<{ code: AutomationDecision['code']; revision: number; delivery?: unknown }>
  | Readonly<{
      code: 'CONFIRMED';
      confirmedAt: string;
      scheduledStartAt: string | null;
    }>;

export function createOm20DeliveryComposition(dependencies: {
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly repository: Readonly<{
    loadTenant(
      tenantId: string,
    ): Promise<Readonly<{ id: string; publicOpsId: string; status: string }> | undefined>;
    loadConfig(
      tenantId: string,
    ): Promise<Readonly<{ revision: number; configuration: unknown }> | undefined>;
    loadDelivery(tenantId: string, operationId: string): Promise<DeliveryAuthority | undefined>;
  }>;
  readonly decision: Readonly<{
    decide(
      input: Readonly<{ messageId: string; message: WorkerInboundMessage }>,
    ): Promise<DecisionResult>;
  }>;
  readonly delivery: Readonly<{ send(input: Readonly<Record<string, unknown>>): Promise<unknown> }>;
  readonly admission: Readonly<{ admit(input: unknown): Promise<AdmissionResult> }>;
  readonly confirmation: Readonly<{ confirm(input: unknown): Promise<ConfirmationResult> }>;
}): Readonly<{ handle(input: Input): Promise<Om20InboundResult> }> {
  return Object.freeze({
    async handle(input) {
      if (input.tenantId !== dependencies.trustedTenant.tenantId) {
        throw new RepositoryError('TENANT_ACCESS_DENIED');
      }
      const [tenant, config] = await Promise.all([
        dependencies.repository.loadTenant(input.tenantId),
        dependencies.repository.loadConfig(input.tenantId),
      ]);
      if (!tenant || tenant.id !== input.tenantId || tenant.status !== 'ACTIVE' || !config) {
        throw new RepositoryError('DATABASE_ROW_INVALID');
      }
      const policy = confirmationPolicy(config.configuration);
      if (
        policy &&
        input.message.groupId === policy.targetGroupId &&
        policy.adminIds.includes(input.message.senderId) &&
        containsOpsId(input.message.text, tenant.publicOpsId)
      ) {
        const admitted = await dependencies.admission.admit({
          tenantId: input.tenantId,
          confirmationMessageId: input.messageId,
          publicOpsId: tenant.publicOpsId,
          workerGeneration: input.workerGeneration,
          childId: input.childId,
        });
        const operation = await dependencies.repository.loadDelivery(
          input.tenantId,
          admitted.operationId,
        );
        if (!operation || operation.claimOwner === null || operation.leaseUntil === null) {
          throw new RepositoryError('DELIVERY_CLAIM_CONFLICT');
        }
        const confirmation = await dependencies.confirmation.confirm({
          operationId: operation.id,
          attemptId: admitted.attemptId,
          claimFence: operation.claimFence,
          claimOwner: operation.claimOwner,
          leaseUntil: operation.leaseUntil,
          workerGeneration: input.workerGeneration,
          childId: input.childId,
        });
        return Object.freeze({
          code: 'CONFIRMED',
          confirmedAt: admitted.confirmedAt,
          scheduledStartAt: confirmation.operation.scheduledStartAt ?? null,
        });
      }

      const decision = await dependencies.decision.decide({
        messageId: input.messageId,
        message: input.message,
      });
      if (
        (decision.decision.code !== 'ACCEPTED' &&
          decision.decision.code !== 'DELIVERY_ALREADY_EXISTS') ||
        !decision.operation
      ) {
        return Object.freeze({ code: decision.decision.code, revision: decision.revision });
      }
      if (
        decision.decision.code === 'DELIVERY_ALREADY_EXISTS' &&
        decision.operation.status !== 'PREPARED' &&
        decision.operation.status !== 'CLAIMED' &&
        decision.operation.status !== 'SENDING'
      ) {
        return Object.freeze({ code: decision.decision.code, revision: decision.revision });
      }
      const delivery = await dependencies.delivery.send({
        decisionCode: 'ACCEPTED',
        correlationId: input.correlationId,
        tenantId: input.tenantId,
        operationId: decision.operation.id,
        workerGeneration: input.workerGeneration,
        childId: input.childId,
        target: input.message.groupId,
        text: `OPS ${tenant.publicOpsId}`,
      });
      return Object.freeze({ code: 'ACCEPTED', revision: decision.revision, delivery });
    },
  });
}

function confirmationPolicy(
  configuration: unknown,
): Readonly<{ targetGroupId: string; adminIds: readonly string[] }> | undefined {
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration))
    return undefined;
  const automation = (configuration as Record<string, unknown>).automation;
  if (typeof automation !== 'object' || automation === null || Array.isArray(automation))
    return undefined;
  const policy = automation as Record<string, unknown>;
  return typeof policy.targetGroupId === 'string' &&
    Array.isArray(policy.adminIds) &&
    policy.adminIds.every((id) => typeof id === 'string')
    ? { targetGroupId: policy.targetGroupId, adminIds: policy.adminIds }
    : undefined;
}

function containsOpsId(text: string, publicOpsId: string): boolean {
  return text
    .toLocaleLowerCase('en-US')
    .split(/[^a-z0-9_]+/u)
    .includes(publicOpsId);
}
