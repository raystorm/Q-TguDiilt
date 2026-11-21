import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realIo } from './io.js';
import { run } from './run.js';

/** The engine root is the folder above `installer/`. */
const source = join(dirname(fileURLToPath(import.meta.url)), '..');

const { code, lines } = run(process.argv.slice(2), realIo(), source);
for (const line of lines) { console.log(line); }
process.exitCode = code;
