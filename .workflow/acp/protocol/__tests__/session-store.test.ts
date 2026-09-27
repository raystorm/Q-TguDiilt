import { describe, it, expect } from 'vitest';
import { createSessionStore } from '../session-store.js';

function fixedIds(prefix = 'wf')
{
   let n = 0;
   return () => `${prefix}-${++n}`;
}

describe('SessionStore — session <-> workflow mapping', () => {
   it('new session maps to a fresh workflowId', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      const s     = store.create('sess-1');
      expect(s.sessionId).toBe('sess-1');
      expect(s.workflowId).toBe('wf-1');
   });

   it('distinct sessions map to distinct workflowIds', () => {
      const store = createSessionStore({ newWorkflowId: fixedIds() });
      const a     = store.create('sess-a');
      const b     = store.create('sess-b');
      expect(a.workflowId).not.toBe(b.workflowId);
   });

   it('get returns a created session', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      store.create('sess-1');
      expect(store.get('sess-1')?.workflowId).toBe('wf-1');
   });

   it('get returns undefined for an unknown session', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      expect(store.get('nope')).toBeUndefined();
   });

   it('load re-registers a session with its prior workflowId', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-new' });
      const s     = store.load('sess-old', 'wf-old');
      expect(s.workflowId).toBe('wf-old');
      expect(store.get('sess-old')?.workflowId).toBe('wf-old');
   });

   it('close removes a single mapping', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      store.create('sess-1');
      store.close('sess-1');
      expect(store.get('sess-1')).toBeUndefined();
   });

   it('closeAll clears every mapping (disconnect / EOF cleanup)', () => {
      const store = createSessionStore({ newWorkflowId: fixedIds() });
      store.create('sess-1');
      store.create('sess-2');
      store.closeAll();
      expect(store.get('sess-1')).toBeUndefined();
      expect(store.get('sess-2')).toBeUndefined();
   });
});

describe('SessionStore — active-turn flag', () => {
   it('defaults to false for a new session', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      store.create('sess-1');
      expect(store.hasActiveTurn('sess-1')).toBe(false);
   });

   it('can be set and cleared', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      store.create('sess-1');
      store.setActiveTurn('sess-1', true);
      expect(store.hasActiveTurn('sess-1')).toBe(true);
      store.setActiveTurn('sess-1', false);
      expect(store.hasActiveTurn('sess-1')).toBe(false);
   });

   it('reports false for an unknown session', () => {
      const store = createSessionStore({ newWorkflowId: () => 'wf-1' });
      expect(store.hasActiveTurn('ghost')).toBe(false);
   });
});
