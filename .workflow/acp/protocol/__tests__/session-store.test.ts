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

describe('SessionStore — abort handle', () => {
   const newStore = () => createSessionStore({ newWorkflowId: () => 'wf-1' });

   it('keeps the controller on the record while the turn is active', () => {
      const store = newStore();
      const controller = new AbortController();
      const record = store.create('sess-1');
      store.setActiveTurn('sess-1', true, controller);
      expect(record.abort).toBe(controller);
   });

   it('clearing the active turn drops the abort handle', () => {
      const store = newStore();
      const record = store.create('sess-1');
      store.setActiveTurn('sess-1', true, new AbortController());
      store.setActiveTurn('sess-1', false);
      expect(record.abort).toBeUndefined();
      expect(store.hasActiveTurn('sess-1')).toBe(false);
   });

   it('close and closeAll drop it too', () => {
      const store = newStore();
      const one = store.create('sess-1');
      const two = store.create('sess-2');
      store.setActiveTurn('sess-1', true, new AbortController());
      store.setActiveTurn('sess-2', true, new AbortController());
      store.close('sess-1');
      expect(one.abort).toBeUndefined();
      store.closeAll();
      expect(two.abort).toBeUndefined();
   });

   it('abortTurn aborts the active turn once and leaves the flag set', () => {
      const store = newStore();
      const controller = new AbortController();
      store.create('sess-1');
      store.setActiveTurn('sess-1', true, controller);
      expect(store.abortTurn('sess-1')).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(store.hasActiveTurn('sess-1')).toBe(true);
      expect(store.abortTurn('sess-1')).toBe(false);
   });

   it('abortTurn is false with no active turn, no controller, or an unknown session', () => {
      const store = newStore();
      store.create('idle');
      store.create('bare');
      store.setActiveTurn('bare', true);
      expect(store.abortTurn('idle')).toBe(false);
      expect(store.abortTurn('bare')).toBe(false);
      expect(store.abortTurn('ghost')).toBe(false);
   });

   it('abortAllTurns aborts every active turn and leaves idle sessions alone', () => {
      const store = newStore();
      const a = new AbortController();
      const b = new AbortController();
      store.create('a');
      store.create('b');
      store.create('idle');
      store.setActiveTurn('a', true, a);
      store.setActiveTurn('b', true, b);
      store.abortAllTurns();
      expect([a.signal.aborted, b.signal.aborted]).toEqual([true, true]);
      expect(store.hasActiveTurn('idle')).toBe(false);
   });
});
