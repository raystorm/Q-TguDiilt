import { NEVER } from './fake-acp-agent.js';
import { type FakeAgent, createDiagnostics, flush, makeDriver } from './acp-driver.helpers.js';
import { SESSION } from './failures.helpers.js';

/** The agent offers a model option with m1 selected and m2 listed, and accepts any change. */
export const MODEL_OPTION = {
   id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'm1',
   options: [{ value: 'm1', name: 'M1' }, { value: 'm2', name: 'M2' }],
};

export function offeringModels(agent: FakeAgent) {
   agent.respond('session/new', () => ({ sessionId: SESSION, configOptions: [MODEL_OPTION] }));
   agent.respond('session/set_config_option', () => ({ configOptions: [MODEL_OPTION] }));
}

/** The first line of an error's message. */
export const firstLine = (error: Error): string => error.message.split('\n')[0];

/**
 * A first turn has completed and the second prompt is held. `turn` settles with the second turn's
 * error; `recordsWhenFailed()` is how many records existed at the moment it failed (-1 before).
 */
export async function heldSecondTurn(diagnostics = createDiagnostics()) {
   const made  = makeDriver(1, undefined, undefined, undefined, diagnostics);
   const agent = made.agents[0];
   const first = await made.driver.execute('one');
   agent.respond('session/prompt', () => NEVER);
   let recordsWhenFailed = -1;
   const turn = made.driver.execute('two', { sessionId: first.sessionId }).then(
      () => undefined,
      (err: Error) => { recordsWhenFailed = diagnostics.records.length; return err; },
   );
   await flush();
   return { ...made, agent, diagnostics, turn, recordsWhenFailed: () => recordsWhenFailed };
}
