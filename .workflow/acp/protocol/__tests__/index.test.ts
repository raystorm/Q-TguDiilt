import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import {
   forgetRecordedCalls,
   recordedCalls,
   useTempDir,
   writeFile,
   writeRecordingDriver,
} from '../../drivers/__tests__/catalog-fixtures.js';
import {
   fakeAgents,
   type FakeAgent,
} from '../../drivers/acp-driver-core/__tests__/acp-driver.helpers.js';
import { DRIVER_FAILURE } from '../../drivers/driver-catalog.js';
import { DISCONNECT_ERROR_EXIT_CODE } from '../shutdown.js';
import { createCx, deferred, flush, newSessionArgs, textParam, type Cx } from './agent.helpers.js';

/**
 * Startup wiring of the stdio entry point. `index.ts` runs as soon as it is
 * imported, so each test re-imports it with the SDK, the file logger and
 * the stdio conversions mocked. The governance engine, the registry loader,
 * the driver catalog and the agent are real (the loader and the catalog are
 * only observed). The registry lookup is replaced: it names a registry file
 * written to a temp folder, with fixture driver modules that record their
 * calls, or the shipped example.
 */
const mocks = vi.hoisted(() => ({
   connect:        vi.fn(),
   logEntries:     [] as Array<{ level: string; event: string; data: any }>,
   order:          [] as string[],
   configOverride: undefined as string | undefined,
   registry:       '',
   service:        undefined as any,
   onDisconnect:   undefined as any,
}));

// Only the server side is replaced (the builder and the stdio stream). The real client and
// methods stay: the built-in drivers use them to talk to their fake agents.
vi.mock('@agentclientprotocol/sdk', async importOriginal => {
   const actual = await importOriginal<typeof import('@agentclientprotocol/sdk')>();
   const chain: any = {
      onRequest: () => chain, onNotification: () => chain, connect: mocks.connect,
   };
   return { ...actual, agent: () => chain, ndJsonStream: () => ({}) };
});

vi.mock('../../shared/logger.js', async importOriginal => {
   const actual = await importOriginal<typeof import('../../shared/logger.js')>();
   const record = (level: string) => (event: string, data: any = {}) => {
      mocks.logEntries.push({ level, event, data });
   };
   return {
      ...actual,
      createFileLogger: () => ({
         debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error'),
      }),
   };
});

// Real engine; only the config path can be redirected, to exercise failures.
vi.mock('../../governance/engine.js', async importOriginal => {
   const actual = await importOriginal<typeof import('../../governance/engine.js')>();
   return {
      ...actual,
      createGovernanceEngine: vi.fn((options: any) => actual.createGovernanceEngine(
         undefined === mocks.configOverride
            ? options
            : { ...options, configPath: mocks.configOverride },
      )),
   };
});

// Where the registry file is. The real lookup is checked on its own.
vi.mock('../registry-location.js', () => ({ registryPath: vi.fn(() => mocks.registry) }));

// The real loader and the real catalog build, observed.
vi.mock('../../drivers/registry.js', async importOriginal => {
   const actual = await importOriginal<typeof import('../../drivers/registry.js')>();
   return { ...actual, loadRegistryConfig: vi.fn(actual.loadRegistryConfig) };
});

vi.mock('../../drivers/driver-catalog.js', async importOriginal => {
   const actual = await importOriginal<typeof import('../../drivers/driver-catalog.js')>();
   type Options = Parameters<typeof actual.buildDriverCatalog>[0];
   return {
      ...actual,
      buildDriverCatalog: vi.fn(async (options: Options) => {
         const catalog = await actual.buildDriverCatalog(options);
         mocks.order.push('built');
         return catalog;
      }),
   };
});

// The built-in drivers start their agent with spawnAgent; a test hands them fake agents.
vi.mock('../../drivers/acp-driver-core/connect.js', async importOriginal => ({
   ...(await importOriginal<typeof import('../../drivers/acp-driver-core/connect.js')>()),
   spawnAgent: vi.fn(),
}));

// Real agent; only a spy on its onDisconnect, to prove the stdin wiring calls it.
vi.mock('../agent.js', async importOriginal => {
   const actual = await importOriginal<typeof import('../agent.js')>();
   return {
      ...actual,
      createAgent: vi.fn((deps: any) => {
         const service = actual.createAgent(deps);
         mocks.service      = service;
         mocks.onDisconnect = vi.spyOn(service, 'onDisconnect');
         return service;
      }),
   };
});

const HERE             = dirname(fileURLToPath(import.meta.url));
const SHIPPED_CONFIG   = join(HERE, '..', '..', 'governance', 'config.yaml');
const DRIVERS_DIR      = join(HERE, '..', '..', 'drivers');
const EXAMPLE_REGISTRY = join(DRIVERS_DIR, 'registry.example.yaml');

/** What Kiro's V3 server reports at initialize. */
const KIRO_V3 = {
   protocolVersion:   1,
   authMethods:       [],
   agentCapabilities: {
      sessionCapabilities: { list: {} },
      _meta:               { kiro: { extensionMethods: ['_kiro/example'] } },
   },
};

const SIGNALS  = ['SIGTERM', 'SIGINT', 'SIGHUP'];
const TRIGGERS = ['stdin end', ...SIGNALS];

/** The handler the entry point registered for this trigger. */
const handlerFor = (trigger: string) => {
   const [calls, event] = 'stdin end' === trigger
      ? [vi.mocked(process.stdin.on).mock.calls, 'end']
      : [vi.mocked(process.on).mock.calls, trigger];
   return calls.find(([name]) => event === name)?.[1] as (() => void) | undefined;
};

const dirOf = useTempDir();

interface Entry { module: string; models: string[]; }

/** The registry file in the temp folder. YAML is a superset of JSON, so JSON is enough. */
const registryFile = (drivers: Record<string, Entry>, rest: Record<string, unknown> = {}) =>
   writeFile(join(dirOf(), 'registry.yaml'), JSON.stringify({ drivers, ...rest }));

/** A recording fixture driver written beside the registry file; returns the entry that lists it. */
function recording(name: string, { models = ['auto', 'm1'], closeFails = false } = {}): Entry
{
   writeRecordingDriver(join(dirOf(), `${name}.js`), name, closeFails);
   return { module: `./${name}.js`, models };
}

/** An entry whose module file does not exist. */
const missing = (name: string, models = ['auto', 'm1']): Entry =>
   ({ module: `./${name}-missing.js`, models });

/** A registry of the two built-in driver modules, preferring `preferred`. */
const builtins = (preferred: string) => registryFile({
   kiro:    { module: join(DRIVERS_DIR, 'kiro-driver-acp.js'),    models: ['auto'] },
   copilot: { module: join(DRIVERS_DIR, 'copilot-driver-acp.js'), models: ['auto'] },
}, { preferred: { driver: preferred } });

/** Registry texts that stop startup: a label, the text, the error name, and a part of its message. */
const ALPHA = { module: './alpha.js', models: ['auto'] };

const BAD_REGISTRIES: Array<[string, string, string, string]> = [
   ['text that is not YAML', 'drivers: [unclosed', 'RegistryConfigParseError', 'not valid YAML'],
   [
      'a driver entry without a module',
      JSON.stringify({ drivers: { alpha: { models: ['auto'] } } }),
      'RegistryConfigInvalidError', 'module',
   ],
   [
      'an unknown top-level key',
      JSON.stringify({ drivers: { alpha: ALPHA }, prefered: {} }),
      'RegistryConfigInvalidError', 'prefered',
   ],
   [
      'preferred without a driver',
      JSON.stringify({ drivers: { alpha: ALPHA }, preferred: { model: 'auto' } }),
      'RegistryConfigInvalidError', 'preferred.driver',
   ],
   [
      'an empty drivers map',
      JSON.stringify({ drivers: {} }),
      'DriverCatalogBuildError', 'no drivers',
   ],
];

/** Runs `run` with `dir` as the working directory. */
async function inside<T>(dir: string, run: () => Promise<T> | T): Promise<T>
{
   const before = process.cwd();
   process.chdir(dir);
   try { return await run(); }
   finally { process.chdir(before); }
}

/** The error that importing the entry point rejects with. */
async function startupError(): Promise<Error>
{
   try { await import('../index.js'); }
   catch (err) { return err as Error; }
   throw new Error('startup did not fail');
}

/** The error entries that carry this registry path. */
const failuresAbout = (path: string) =>
   mocks.logEntries.filter(entry => 'error' === entry.level && path === entry.data.filePath);

const agentDeps = async () => {
   const { createAgent } = await import('../agent.js');
   return vi.mocked(createAgent).mock.calls[0][0];
};

/** Starts the service and initializes it. */
async function serve(): Promise<void>
{
   await import('../index.js');
   await mocks.service.initialize({ protocolVersion: 1 });
}

/** Opens a session and prompts it once. Resolves with what the client was sent. */
async function prompted(): Promise<Cx>
{
   const cx = createCx();
   const { sessionId } = await mocks.service.newSession(newSessionArgs());
   await mocks.service.prompt({ sessionId, ...textParam('go') }, cx);
   return cx;
}

const textsOf = (cx: Cx) => cx.calls
   .filter(call => 'session/update' === call.method)
   .map(call => call.params.update.content?.text);

/** A real agent exits when its input ends. */
function exitWhenInputEnds(agent: FakeAgent)
{
   const closeStdin = agent.handle.closeStdin;
   agent.handle.closeStdin = () => { closeStdin(); agent.exit(0); };
}

beforeEach(() => {
   vi.resetModules();
   mocks.connect.mockReset();
   mocks.connect.mockImplementation(() => { mocks.order.push('connect'); });
   mocks.logEntries.length = 0;
   mocks.order.length      = 0;
   mocks.configOverride    = undefined;
   forgetRecordedCalls();
   mocks.registry = registryFile({ alpha: recording('alpha') });
   vi.spyOn(Readable, 'toWeb').mockReturnValue({} as any);
   vi.spyOn(Writable, 'toWeb').mockReturnValue({} as any);
   vi.spyOn(process.stdin, 'on').mockReturnValue(process.stdin);
   vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
   const realOn = process.on.bind(process);
   vi.spyOn(process, 'on').mockImplementation(((event: string, listener: any) =>
      SIGNALS.includes(event) ? process : realOn(event, listener)) as never);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('entry point startup — governance config', () => {
   it('[H] loads the shipped config, from the right path, before connecting', async () => {
      await import('../index.js');
      const engine = await import('../../governance/engine.js');
      const create = vi.mocked(engine.createGovernanceEngine);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].configPath).toBe(SHIPPED_CONFIG);
      expect(existsSync(SHIPPED_CONFIG)).toBe(true);
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      expect(create.mock.invocationCallOrder[0])
         .toBeLessThan(mocks.connect.mock.invocationCallOrder[0]);
   });

   it('the shipped config loads with no config error and no shadow warning', async () => {
      await import('../index.js');
      const problems = ['governance_config_error', 'governance_rule_shadowed'];
      expect(mocks.logEntries.filter(entry => problems.includes(entry.event))).toEqual([]);
   });

   it.each([
      ['an invalid rule', () => writeFile(
         join(dirOf(), 'governance.yaml'),
         'governance:\n  rules:\n    - action: approve\n  default: ask\n',
      ), /rule at index 0 has no constraint/],
      ['a missing file', () => join(dirOf(), 'missing.yaml'), /governance config not found/],
   ])('[H] %s rejects startup, is logged, and the server never connects',
      async (_name, makePath, message) => {
         mocks.configOverride = makePath();
         await expect(import('../index.js')).rejects.toThrow(message);
         expect(mocks.connect).not.toHaveBeenCalled();
         expect(mocks.logEntries.some(entry => 'governance_config_error' === entry.event)).toBe(true);
      });
});

describe('entry point startup — driver registry', () => {
   it('[H] the default location is registry.yaml in the drivers folder, absolute', async () => {
      const real  = '../registry-location.js';
      const { registryPath } = await vi.importActual<typeof import('../registry-location.js')>(real);
      const found = await inside(dirOf(), () => registryPath());
      expect(found).toBe(join(DRIVERS_DIR, 'registry.yaml'));
      expect(isAbsolute(found)).toBe(true);
      expect(found.startsWith(dirOf())).toBe(false);
   });

   it('[H] loads the registry once, builds the catalog from it, resolves on its view', async () => {
      mocks.registry = registryFile(
         { beta: recording('beta'), alpha: missing('alpha') },
         { preferred: { driver: 'alpha' } },
      );
      await import('../index.js');
      const { loadRegistryConfig } = await import('../../drivers/registry.js');
      const { buildDriverCatalog } = await import('../../drivers/driver-catalog.js');
      expect(loadRegistryConfig).toHaveBeenCalledTimes(1);
      expect(buildDriverCatalog).toHaveBeenCalledTimes(1);
      const [options] = vi.mocked(buildDriverCatalog).mock.calls[0];
      expect(options.config).toBe(vi.mocked(loadRegistryConfig).mock.results[0].value);
      expect(options.registryPath).toBe(mocks.registry);
      // alpha failed to load: the catalog view drops it, the loaded registry would still prefer it.
      const { resolver } = await agentDeps();
      expect(resolver.resolve())
         .toMatchObject({ driver: 'beta', model: 'auto', source: 'registry-default' });
   });

   it('[H] reads the file the lookup names and no other', async () => {
      await import('../index.js');
      const { loadRegistryConfig } = await import('../../drivers/registry.js');
      expect(vi.mocked(loadRegistryConfig).mock.calls).toEqual([[mocks.registry]]);
   });

   it('[H] builds the catalog before the server connects, and connects once', async () => {
      await import('../index.js');
      expect(mocks.order).toEqual(['built', 'connect']);
   });

   it('[H] a missing file stops startup naming the path and the example, reading no other', async () => {
      mocks.registry = join(dirOf(), 'absent.yaml');
      const error = await startupError();
      expect(error.name).toBe('RegistryConfigMissingError');
      expect(error.message).toContain(mocks.registry);
      expect(error.message).toContain('registry.example.yaml');
      expect(mocks.connect).not.toHaveBeenCalled();
      const { loadRegistryConfig } = await import('../../drivers/registry.js');
      expect(vi.mocked(loadRegistryConfig).mock.calls).toEqual([[mocks.registry]]);
      expect(failuresAbout(mocks.registry)).toHaveLength(1);
   });

   it.each(BAD_REGISTRIES)('[H] %s stops startup, is logged with the path, never connects',
      async (_name, text, errorName, part) => {
         mocks.registry = writeFile(join(dirOf(), 'registry.yaml'), text);
         const error = await startupError();
         expect(error.name).toBe(errorName);
         expect(error.message).toContain(part);
         expect(mocks.connect).not.toHaveBeenCalled();
         expect(failuresAbout(mocks.registry)).toHaveLength(1);
      });

   it('[H] every driver failing stops startup and lists each failure', async () => {
      mocks.registry = registryFile({ alpha: missing('alpha'), beta: missing('beta') });
      const error = await startupError();
      expect(error.name).toBe('DriverCatalogBuildError');
      expect(error.message).toMatch(/alpha[\s\S]*beta/);
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(failuresAbout(mocks.registry)).toHaveLength(1);
   });

   it('[H] defaults that cannot select a working driver stop startup', async () => {
      // The only driver that lists auto fails; the one that works does not list it.
      mocks.registry = registryFile({
         alpha: missing('alpha', ['auto']),
         beta:  recording('beta', { models: ['m1'] }),
      });
      const error = await startupError();
      expect(error.name).toBe('DriverCatalogBuildError');
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(failuresAbout(mocks.registry)).toHaveLength(1);
   });

   it('[H] one driver failing starts the service on the other, the failure logged once', async () => {
      mocks.registry = registryFile({ beta: recording('beta'), alpha: missing('alpha') });
      await serve();
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      const failures = mocks.logEntries
         .filter(entry => 'alpha' === entry.data.name && undefined !== entry.data.kind);
      expect(failures).toHaveLength(1);
      expect(failures[0].data).toMatchObject({
         kind: DRIVER_FAILURE.moduleNotFound,
         path: join(dirOf(), 'alpha-missing.js'),
      });
      await prompted();
      expect(recordedCalls().map(call => call.driver)).toEqual(['beta']);
   });

   it.each([
      ['a preferred driver that failed',              { driver: 'alpha' },             'alpha'],
      ['a preferred model its driver does not list',  { driver: 'beta', model: 'm9' }, 'm9'],
   ])('[H] %s still starts the service, with one warning', async (_name, preferred, fact) => {
      mocks.registry = registryFile(
         { beta: recording('beta'), alpha: missing('alpha') }, { preferred },
      );
      await import('../index.js');
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      const warnings = mocks.logEntries.filter(entry => 'warn' === entry.level);
      expect(warnings).toHaveLength(1);
      expect(JSON.stringify(warnings[0].data)).toContain(fact);
   });

   it('[H] module paths resolve from the registry file folder, not the working directory', async () => {
      mocks.registry = EXAMPLE_REGISTRY;
      await inside(dirOf(), () => import('../index.js'));
      const { catalog } = await agentDeps();
      expect(catalog.names()).toEqual(['kiro', 'copilot']);
      expect(catalog.preferred.flagged).toBe(false);
   });
});

describe('entry point serving — drivers come from the registry', () => {
   it('[H] a registry with only a custom driver serves a session on it, preferred model', async () => {
      mocks.registry = registryFile(
         { alpha: recording('alpha') }, { preferred: { driver: 'alpha', model: 'm1' } },
      );
      await serve();
      await prompted();
      expect(recordedCalls())
         .toEqual([{ driver: 'alpha', call: 'execute', command: 'go', model: 'm1' }]);
   });

   it('[H] the preferred pair serves every session; one log entry per session, no profile', async () => {
      mocks.registry = registryFile(
         { alpha: recording('alpha'), beta: recording('beta') },
         { preferred: { driver: 'beta', model: 'm1' } },
      );
      await serve();
      await prompted();
      await prompted();
      expect(recordedCalls().map(call => [call.driver, call.model]))
         .toEqual([['beta', 'm1'], ['beta', 'm1']]);
      const dispatches = mocks.logEntries.filter(entry => 'registry-default' === entry.data.source);
      expect(dispatches).toHaveLength(2);
      for (const { data } of dispatches) {
         expect(data).toMatchObject({ driver: 'beta', model: 'm1' });
         expect(data).not.toHaveProperty('profile');
      }
   });

   it('[H] a flagged registry shows the notice in each chat, on the driver in use', async () => {
      mocks.registry = registryFile(
         { alpha: recording('alpha'), beta: recording('beta') },
         { preferred: { driver: 'beta', model: 'm9' } },
      );
      await serve();
      const { catalog } = await agentDeps();
      expect(catalog.notice).toBeDefined();
      const first  = await prompted();
      const second = await prompted();
      for (const cx of [first, second]) { expect(textsOf(cx)[0]).toContain(catalog.notice); }
      expect(recordedCalls().map(call => call.driver))
         .toEqual([catalog.preferred.inUse, catalog.preferred.inUse]);
   });
});

describe('entry point disconnect triggers', () => {
   it('[H] registers a handler for stdin end and each signal before the import returns', async () => {
      await import('../index.js');
      for (const trigger of TRIGGERS) { expect(typeof handlerFor(trigger)).toBe('function'); }
   });

   it.each(TRIGGERS)('[H] %s runs the disconnect once and then exits 0', async trigger => {
      await import('../index.js');
      handlerFor(trigger)?.();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      expect(mocks.onDisconnect).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
   });

   it('[H] the service does not exit while the disconnect is still running', async () => {
      await import('../index.js');
      const slow = deferred<void>();
      mocks.onDisconnect.mockReturnValue(slow.promise);
      handlerFor('SIGTERM')?.();
      await flush();
      expect(process.exit).not.toHaveBeenCalled();
      slow.resolve();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
   });

   it.each([
      ['SIGTERM', 'SIGTERM'], ['SIGTERM', 'SIGINT'], ['stdin end', 'SIGTERM'], ['SIGHUP', 'stdin end'],
   ])('[H] %s then %s: one disconnect, one exit, nothing thrown', async (first, second) => {
      await import('../index.js');
      handlerFor(first)?.();
      expect(() => handlerFor(second)?.()).not.toThrow();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledTimes(1));
      await flush();
      expect(mocks.onDisconnect).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
   });

   it('an idle service closes the driver once, starts nothing, and exits 0', async () => {
      await import('../index.js');
      handlerFor('SIGTERM')?.();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      expect(recordedCalls()).toEqual([{ driver: 'alpha', call: 'close' }]);
   });

   it('[H] a close that rejects does not stop the other drivers; logged, exit non-zero', async () => {
      mocks.registry = registryFile({
         alpha: recording('alpha', { closeFails: true }),
         beta:  recording('beta'),
      });
      await import('../index.js');
      handlerFor('SIGHUP')?.();
      await vi.waitFor(
         () => expect(process.exit).toHaveBeenCalledWith(DISCONNECT_ERROR_EXIT_CODE),
      );
      const closed = recordedCalls().filter(call => 'close' === call.call).map(call => call.driver);
      expect(closed.sort()).toEqual(['alpha', 'beta']);
      expect(mocks.logEntries.some(entry => 'close_failed' === entry.event)).toBe(true);
      expect(mocks.logEntries.some(entry => 'disconnect' === entry.event)).toBe(true);
   });

   it('an onDisconnect that rejects for another reason still ends in a non-zero exit', async () => {
      await import('../index.js');
      mocks.onDisconnect.mockRejectedValue(new Error('unexpected'));
      handlerFor('SIGINT')?.();
      await vi.waitFor(
         () => expect(process.exit).toHaveBeenCalledWith(DISCONNECT_ERROR_EXIT_CODE),
      );
   });
});

describe.each(['kiro', 'copilot'])('entry point disconnect — the built-in %s driver', name => {
   it('[H] ends its agent process exactly once and the service exits 0', async () => {
      const { agents, connect } = fakeAgents(1);
      if ('kiro' === name) { agents[0].respond('initialize', () => KIRO_V3); }
      exitWhenInputEnds(agents[0]);
      builtins(name);
      await serve();
      const { spawnAgent } = await import('../../drivers/acp-driver-core/connect.js');
      vi.mocked(spawnAgent).mockImplementation(connect);
      await prompted();
      handlerFor('SIGTERM')?.();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      expect(agents[0].stdinCloses).toBe(1);
   });
});

describe('entry point disconnect — both built-in drivers in one registry', () => {
   it('[H] closes the used one once, never starts the unused one, and exits 0', async () => {
      const { agents, connect } = fakeAgents(2);
      exitWhenInputEnds(agents[0]);
      builtins('copilot');
      await serve();
      const { spawnAgent } = await import('../../drivers/acp-driver-core/connect.js');
      vi.mocked(spawnAgent).mockImplementation(connect);
      await prompted();
      handlerFor('SIGTERM')?.();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      expect(spawnAgent).toHaveBeenCalledTimes(1);
      expect(agents[0].stdinCloses).toBe(1);
   });
});

describe('entry point shutdown', () => {
   it('[H] stdin ending calls onDisconnect', async () => {
      await import('../index.js');
      const onEnd = vi.mocked(process.stdin.on).mock.calls
         .find(([event]) => 'end' === event)?.[1] as (() => void) | undefined;
      expect(typeof onEnd).toBe('function');
      expect(mocks.onDisconnect).not.toHaveBeenCalled();
      onEnd?.();
      expect(mocks.onDisconnect).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
   });
});
