import { validateExecuteArgs, ExecuteOptions } from './driver.js';

export interface CliResult {
   finalText: string;
   sessionId: string;
}

// TODO(A4): move shared types to driver.ts
export interface Cli { run(args: string[]): CliResult; }

export interface KiroConfig { agentEngine?: string; }

// TODO(A4): move shared types to driver.ts
export interface DriverResult {
   text:      string;
   sessionId: string;
}

export function createKiroDriver(cli: Cli, config: KiroConfig = {}) {
   const agentEngine = config.agentEngine ?? 'v2';

   return {
      execute(command: string, options: ExecuteOptions = {}): DriverResult {
         validateExecuteArgs(command, options);
         const { context, sessionId, model } = options;
         const input = context ? `${context}\n\n${command}` : command;
         const args = [
            'chat',
            '--no-interactive',
            '--output-format', 'stream-json',
            '--agent-engine', agentEngine,
         ];
         if (model)     { args.push('--model',     model);     }
         if (sessionId) { args.push('--resume-id', sessionId); }
         args.push(input);
         const { finalText, sessionId: returnedSessionId } = cli.run(args);
         return { text: finalText, sessionId: returnedSessionId };
      }
   };
}
