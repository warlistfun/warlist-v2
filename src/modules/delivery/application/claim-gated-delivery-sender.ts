import {
  RepositoryError,
  type DeliveryClaimRecord,
  type DeliveryClaimRepositoryPort,
} from '../../../app/business-repository';

export type DeliveryClaimAuthority = Readonly<{
  operationId: string;
  attemptId: string;
  claimFence: number;
  workerGeneration: number;
  childId: string;
}>;

type DeliveryOutcome = 'SENT' | 'AMBIGUOUS';

type DeliverySettlement = DeliveryClaimAuthority &
  Readonly<{ outcome: DeliveryOutcome; providerMessageId?: string }>;

type SenderDependencies = Readonly<{
  claim: (
    input: Readonly<{ operationId: string; workerGeneration: number; childId: string }>,
  ) => Promise<DeliveryClaimRecord>;
  begin: (authority: DeliveryClaimAuthority) => Promise<void>;
  sender: (authority: DeliveryClaimAuthority) => Promise<Readonly<{ providerMessageId: string }>>;
  settle: (input: DeliverySettlement) => Promise<void>;
}>;

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
}): SenderDependencies['settle'] {
  return (input) =>
    dependencies.repository
      .settleDelivery({
        tenantId: dependencies.trustedTenant.tenantId,
        operationId: input.operationId,
        attemptId: input.attemptId,
        claimFence: input.claimFence,
        workerGeneration: input.workerGeneration,
        childId: input.childId,
        outcome: input.outcome,
        providerMessageId: input.providerMessageId ?? null,
      })
      .then(() => undefined);
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
        workerGeneration: claim.operation.workerGeneration ?? 0,
        childId: claim.operation.childId ?? '',
      };
      if (
        authority.operationId !== input.operationId ||
        authority.claimFence !== claim.attempt.claimFence ||
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
