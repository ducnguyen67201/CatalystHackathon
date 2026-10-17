import { loadEnvironmentValues, usesDoppler } from '../src/server/LoadEnvironment.js';
import { spawnSync } from 'node:child_process';
import { readFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readEnvironment } from '../src/server/Env.js';
import { createRuntime } from '../src/server/Runtime.js';
if (!usesDoppler(process.env) && !existsSync('.env')) {
  await copyFile('.env.example', '.env');
}
const values = loadEnvironmentValues(process.env);
const env = readEnvironment(values);
function run(command: string, args: string[]): void {
  const child = spawnSync(command, args, { stdio: 'inherit', env: { ...values } });
  if (child.status !== 0) {
    throw new Error(`Setup failed at ${command}.`);
  }
}
run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
run('pnpm', ['db:generate']);
run('pnpm', ['db:deploy']);
const service = createRuntime(env);
try {
  await service.initialize(await readFile('fixtures/Tidewell.csv', 'utf8'));
  await service.rebuild();
  console.log('June is ready. Run pnpm dev.');
} finally {
  await service.store.close();
}
