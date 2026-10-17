import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import type { EnvironmentValues } from './Env.js';

export function usesDoppler(values: EnvironmentValues): boolean {
  return Boolean(values.DOPPLER_PROJECT || values.DOPPLER_CONFIG);
}

/** Doppler runs never merge stale local secrets. Local files are an explicit fallback. */
export function loadEnvironmentValues(
  values: EnvironmentValues,
  filePath = '.env',
): EnvironmentValues {
  if (usesDoppler(values) || !existsSync(filePath)) {
    return { ...values };
  }
  return { ...parse(readFileSync(filePath)), ...values };
}
