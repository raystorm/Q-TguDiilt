// Stub ACP agent for tests: a real process that speaks just enough ACP. What else it does comes from
// STUB_BEHAVIOUR, a comma separated list:
//   exit-before-initialize  print STUB_STDERR (default: a login message) and exit 1
//   linger                  keep running after stdin ends
//   ignore-sigterm          keep running after SIGTERM
//   grandchild              start a child in this process group
//   grandchild-setsid       start a child in its own session
//   crash-on-prompt         kill itself with SIGKILL when a prompt arrives
//   hold-prompt             never answer a prompt (it is noted in events.log)
//   garbage-stdout          answer initialize with a line that is not JSON
//   stderr-flood            write STUB_FLOOD_BYTES to stderr before it answers a prompt
// With STUB_DIR set it writes state.json (pids, arguments, directory) and appends to events.log.
import { spawn } from 'node:child_process';
import { appendFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const behaviours = new Set((process.env.STUB_BEHAVIOUR ?? '').split(',').filter(Boolean));
const dir        = process.env.STUB_DIR;
const state      = { pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd() };

const note = line => { if (dir) { appendFileSync(join(dir, 'events.log'), `${line}\n`); } };
const save = () => {
   if (!dir) { return; }
   const temporary = join(dir, `state.${process.pid}.tmp`);
   writeFileSync(temporary, JSON.stringify(state));
   renameSync(temporary, join(dir, 'state.json'));
};
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);

save();

process.on('SIGTERM', () => {
   note('SIGTERM');
   if (!behaviours.has('ignore-sigterm')) { process.exit(143); }
});

if (behaviours.has('exit-before-initialize')) {
   process.stderr.write(
      process.env.STUB_STDERR ?? 'You are not logged in, please log in with kiro-cli login\n',
      () => process.exit(1),
   );
}

if (behaviours.has('grandchild') || behaviours.has('grandchild-setsid')) {
   const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore', detached: behaviours.has('grandchild-setsid'),
   });
   child.unref();
   state.grandchild = child.pid;
   save();
}

if (behaviours.has('linger')) { setInterval(() => {}, 1000); }

function handle(message) {
   if (!('method' in message) || !('id' in message)) { return; }
   switch (message.method) {
      case 'initialize':
         if (behaviours.has('garbage-stdout')) { process.stdout.write('this is not json\n'); return; }
         reply(message.id, {
            protocolVersion: 1,
            agentCapabilities: { sessionCapabilities: { list: {} }, _meta: { kiro: { extensionMethods: [] } } },
            authMethods: [],
         });
         return;
      case 'session/new':
         reply(message.id, { sessionId: 'stub-session' });
         return;
      case 'session/prompt':
         note('prompt');
         if (behaviours.has('hold-prompt')) { return; }
         if (behaviours.has('crash-on-prompt')) { process.kill(process.pid, 'SIGKILL'); }
         if (behaviours.has('stderr-flood')) {
            const line = `${'x'.repeat(1023)}\n`;
            for (let left = Number(process.env.STUB_FLOOD_BYTES ?? 8000000); 0 < left; left -= line.length) {
               process.stderr.write(line);
            }
         }
         reply(message.id, { stopReason: 'end_turn' });
         return;
      default:
         process.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' },
         })}\n`);
   }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
   buffer += chunk;
   for (let end = buffer.indexOf('\n'); -1 !== end; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if ('' !== line.trim()) { handle(JSON.parse(line)); }
   }
});
process.stdin.on('end', () => {
   note('stdin_end');
   if (!behaviours.has('linger')) { process.exit(0); }
});
