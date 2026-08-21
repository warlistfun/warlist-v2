import test from 'node:test';

import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import {
  MutableTenantAuthorization,
  verifyBusinessRepositoryContract,
} from '../support/business-repository-contract';

void test('in-memory adapter satisfies the shared business repository contract', async (t) => {
  const authorization = new MutableTenantAuthorization();
  const repository = createInMemoryBusinessRepository({ authorization });
  await verifyBusinessRepositoryContract(t, repository, authorization);
});
