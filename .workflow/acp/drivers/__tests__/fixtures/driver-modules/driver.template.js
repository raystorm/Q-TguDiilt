export function createDriver() {
   return { name: '__NAME__', supportsToolCallGovernance: true, marker: '__MARKER__',
            execute: async () => ({}), close: async () => {}, release: async () => {} };
}
