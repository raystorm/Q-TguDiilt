// Records every call on a list in globalThis (read it with `recordedCalls` in catalog-fixtures.ts).
// __NAME__ and __CLOSE_FAILS__ are replaced when the module is written.
const calls = (globalThis.__recordedDriverCalls ??= []);

export function createDriver() {
   return {
      name: '__NAME__', supportsToolCallGovernance: true,
      execute: async (command, options) => {
         calls.push({ driver: '__NAME__', call: 'execute', command, model: options?.model });
         return { text: 'ok', sessionId: 'recorded-__NAME__', toolCalls: [] };
      },
      close: async () => {
         calls.push({ driver: '__NAME__', call: 'close' });
         if (__CLOSE_FAILS__) { throw new Error('close-boom'); }
      },
   };
}
