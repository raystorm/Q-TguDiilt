/**
 * Starts the ACP service: registers `tsx`, then runs the service entry. Standard output is the protocol
 * channel, so nothing is written to it here. A missing package ends with a clear message; any other
 * error is thrown unchanged.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

try
{
   const { register } = await import('tsx/esm/api');
   register();
   await import('./protocol/index.ts');
}
catch (error)
{
   const missingPackage = 'ERR_MODULE_NOT_FOUND' === error?.code
                       && error.message.startsWith('Cannot find package ');
   if (!missingPackage) { throw error; }
   const folder = dirname(fileURLToPath(import.meta.url));
   console.error(`The dependencies of the service are not installed. Run \`npm ci --omit=dev\` in ${folder}`);
   console.error(error.message);
   process.exitCode = 1;
}
