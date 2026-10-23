/**
 * Where the driver registry file is. A module of its own so that tests can replace it:
 * the tool has no launch-time setting for it. The default is `registry.yaml` in the drivers
 * folder, found from this file like the governance config. Never the working directory,
 * never the example.
 */
import { fileURLToPath } from 'node:url';

export function registryPath(): string
{ return fileURLToPath(new URL('../drivers/registry.yaml', import.meta.url)); }
