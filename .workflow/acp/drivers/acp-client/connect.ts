/**
 * The real way to start an agent: a child process that speaks ACP over stdio. No shell is involved:
 * the command and its arguments go to the operating system as they are. On POSIX the agent leads its own
 * process group, so that the whole tree can be signalled and the group is swept when the agent exits.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import type { AgentExit, AgentHandle, Connect, EndSignal } from './types.js';

/** How long, after the process exited, its stdio may take to close before the exit is reported anyway. */
export const STDIO_CLOSE_WAIT_MS = 1000;

/** At most this many characters of stderr are kept until a consumer registers. */
const EARLY_STDERR_MAX_CHARS = 65536;

/** Written to the stderr feed when the agent's stdout carries a line that is not JSON. */
const NOT_JSON_NOTE = '[service] a line on the agent\'s stdout was not JSON; the connection was closed\n';

/**
 * The agent's stdout as bytes, line by line. A line that is not JSON ends the stream (and `onInvalid`
 * runs): the SDK would answer it with a parse error the agent may never expect.
 */
function agentOutput(stdout: Readable, onInvalid: () => void): ReadableStream<Uint8Array> {
   const decoder = new StringDecoder('utf8');
   const encoder = new TextEncoder();
   let pending = '';
   let ended   = false;

   return new ReadableStream<Uint8Array>({
      start(controller) {
         const finish = () => {
            if (ended) { return; }
            ended = true;
            stdout.destroy();
            controller.close();
         };
         const accept = (line: string): boolean => {
            if ('' === line.trim()) { return true; }
            try { JSON.parse(line); }
            catch { onInvalid(); return false; }
            controller.enqueue(encoder.encode(`${line}\n`));
            return true;
         };

         stdout.on('data', (chunk: Buffer) => {
            if (ended) { return; }
            const lines = (pending + decoder.write(chunk)).split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
               if (!accept(line)) { finish(); return; }
            }
            if (null !== controller.desiredSize && 0 >= controller.desiredSize) { stdout.pause(); }
         });
         stdout.on('end', () => {
            if (ended) { return; }
            pending += decoder.end();
            if ('' !== pending.trim()) { accept(pending); }
            finish();
         });
         stdout.on('error', finish);
         stdout.on('close', finish);
      },
      pull() { stdout.resume(); },
      cancel() { ended = true; stdout.destroy(); },
   });
}

/** The agent's stdin as bytes. A write to an agent that is gone is dropped: it must not crash the service. */
function agentInput(stdin: Writable): WritableStream<Uint8Array> {
   return new WritableStream<Uint8Array>({
      write: chunk => new Promise<void>(resolve => {
         if (!stdin.writable) { resolve(); return; }
         stdin.write(chunk, () => resolve());
      }),
      close: () => { stdin.end(); },
   });
}

function handleFor(child: ChildProcess): AgentHandle {
   const pid    = child.pid as number;
   const stdin  = child.stdin as Writable;
   const stdout = child.stdout as Readable;
   const stderr = child.stderr as Readable;
   const listeners: Array<(text: string) => void> = [];
   let early = '';
   let gone  = false;

   const emit = (text: string) => {
      if (0 === listeners.length) { early = (early + text).slice(-EARLY_STDERR_MAX_CHARS); }
      else { listeners.forEach(listener => listener(text)); }
   };

   // Errors on the pipes are absorbed: the exit is how a lost agent is noticed.
   child.on('error', () => undefined);
   stdin.on('error', () => undefined);
   stderr.on('error', () => undefined);
   stderr.setEncoding('utf8');
   stderr.on('data', emit);

   const signalGroup = (signal: EndSignal) => {
      try {
         if ('win32' === process.platform) {
            // Windows has no process groups: taskkill ends the whole tree. Best effort, untested for now.
            spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
         }
         else { process.kill(-pid, signal); }
      }
      catch { /* nothing is left in the group */ }
   };

   const exited = new Promise<AgentExit>(resolve => {
      child.once('exit', (code, signal) => {
         gone = true;
         // The leader is gone: whatever is left in its group goes with it. The group id cannot belong to
         // another process while any member lives, so this cannot reach an unrelated one.
         if ('win32' !== process.platform) { signalGroup('SIGKILL'); }
         // 'close' follows once every holder of the pipes has let go; a descendant outside the group may not.
         const report = () => { clearTimeout(timer); resolve({ code, signal }); };
         const timer  = setTimeout(report, STDIO_CLOSE_WAIT_MS);
         child.once('close', report);
      });
   });

   return {
      pid,
      stream: ndJsonStream(agentInput(stdin), agentOutput(stdout, () => emit(NOT_JSON_NOTE))),
      exited,
      hasExited: () => gone,
      onStderr: listener => {
         listeners.push(listener);
         if ('' !== early) { listener(early); early = ''; }
      },
      closeStdin: () => { if (!stdin.writableEnded) { stdin.end(); } },
      killGroup: signal => { if (!gone) { signalGroup(signal); } },
   };
}

/** Starts the agent as a child process. Rejects, with the system's error, if it cannot be started. */
export const spawnAgent: Connect = spec => new Promise<AgentHandle>((resolve, reject) => {
   const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: 'win32' !== process.platform,
      windowsHide: true,
   });
   child.once('error', reject);
   child.once('spawn', () => {
      child.off('error', reject);
      resolve(handleFor(child));
   });
});
