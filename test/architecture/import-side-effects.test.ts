import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import test from 'node:test';

function sourceModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

for (const modulePath of sourceModules(resolve('src'))) {
  const specifier = `./${relative(process.cwd(), modulePath)}`;
  void test(`${specifier} imports and exits without runtime handles`, () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--eval', `import('${specifier}')`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5_000,
      },
    );

    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
}
