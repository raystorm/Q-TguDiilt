import type { ToolCallDecision, ToolCallReport } from '../governed-driver.js';

/** Scripted tool calls shared by the contract checks. */
export const read: ToolCallReport = { kind: 'read', title: 'Read a.ts', paths: ['/repo/a.ts'] };
export const edit: ToolCallReport = {
   kind: 'edit', title: 'Edit a.ts', paths: ['/repo/a.ts'], diff: '- a\n+ b',
};
export const exec: ToolCallReport = {
   kind: 'execute', title: 'Run build', command: 'npm run build',
   rawInput: { command: 'npm run build' },
};

export function deferred<T = void>() {
   let resolve!: (value: T) => void;
   const promise = new Promise<T>(res => { resolve = res; });
   return { promise, resolve };
}

/** A decision that is never answered. */
export const unanswered = () => new Promise<ToolCallDecision>(() => {});
