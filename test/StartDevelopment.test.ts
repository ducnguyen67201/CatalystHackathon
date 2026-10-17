import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn<(command: string, args: string[], options: SpawnOptions) => EventEmitter>(),
  values: {
    DATABASE_URL: 'postgresql://test:local@127.0.0.1:55436/test',
    DOPPLER_PROJECT: 'june-workspace',
    OPENAI_API_KEY: 'test-key',
  },
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../src/server/LoadEnvironment.js', () => ({
  loadEnvironmentValues: () => mocks.values,
  usesDoppler: () => true,
}));

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  mocks.spawn.mockReset();
  vi.spyOn(process, 'once').mockReturnValue(process);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

it('finishes database preparation before launching services with the same backend settings', async () => {
  const events: string[] = [];
  mocks.spawn.mockImplementation((command: string, args: string[], options: SpawnOptions) => {
    const child = new EventEmitter();
    const name = command === 'docker' ? 'postgres' : (args[0] ?? command);
    events.push(`start:${name}`);
    if (command === 'docker' || command === 'pnpm') {
      if (command === 'pnpm') expect(options.env).toEqual(mocks.values);
      queueMicrotask(() => {
        events.push(`done:${name}`);
        child.emit('exit', 0);
      });
    }
    return child;
  });

  await import('../scripts/StartDevelopment.js');

  expect(events.slice(0, 6)).toEqual([
    'start:postgres',
    'done:postgres',
    'start:db:generate',
    'done:db:generate',
    'start:db:deploy',
    'done:db:deploy',
  ]);
  expect(mocks.spawn).toHaveBeenCalledTimes(6);
  expect(mocks.spawn.mock.calls[3]?.[2].env).toEqual(mocks.values);
  expect(mocks.spawn.mock.calls[4]?.[2].env).toEqual(mocks.values);
  expect(mocks.spawn.mock.calls[5]?.[2].env).not.toHaveProperty('OPENAI_API_KEY');
});

it.each([1, 2, 3])(
  'does not launch later steps when preparation step %i fails',
  async (failure) => {
    let calls = 0;
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      calls += 1;
      const code = calls === failure ? 1 : 0;
      queueMicrotask(() => child.emit('exit', code));
      return child;
    });

    await import('../scripts/StartDevelopment.js');

    expect(mocks.spawn).toHaveBeenCalledTimes(failure);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Development services were not started.'),
    );
  },
);
