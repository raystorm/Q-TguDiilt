import { describe, it, expect } from 'vitest';
import {
   type LogEntry, createCx, createDriverSpy, eventsOf, makeAgent, newSessionArgs, textParam,
} from './agent.helpers.js';

describe('session link entry', () => {
   const linked = (logger: { entries: LogEntry[] }) => eventsOf(logger, 'agent_session_linked').map(e => e.data);

   it('the first turn logs one entry holding both ids and nothing else', async () => {
      const { agent, logger } = makeAgent({
         driver: createDriverSpy({ text: 'x', sessionId: 'drv-1', toolCalls: [] }),
      });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('q') }, createCx());
      expect(linked(logger)).toEqual([{ sessionId: s.sessionId, agentSessionId: 'drv-1' }]);
   });

   it('later turns that return the same id log nothing more', async () => {
      const { agent, logger } = makeAgent({
         driver: createDriverSpy({ text: 'x', sessionId: 'drv-1', toolCalls: [] }),
      });
      const s = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('one') }, createCx());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('two') }, createCx());
      await agent.prompt({ sessionId: s.sessionId, ...textParam('three') }, createCx());
      expect(linked(logger)).toHaveLength(1);
   });

   it('a changed driver session id logs a new entry', async () => {
      const ids = ['drv-1', 'drv-1', 'drv-2'];
      let n = 0;
      const driver = createDriverSpy(() => ({ text: 'x', sessionId: ids[n++], toolCalls: [] }));
      const { agent, logger } = makeAgent({ driver });
      const s = await agent.newSession(newSessionArgs());
      for (const text of ['one', 'two', 'three']) {
         await agent.prompt({ sessionId: s.sessionId, ...textParam(text) }, createCx());
      }
      expect(linked(logger).map(data => data.agentSessionId)).toEqual(['drv-1', 'drv-2']);
   });

   it('a cancelled turn that names a session links it, and one that names none logs nothing', async () => {
      const results = [
         { cancelled: true, text: '', sessionId: 'drv-c', toolCalls: [] },
         { cancelled: true, text: '', sessionId: '',      toolCalls: [] },
      ];
      let n = 0;
      const { agent, logger } = makeAgent({ driver: createDriverSpy(() => results[n++]) });
      const first  = await agent.newSession(newSessionArgs());
      const second = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: first.sessionId,  ...textParam('q') }, createCx());
      await agent.prompt({ sessionId: second.sessionId, ...textParam('q') }, createCx());
      expect(linked(logger)).toEqual([{ sessionId: first.sessionId, agentSessionId: 'drv-c' }]);
   });

   it('two IDE sessions are linked to their own driver sessions', async () => {
      let n = 0;
      const driver = createDriverSpy(() => ({ text: 'x', sessionId: `drv-${++n}`, toolCalls: [] }));
      const { agent, logger } = makeAgent({ driver });
      const a = await agent.newSession(newSessionArgs());
      const b = await agent.newSession(newSessionArgs());
      await agent.prompt({ sessionId: a.sessionId, ...textParam('q') }, createCx());
      await agent.prompt({ sessionId: b.sessionId, ...textParam('q') }, createCx());
      expect(linked(logger)).toEqual([
         { sessionId: a.sessionId, agentSessionId: 'drv-1' },
         { sessionId: b.sessionId, agentSessionId: 'drv-2' },
      ]);
   });
});
