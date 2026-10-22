import { RegistryDriverEntry } from '../registry.js';

/** Module path for registry fixtures that never import the module. */
export const FIXTURE_MODULE = './fixture-driver.js';

/** Registry entry fixture: the given models plus a placeholder module. */
export function driverEntry(models: string[]): RegistryDriverEntry
{ return { module: FIXTURE_MODULE, models }; }
