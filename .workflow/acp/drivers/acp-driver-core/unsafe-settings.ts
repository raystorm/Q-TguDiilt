import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import type { UnsafeSetting } from './types.js';

/**
 * Which of the unsafe settings the driver listed are switched on right now.
 * A setting is on when the agent's config option with its `optionId` currently
 * holds one of its unsafe `values`. Returns their names, in the driver's order.
 */
export function unsafeSettingsOn(
   settings: readonly UnsafeSetting[], options: readonly SessionConfigOption[],
): string[] {
   return settings
      .filter(({ optionId, values }) => options.some(option => {
         const value: unknown = option.currentValue;
         return optionId === option.id && 'string' === typeof value && values.includes(value);
      }))
      .map(({ name }) => name);
}

/** Why a session that starts with these settings on is refused. Says what to do. */
export function refusalFor(names: readonly string[]): string {
   return `the agent reports ${names.join(' and ')} on, so it may run tools without asking this service. ` +
      'This client cannot change it; turn it off in the agent itself, then try again';
}

/** The text with a warning paragraph in front when settings were switched on during the session. */
export function prependWarning(names: readonly string[], text: string): string {
   if (0 === names.length) { return text; }
   const warning = `Warning: the agent turned on ${names.join(' and ')} during this session. ` +
      'This client cannot turn it off. The agent may now run tools without asking, so they are not checked.';
   return '' === text ? warning : `${warning}\n\n${text}`;
}
