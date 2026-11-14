/**
 * The `rawInput` of the permission requests that Copilot 1.0.108 and 1.0.112 sent when it was probed. Each is
 * `{ command, commands }` as the wire carried it: `commands` holds the leading words of the commands
 * Copilot treats as needing approval, and is `[]` when only a redirect did.
 */
export interface CapturedRequest {
   command:  string;
   commands: string[];
}

export const CAPTURED_REQUESTS: readonly CapturedRequest[] = [
   { command: 'touch live-reject.txt',            commands: ['touch'] },
   { command: 'touch live-allow.txt',             commands: ['touch'] },
   { command: 'sleep 30; ls .',                   commands: ['sleep'] },
   { command: 'npx tsc --noEmit',                 commands: ['npx tsc'] },
   { command: 'npm test',                         commands: ['npm test'] },
   { command: 'git checkout main',                commands: ['git checkout'] },
   { command: 'ls | tee out.txt',                 commands: ['tee'] },
   { command: 'printf x > f.txt',                 commands: ['printf'] },
   { command: 'bash -c "ls && pwd"',              commands: ['bash'] },
   { command: 'touch a.txt && touch b.txt',       commands: ['touch'] },
   { command: 'touch a.txt; touch b.txt',         commands: ['touch'] },
   { command: 'git checkout main && git status',  commands: ['git checkout'] },
   { command: 'FOO=1 npx tsc --noEmit',           commands: ['npx tsc'] },
   { command: 'touch a.txt && git checkout main', commands: ['touch', 'git checkout'] },
   { command: 'git checkout main; npm test',      commands: ['git checkout', 'npm test'] },
   { command: 'echo hi > out.txt',                commands: [] },
   { command: 'echo hi >> out.txt',               commands: [] },
   { command: 'cat src/a.ts > copy.txt',          commands: [] },
   { command: 'ls > listing.txt',                 commands: [] },
   { command: 'echo hi 2> err.txt',               commands: [] },
   { command: 'echo hi > out.txt && ls',          commands: [] },
];
