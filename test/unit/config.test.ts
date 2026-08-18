import assert from 'node:assert/strict';
import test from 'node:test';

import { parseApplicationConfig } from '../../src/app/config';

void test('parseApplicationConfig accepts an explicit valid configuration', () => {
  assert.deepEqual(
    parseApplicationConfig({
      environment: 'test',
      serviceName: 'warlist',
    }),
    {
      environment: 'test',
      serviceName: 'warlist',
    },
  );
});

void test('parseApplicationConfig rejects malformed untrusted input', () => {
  assert.throws(
    () => parseApplicationConfig({ environment: 'production' }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'ConfigurationError' &&
      error.message === 'Invalid application configuration: serviceName must be a non-empty string',
  );
});
