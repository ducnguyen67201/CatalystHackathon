import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readDatabaseEnvironment,
  readDevelopmentEnvironment,
  readEnvironment,
  readWorkflowEnvironment,
} from '../src/server/Env.js';
import { loadEnvironmentValues } from '../src/server/LoadEnvironment.js';
import { createFrontendEnvironment } from '../scripts/DevelopmentEnvironment.js';

const databaseUrl = 'postgresql://test:local@127.0.0.1:55436/test';
const directories: string[] = [];

function createLocalSettings(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'june-env-'));
  directories.push(directory);
  const path = join(directory, '.env');
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Injected environment boundaries', () => {
  it('requires explicit workspace accounts and HTTPS in hosted mode', () => {
    const hosted = {
      DATABASE_URL: databaseUrl,
      HOSTING_MODE: 'hosted',
      WEB_ORIGIN: 'https://june.example.com',
    };
    expect(() => readEnvironment(hosted)).toThrow('Invalid environment settings');
    const account = { username: 'guest', passwordSha256: 'a'.repeat(64), workspaceId: 'tidewell' };
    const HOSTED_ACCOUNTS = JSON.stringify([account]);
    expect(readEnvironment({ ...hosted, HOSTED_ACCOUNTS, PORT: '8080' }).PORT).toBe(8080);
    for (const WEB_ORIGIN of ['http://june.example.com', 'https://june.example.com/path']) {
      expect(() => readEnvironment({ ...hosted, HOSTED_ACCOUNTS, WEB_ORIGIN })).toThrow();
    }
    for (const accounts of [
      'broken-json',
      '[]',
      JSON.stringify([{ ...account, workspaceId: 'other' }]),
      JSON.stringify([account, account]),
    ]) {
      expect(() => readEnvironment({ ...hosted, HOSTED_ACCOUNTS: accounts })).toThrow(
        'Invalid environment settings',
      );
    }
    expect(() =>
      readEnvironment({ DATABASE_URL: databaseUrl, WEB_ORIGIN: hosted.WEB_ORIGIN }),
    ).toThrow();
  });

  it('requires explicit opt-in for public demo access and still enforces HTTPS', () => {
    const settings = {
      DATABASE_URL: databaseUrl,
      HOSTING_MODE: 'hosted',
      WEB_ORIGIN: 'https://june.example.com',
      HOSTED_ACCESS_MODE: 'public-demo',
    };
    expect(readEnvironment(settings).HOSTED_ACCOUNTS).toBeUndefined();
    expect(readEnvironment(settings).HOSTED_ACCESS_MODE).toBe('public-demo');
    expect(() => readEnvironment({ ...settings, HOSTED_ACCESS_MODE: 'public' })).toThrow();
    expect(() => readEnvironment({ ...settings, WEB_ORIGIN: 'http://june.example.com' })).toThrow();
  });

  it('validates an injected object and applies defaults without process globals', () => {
    const settings = Object.freeze({ DATABASE_URL: databaseUrl, EXA_API_KEY: '', API_PORT: '' });
    const env = readEnvironment(settings);
    expect(env.API_PORT).toBe(4318);
    expect(env.EXA_API_KEY).toBeUndefined();
    expect(env).not.toHaveProperty('RESEARCH_MODE');
    expect(settings.API_PORT).toBe('');
  });

  it('allows local fallback while injected settings win without mutating the caller', () => {
    const filePath = createLocalSettings('DATABASE_URL=local-file\nEXA_API_KEY=local-key\n');
    const supplied = Object.freeze({ DATABASE_URL: databaseUrl });
    expect(loadEnvironmentValues(supplied, filePath)).toEqual({
      DATABASE_URL: databaseUrl,
      EXA_API_KEY: 'local-key',
    });
    expect(supplied).toEqual({ DATABASE_URL: databaseUrl });
  });

  it('never fills missing Doppler secrets from a stale .env', () => {
    const filePath = createLocalSettings('EXA_API_KEY=stale-local-key\n');
    const values = loadEnvironmentValues(
      { DOPPLER_PROJECT: 'june-workspace', DOPPLER_CONFIG: 'dev', DATABASE_URL: databaseUrl },
      filePath,
    );
    expect(values.EXA_API_KEY).toBeUndefined();
    expect(readEnvironment(values).DATABASE_URL).toBe(databaseUrl);
  });

  it('rejects missing database settings, invalid protocols, and ignores the obsolete mode setting without leaking inputs', () => {
    expect(() => readEnvironment({})).toThrow('Invalid environment settings');
    expect(() => readEnvironment({ DATABASE_URL: 'not-a-url-private-key' })).toThrow(
      'Invalid environment settings',
    );
    expect(() => readEnvironment({ DATABASE_URL: 'https://private-secret.invalid' })).toThrow(
      'Invalid environment settings. Check Doppler or .env against .env.example.',
    );
    const env = readEnvironment({
      DATABASE_URL: databaseUrl,
      RESEARCH_MODE: 'demo',
      EXA_API_KEY: 'test-exa',
    });
    expect(env).not.toHaveProperty('RESEARCH_MODE');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('keeps all provider and Doppler secrets out of the frontend process', () => {
    const frontend = createFrontendEnvironment({
      PATH: '/bin',
      HOME: '/tmp',
      API_PORT: '4418',
      WEB_ORIGIN: 'http://127.0.0.1:4417',
      DATABASE_URL: databaseUrl,
      OPENAI_API_KEY: 'private-key',
      ELEVENLABS_API_KEY: 'private-voice',
      DOPPLER_TOKEN: 'private-token',
      VITE_SECRET: 'accidental-public-secret',
      NODE_OPTIONS: '--inspect',
    });
    expect(frontend).toEqual({
      PATH: '/bin',
      HOME: '/tmp',
      NODE_ENV: 'development',
      API_PORT: '4418',
      WEB_ORIGIN: 'http://127.0.0.1:4417',
    });
  });

  it('validates local development origins and prevents frontend/API port collisions', () => {
    for (const WEB_ORIGIN of [
      'https://example.com:4317',
      'http://0.0.0.0:4317',
      'http://127.0.0.1:4317/path',
      'http://127.0.0.1:4318',
    ]) {
      expect(() => readDevelopmentEnvironment({ WEB_ORIGIN })).toThrow(
        'Invalid environment settings',
      );
    }
    expect(
      readDevelopmentEnvironment({ WEB_ORIGIN: 'http://localhost:4417', API_PORT: '4418' })
        .API_PORT,
    ).toBe(4418);
  });

  it('requires only the owning tool settings, with no placeholder hosted project', () => {
    expect(readDatabaseEnvironment({ DATABASE_URL: databaseUrl }).DATABASE_URL).toBe(databaseUrl);
    expect(() => readWorkflowEnvironment({})).toThrow('Invalid environment settings');
    expect(readWorkflowEnvironment({ TRIGGER_PROJECT_REF: 'proj_test' }).TRIGGER_PROJECT_REF).toBe(
      'proj_test',
    );
  });
});
