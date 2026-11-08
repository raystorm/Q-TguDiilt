/**
 * Where the profile names file is. A module of its own so that tests can replace it, like the
 * registry location. The default is `_PROFILES.md` in the rules folder, found from this file.
 * Never the working directory.
 */
import { fileURLToPath } from 'node:url';

export function profilesPath(): string
{ return fileURLToPath(new URL('../../rules/_PROFILES.md', import.meta.url)); }
