import { runAutomationSimulation } from '../../../debug-automation';

import type { CommittedAutomationConfig } from './automation-config-mutation-service';
import type { AutomationDecision } from './automation-evaluator';

export type ActiveAutomationSliceResult = Readonly<{
  revision: number;
  policy: CommittedAutomationConfig['policy'];
  decision: AutomationDecision;
}>;

export function simulateCommittedAutomation(
  committed: CommittedAutomationConfig,
  message: unknown,
): ActiveAutomationSliceResult {
  const decision = runAutomationSimulation({ message, policy: committed.policy });
  return Object.freeze({ revision: committed.revision, policy: committed.policy, decision });
}
