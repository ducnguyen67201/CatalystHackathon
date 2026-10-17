import type { EnvironmentValues } from '../src/server/Env.js';
import { readDevelopmentEnvironment } from '../src/server/Env.js';

/** Vite only needs OS launch settings and validated local ports, never provider secrets. */
export function createFrontendEnvironment(values: EnvironmentValues): NodeJS.ProcessEnv {
  const env = readDevelopmentEnvironment(values);
  const frontend: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'COMSPEC',
    'PATHEXT',
    'TERM',
    'LANG',
    'LC_ALL',
    'CI',
    'NO_COLOR',
    'FORCE_COLOR',
  ]) {
    const value = values[key];
    if (value !== undefined) {
      frontend[key] = value;
    }
  }
  return {
    ...frontend,
    NODE_ENV: 'development',
    API_PORT: String(env.API_PORT),
    WEB_ORIGIN: env.WEB_ORIGIN,
  };
}
