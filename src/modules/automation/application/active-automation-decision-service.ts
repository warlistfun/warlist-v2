import { RepositoryError, type BusinessRepositoryPort } from '../../../app/business-repository';
import {
  evaluateAutomation,
  type AutomationDecision,
  type AutomationEvaluationState,
} from './automation-evaluator';
import { normalizeSyntheticInboundMessage } from './inbound-message-normalizer';

export interface AutomationDecisionStatePort {
  load(input: Readonly<{ tenantId: string; message: unknown }>): Promise<AutomationEvaluationState>;
}

export function createActiveAutomationDecisionService(dependencies: {
  readonly repository: BusinessRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly state: AutomationDecisionStatePort;
}): Readonly<{
  decide(
    message: unknown,
    currentMinute?: unknown,
  ): Promise<
    Readonly<{
      revision: number;
      decision: AutomationDecision;
    }>
  >;
}> {
  return Object.freeze({
    async decide(message, currentMinute) {
      const config = await dependencies.repository.loadConfig(dependencies.trustedTenant.tenantId);
      if (!config) throw new RepositoryError('CONFIG_VERSION_CONFLICT');
      const normalized = normalizeSyntheticInboundMessage(message);
      const policy = config.configuration.automation;
      const initial = evaluateAutomation(normalized, policy, currentMinute);
      if (initial.code !== 'ACCEPTED') {
        return Object.freeze({ revision: config.revision, decision: initial });
      }
      const state = await dependencies.state.load({
        tenantId: dependencies.trustedTenant.tenantId,
        message: normalized,
      });
      const decision = evaluateAutomation(normalized, policy, currentMinute, state);
      return Object.freeze({ revision: config.revision, decision });
    },
  });
}
