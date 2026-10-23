import type { InitializeResponse, NewSessionResponse, Stream } from '@agentclientprotocol/sdk';
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
 * What differs between agents besides the launch command line: checks on what
 * the agent reports. Each returns the reason to refuse the agent, or nothing.
 * A refusal ends the process before the next step (`verifyInitialize` before
 * `session/new`, `verifySession` before the prompt). The reason is the error
 * message the user sees, so it says what to do.
 */
export interface AcpPolicy {
   verifyInitialize?(response: InitializeResponse): string | undefined;
   verifySession?(response: NewSessionResponse): string | undefined;
}

/**
 * A setting that makes an agent run tools without asking this service, and that
 * this client cannot change. The driver names it; the core looks for it.
 */
export interface UnsafeSetting {
   /** What the setting is called in the refusal, the warning and the log. */
   name:     string;
   /** The id of the agent's config option that holds it. */
   optionId: string;
   /** The option values that make it unsafe. Any other value, or no such option, is safe. */
   values:   readonly string[];
}

/**
 * What the ACP driver core needs to drive one kind of agent. A concrete
 * driver supplies the launch command line; the rest is shared.
 */
export interface AcpDriverDeps {
   /** The driver's name, as the protocol layer reports it. */
   name:    string;
   /** Starts one agent process. Injected so tests can use a fake. */
   connect: Connect;
   /** The agent's command line; the working directory is always the service's. */
   launch:  { command: string; args: readonly string[] };
   /** Per-agent checks; none when omitted. */
   policy?: AcpPolicy;
   /** Settings to refuse at session start and to warn about when switched on later; none when omitted. */
   unsafeSettings?: readonly UnsafeSetting[];
   logger:  Logger;
}
