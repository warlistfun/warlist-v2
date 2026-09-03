import { randomUUID } from 'node:crypto';
import {
  RepositoryError,
  type BusinessRepositoryPort,
  type DeliveryRecord,
} from '../../../app/business-repository';
import {
  evaluateAutomation,
  type AutomationDecision,
  type AutomationEvaluationState,
} from './automation-evaluator';
import { normalizeSyntheticInboundMessage } from './inbound-message-normalizer';
import { extractScheduledStartAt } from './scheduled-start-extractor';

export interface AutomationDecisionStatePort {
  load(
    input: Readonly<{
      tenantId: string;
      messageId: string;
      message: unknown;
    }>,
  ): Promise<AutomationEvaluationState & Readonly<{ delivery?: DeliveryRecord | undefined }>>;
}

export function createActiveAutomationDecisionService(dependencies: {
  readonly repository: Pick<BusinessRepositoryPort, 'loadConfig' | 'prepareDelivery'>;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly state: AutomationDecisionStatePort;
}): Readonly<{
  decide(
    input: Readonly<{ messageId: string; message: unknown }>,
    currentMinute?: unknown,
  ): Promise<
    Readonly<{
      revision: number;
      decision: AutomationDecision;
      operation?: DeliveryRecord;
    }>
  >;
}> {
  return Object.freeze({
    async decide(input, currentMinute) {
      const config = await dependencies.repository.loadConfig(dependencies.trustedTenant.tenantId);
      if (!config) throw new RepositoryError('CONFIG_VERSION_CONFLICT');
      const normalized = normalizeSyntheticInboundMessage(input.message);
      const policy = config.configuration.automation;
      const initial = evaluateAutomation(normalized, policy, currentMinute);
      if (initial.code !== 'ACCEPTED') {
        return Object.freeze({ revision: config.revision, decision: initial });
      }
      const state = await dependencies.state.load({
        tenantId: dependencies.trustedTenant.tenantId,
        messageId: input.messageId,
        message: normalized,
      });
      const decision = evaluateAutomation(normalized, policy, currentMinute, {
        hasEntitlement: state.hasEntitlement,
        duplicateMessage: state.duplicateMessage,
        deliveryExists: state.deliveryExists,
      });
      const operation =
        decision.code === 'ACCEPTED'
          ? await dependencies.repository.prepareDelivery({
              id: randomUUID(),
              tenantId: dependencies.trustedTenant.tenantId,
              operationKey: `automation:${input.messageId}`,
              scheduledStartAt: extractScheduledStartAt(normalized.text),
            })
          : decision.code === 'DELIVERY_ALREADY_EXISTS'
            ? state.delivery
            : undefined;
      return Object.freeze(
        operation === undefined
          ? { revision: config.revision, decision }
          : { revision: config.revision, decision, operation },
      );
    },
  });
}
