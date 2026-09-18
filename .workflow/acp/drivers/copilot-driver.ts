import { validateExecuteArgs, ExecuteOptions } from './driver.js';
import { Cli, DriverResult } from './kiro-driver.js';

export function createCopilotDriver(cli: Cli) {
   return {
      execute(command: string, options: ExecuteOptions = {}): DriverResult {
         validateExecuteArgs(command, options);
         const { context, sessionId, model } = options;
         const input = context ? `${context}\n\n${command}` : command;
         const args = [
            '-p',              input,
            '--output-format', 'json',
         ];
         if (model)     { args.push('--model',      model);     }
         if (sessionId) { args.push('--session-id', sessionId); }
         const { finalText, sessionId: returnedSessionId } = cli.run(args);
         return { text: finalText, sessionId: returnedSessionId };
      }
   };
}
