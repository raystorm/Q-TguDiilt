import { describe, it, expect } from 'vitest';
import type { ToolCallReport } from '../../governed-driver.js';
import { makeDriver } from './acp-driver.helpers.js';
import { ALLOW, REJECT, SESSION } from './failures.helpers.js';
import { unrequested } from './permissions.helpers.js';

const OTHER = 'someone-else';

const update = (sessionId: string, body: object) => ({ sessionId, update: body });
const said   = (sessionId: string, text: string) =>
   update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

describe('updates naming another session', () => {
   it('[H] message text for another session does not enter the result', async () => {
      const { driver, agents } = makeDriver();
      const agent = agents[0];
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', said(OTHER, 'FOREIGN'));
         await agent.notify('session/update', said(SESSION, 'mine'));
         return { stopReason: 'end_turn' };
      });
      expect((await driver.execute('go')).text).toBe('mine');
      agent.exit(0);
   });

   it('[H] a tool call for another session leaves nothing in the table and nothing logged as unrequested', async () => {
      const { driver, agents, logger } = makeDriver();
      const agent   = agents[0];
      const reports: ToolCallReport[] = [];
      agent.respond('session/prompt', async () => {
         await agent.notify('session/update', update(OTHER, {
            sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'x', kind: 'execute', status: 'in_progress',
            rawInput: { command: 'ls' },
         }));
         await agent.request('session/request_permission', {
            sessionId: SESSION, toolCall: { toolCallId: 'c1', title: 'x' }, options: [ALLOW, REJECT],
         });
         return { stopReason: 'end_turn' };
      });
      await driver.execute('go', { onToolCall: async report => { reports.push(report); return 'deny'; } });
      // The other session's record did not supply a kind or a command.
      expect(reports).toEqual([{ kind: 'other', title: 'x' }]);
      expect(unrequested(logger)).toEqual([]);
      agent.exit(0);
   });
});
