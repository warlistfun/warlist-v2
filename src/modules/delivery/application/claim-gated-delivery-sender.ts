import {
  RepositoryError,
  type DeliveryClaimRecord,
  type DeliveryClaimRepositoryPort,
} from '../../../app/business-repository';

export type DeliveryClaimAuthority = Readonly<{
  operationId: string;
  attemptId: string;
  claimFence: number;
  claimOwner: string;
  leaseUntil: string;
  workerGeneration: number;
  childId: string;
}>;

export type AcceptedDeliverySend = Readonly<{
  decisionCode: 'ACCEPTED';
  correlationId: string;
  tenantId: string;
  operationId: string;
  workerGeneration: number;
  childId: string;
  target: string;
  text: string;
}>;

export type CorrelatedDeliverySend = Readonly<{
  correlationId: string;
  tenantId: string;
  operationId: string;
  attemptId: string;
  claimFence: number;
  workerGeneration: number;
  childId: string;
  target: string;
  text: string;
}>;

export type DeliveryProviderIdentity = Readonly<{ providerMessageId: string }>;

export type DeliverySentCompletion = Readonly<{
  outcome: 'SENT';
  tenantId: string;
  operationId: string;
  attemptId: string;
  claimFence: number;
  workerGeneration: number;
  childId: string;
  providerMessageId: string;
}>;

type DeliveryOutcome = 'SENT' | 'AMBIGUOUS';

type DeliverySettlement = DeliveryClaimAuthority &
  Readonly<{ outcome: DeliveryOutcome; providerMessageId?: string }>;

type SenderDependencies = Readonly<{
  claim: (
    input: Readonly<{ operationId: string; workerGeneration: number; childId: string }>,
  ) => Promise<DeliveryClaimRecord>;
  begin: (authority: DeliveryClaimAuthority) => Promise<void>;
  sender: (authority: DeliveryClaimAuthority) => Promise<DeliveryProviderIdentity>;
  settle: (input: DeliverySettlement) => Promise<unknown>;
}>;

type DeliverySettlementPort = (input: DeliverySettlement) => Promise<DeliveryClaimRecord>;

export function createDeliveryBeginPort(dependencies: {
  readonly repository: DeliveryClaimRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
}): SenderDependencies['begin'] {
  return (input) =>
    dependencies.repository
      .beginDelivery({ tenantId: dependencies.trustedTenant.tenantId, ...input })
      .then(() => undefined);
}

export function createDeliverySettlementPort(dependencies: {
  readonly repository: DeliveryClaimRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
}): DeliverySettlementPort {
  return (input) =>
    dependencies.repository.settleDelivery({
      tenantId: dependencies.trustedTenant.tenantId,
      operationId: input.operationId,
      attemptId: input.attemptId,
      claimFence: input.claimFence,
      claimOwner: input.claimOwner,
      leaseUntil: input.leaseUntil,
      workerGeneration: input.workerGeneration,
      childId: input.childId,
      outcome: input.outcome,
      providerMessageId: input.providerMessageId ?? null,
    });
}

export function createAcceptedClaimGatedDeliverySender(dependencies: {
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly claim: SenderDependencies['claim'];
  readonly begin: SenderDependencies['begin'];
  readonly sender: (input: CorrelatedDeliverySend) => Promise<DeliveryProviderIdentity>;
  readonly settle: DeliverySettlementPort;
}): Readonly<{ send(input: AcceptedDeliverySend): Promise<DeliverySentCompletion> }> {
  return Object.freeze({
    async send(input): Promise<DeliverySentCompletion> {
      if (!isAcceptedDeliverySend(input, dependencies.trustedTenant.tenantId)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const claim = await dependencies.claim(input);
      const authority: DeliveryClaimAuthority = {
        operationId: claim.operation.id,
        attemptId: claim.attempt.id,
        claimFence: claim.operation.claimFence,
        claimOwner: claim.operation.claimOwner ?? '',
        leaseUntil: claim.operation.leaseUntil ?? '',
        workerGeneration: claim.operation.workerGeneration ?? 0,
        childId: claim.operation.childId ?? '',
      };
      if (claim.operation.status === 'SENT' && claim.attempt.status === 'SENT') {
        if (
          authority.operationId !== input.operationId ||
          authority.workerGeneration !== input.workerGeneration ||
          authority.childId !== input.childId ||
          claim.attempt.providerMessageId === null
        ) {
          throw new RepositoryError('DATABASE_ROW_INVALID');
        }
        return sentCompletion(
          claim,
          dependencies.trustedTenant.tenantId,
          authority,
          claim.attempt.providerMessageId,
        );
      }
      if (
        claim.operation.tenantId !== dependencies.trustedTenant.tenantId ||
        claim.attempt.tenantId !== dependencies.trustedTenant.tenantId ||
        claim.operation.status !== 'CLAIMED' ||
        claim.attempt.status !== 'PREPARED' ||
        claim.attempt.operationId !== authority.operationId ||
        claim.attempt.id !== authority.attemptId ||
        authority.operationId !== input.operationId ||
        authority.claimFence !== claim.attempt.claimFence ||
        authority.claimOwner === '' ||
        authority.leaseUntil === '' ||
        authority.workerGeneration !== input.workerGeneration ||
        authority.childId !== input.childId
      ) {
        throw new RepositoryError('DELIVERY_CLAIM_CONFLICT');
      }
      await dependencies.begin(authority);
      const sent = await dependencies.sender(
        Object.freeze({
          correlationId: input.correlationId,
          tenantId: input.tenantId,
          operationId: authority.operationId,
          attemptId: authority.attemptId,
          claimFence: authority.claimFence,
          workerGeneration: authority.workerGeneration,
          childId: authority.childId,
          target: input.target,
          text: input.text,
        }),
      );
      if (!isIdentifier(sent.providerMessageId)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const settled = await dependencies.settle({
        ...authority,
        outcome: 'SENT',
        providerMessageId: sent.providerMessageId,
      });
      return sentCompletion(
        settled,
        dependencies.trustedTenant.tenantId,
        authority,
        sent.providerMessageId,
      );
    },
  });
}

function sentCompletion(
  settled: DeliveryClaimRecord,
  tenantId: string,
  authority: DeliveryClaimAuthority,
  providerMessageId: string,
): DeliverySentCompletion {
  if (
    settled.operation.tenantId !== tenantId ||
    settled.attempt.tenantId !== tenantId ||
    settled.operation.id !== authority.operationId ||
    settled.attempt.operationId !== authority.operationId ||
    settled.attempt.id !== authority.attemptId ||
    settled.operation.status !== 'SENT' ||
    settled.attempt.status !== 'SENT' ||
    settled.operation.claimFence !== authority.claimFence ||
    settled.attempt.claimFence !== authority.claimFence ||
    settled.operation.claimOwner !== authority.claimOwner ||
    settled.operation.leaseUntil !== authority.leaseUntil ||
    settled.operation.workerGeneration !== authority.workerGeneration ||
    settled.operation.childId !== authority.childId ||
    settled.attempt.providerMessageId !== providerMessageId
  ) {
    throw new RepositoryError('DATABASE_ROW_INVALID');
  }
  return Object.freeze({
    outcome: 'SENT',
    tenantId,
    operationId: authority.operationId,
    attemptId: authority.attemptId,
    claimFence: authority.claimFence,
    workerGeneration: authority.workerGeneration,
    childId: authority.childId,
    providerMessageId,
  });
}

function isAcceptedDeliverySend(input: unknown, tenantId: string): input is AcceptedDeliverySend {
  if (
    !isExactRecord(input, [
      'decisionCode',
      'correlationId',
      'tenantId',
      'operationId',
      'workerGeneration',
      'childId',
      'target',
      'text',
    ])
  ) {
    return false;
  }
  return (
    input.decisionCode === 'ACCEPTED' &&
    input.tenantId === tenantId &&
    isUuid(input.tenantId) &&
    isUuid(input.operationId) &&
    isIdentifier(input.correlationId) &&
    Number.isSafeInteger(input.workerGeneration) &&
    (input.workerGeneration as number) > 0 &&
    isIdentifier(input.childId) &&
    isIdentifier(input.target) &&
    isText(input.text)
  );
}

function isExactRecord(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  if (Object.getPrototypeOf(input) !== Object.prototype) return false;
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string'))
    return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,160}$/.test(value);
}

function isText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value === value.trim() &&
    !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  );
}

export function createClaimGatedDeliverySender(dependencies: SenderDependencies): Readonly<{
  send(
    input: Readonly<{ operationId: string; workerGeneration: number; childId: string }>,
  ): Promise<void>;
}> {
  return Object.freeze({
    async send(input): Promise<void> {
      const claim = await dependencies.claim(input);
      const authority: DeliveryClaimAuthority = {
        operationId: claim.operation.id,
        attemptId: claim.attempt.id,
        claimFence: claim.operation.claimFence,
        claimOwner: claim.operation.claimOwner ?? '',
        leaseUntil: claim.operation.leaseUntil ?? '',
        workerGeneration: claim.operation.workerGeneration ?? 0,
        childId: claim.operation.childId ?? '',
      };
      if (
        authority.operationId !== input.operationId ||
        authority.claimFence !== claim.attempt.claimFence ||
        authority.claimOwner === '' ||
        authority.leaseUntil === '' ||
        authority.workerGeneration !== input.workerGeneration ||
        authority.childId !== input.childId
      ) {
        throw new RepositoryError('DELIVERY_CLAIM_CONFLICT');
      }
      await dependencies.begin(authority);
      try {
        const sent = await dependencies.sender(authority);
        await dependencies.settle({
          ...authority,
          outcome: 'SENT',
          providerMessageId: sent.providerMessageId,
        });
      } catch (error) {
        await dependencies.settle({ ...authority, outcome: 'AMBIGUOUS' }).catch(() => undefined);
        throw error;
      }
    },
  });
}
