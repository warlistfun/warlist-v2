export class CredentialPortError extends Error {
  constructor(readonly code: 'CREDENTIAL_ROLLOUT_DISABLED') {
    super('Credential rollout is disabled');
    this.name = 'CredentialPortError';
  }
}

export interface CredentialPort {
  enrollPin(input: unknown): Promise<never>;
  verifyPin(input: unknown): Promise<never>;
  enrollPasskey(input: unknown): Promise<never>;
  verifyPasskey(input: unknown): Promise<never>;
}

export function createDisabledCredentialPort(): CredentialPort {
  const reject = (): Promise<never> =>
    Promise.reject(new CredentialPortError('CREDENTIAL_ROLLOUT_DISABLED'));

  // ponytail: Disabled seam only; add validated credential-specific ports after rollout approval.
  return Object.freeze({
    enrollPin: reject,
    verifyPin: reject,
    enrollPasskey: reject,
    verifyPasskey: reject,
  });
}
