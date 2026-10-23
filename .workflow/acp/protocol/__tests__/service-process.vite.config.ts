import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Used only by the process tests, through `vite-node --config`: where the entry point imports the
 * registry lookup, it gets the test version, which reads the registry path from the environment.
 */
export default defineConfig({
   resolve: {
      alias: [{
         find:        /^\.\/registry-location\.js$/,
         replacement: fileURLToPath(new URL('./registry-location.process.ts', import.meta.url)),
      }],
   },
});
