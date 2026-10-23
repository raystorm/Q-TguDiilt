import type { registryPath as RegistryPath } from '../registry-location.js';

/** The environment variable that names the registry file for the process tests. */
export const REGISTRY_ENV = 'ACP_TEST_REGISTRY';

/**
 * Stands in for the real lookup in the process tests (see service-process.vite.config.ts).
 * The tool has no such setting: only this test version reads the environment.
 */
export const registryPath: typeof RegistryPath = () => {
   const path = process.env[REGISTRY_ENV];
   if (undefined === path) { throw new Error(`${REGISTRY_ENV} is not set`); }
   return path;
};
