import type { RepositoryPort } from './ports';

export class DatabaseSendAdmissionError extends Error {
  constructor() {
    super('Database is unavailable for external send admission');
    this.name = 'DatabaseSendAdmissionError';
  }
}

export interface DatabaseSendAdmissionPort {
  admit<T>(send: () => Promise<T>): Promise<T>;
}

export function createDatabaseSendAdmission(dependencies: {
  readonly repository: RepositoryPort;
}): DatabaseSendAdmissionPort {
  return Object.freeze({
    async admit<T>(send: () => Promise<T>): Promise<T> {
      try {
        if (!(await dependencies.repository.isReady())) throw new DatabaseSendAdmissionError();
      } catch {
        throw new DatabaseSendAdmissionError();
      }
      return send();
    },
  });
}
