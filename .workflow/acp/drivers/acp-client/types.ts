import type { Stream } from '@agentclientprotocol/sdk';
import type { Logger } from '../../shared/logger.js';

/** How to start one downstream agent. */
export interface LaunchSpec {
   command: string;
   args:    readonly string[];
   cwd:     string;
}

/** How an agent process ended: its exit code, or the signal that ended it. */
export interface AgentExit {
   code:   number | null;
   signal: string | null;
}

/** The only signals the ending sequence sends. */
export type EndSignal = 'SIGTERM' | 'SIGKILL';

/**
 * One running downstream agent. The core ends it only through these
 * primitives, so a fake can record them and fake timers can drive them.
 */
export interface AgentHandle {
   readonly pid:    number;
   readonly stream: Stream;
   /** Resolves once the process has exited. */
   readonly exited: Promise<AgentExit>;
   /** True once the process has exited. */
   hasExited(): boolean;
   /** Registers the stderr consumer. Output before registration is replayed. */
   onStderr(listener: (text: string) => void): void;
   closeStdin(): void;
   /** Signals the agent's whole process group. A no-op once it has exited. */
   killGroup(signal: EndSignal): void;
}

/** Starts an agent. Rejects if the process cannot be started. */
export type Connect = (spec: LaunchSpec) => Promise<AgentHandle>;

/**
 * What the ACP-client core needs to drive one kind of agent. A concrete
 * driver (Kiro, Copilot) supplies the launch command line; the rest is
 * shared.
 */
export interface AcpDriverDeps {
   /** The driver's name, as the protocol layer reports it. */
   name:    string;
   /** Starts one agent process. Injected so tests can use a fake. */
   connect: Connect;
   /** The agent's command line; the working directory is always the service's. */
   launch:  { command: string; args: readonly string[] };
   logger:  Logger;
}
