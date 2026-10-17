import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';

/**
 * Startup wiring of the stdio entry point. `index.ts` runs as soon as it is
 * imported, so each test re-imports it with the SDK, the file logger and
 * the stdio conversions mocked. The governance engine and the shipped
 * config are real: the point is that the config is loaded from the right
 * place BEFORE the server connects, and that a bad config stops startup.
 */
const mocks = vi.hoisted(() => ({
   connect:        vi.fn(),
   logEntries:     [] as Array<{ level: string; event: string; data: any }>,
   configOverride: undefined as string | undefined,
   onDisconnect:   undefined as any,
}));

vi.mock('@agentclientprotocol/sdk', () => {
   const chain: any = { onRequest: () => chain, onNotification: () => chain, connect: mocks.connect };
   return {
      agent:            () => chain,
      ndJsonStream:     () => ({}),
      PROTOCOL_VERSION: 1,
      methods: {
         agent: {
            initialize: 'initialize',
            session:    { new: 'session/new', load: 'session/load', prompt: 'session/prompt', cancel: 'session/cancel' },
         },
      },
   };
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
         undefined === mocks.configOverride ? options : { ...options, configPath: mocks.configOverride },
      )),
   };
});

// Real agent; only a spy on its onDisconnect, to prove the stdin wiring calls it.
vi.mock('../agent.js', async importOriginal => {
   const actual = await importOriginal<typeof import('../agent.js')>();
   return {
      ...actual,
      createAgent: vi.fn((deps: any) => {
         const service = actual.createAgent(deps);
         mocks.onDisconnect = vi.spyOn(service, 'onDisconnect');
         return service;
      }),
   };
});

const SHIPPED_CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'governance', 'config.yaml');

let dir: string;

beforeEach(() => {
   vi.resetModules();
   mocks.connect.mockClear();
   mocks.logEntries.length = 0;
   mocks.configOverride    = undefined;
   vi.spyOn(Readable, 'toWeb').mockReturnValue({} as any);
   vi.spyOn(Writable, 'toWeb').mockReturnValue({} as any);
   vi.spyOn(process.stdin, 'on').mockReturnValue(process.stdin);
   dir = mkdtempSync(join(tmpdir(), 'index-test-'));
});

afterEach(() => {
   vi.restoreAllMocks();
   rmSync(dir, { recursive: true, force: true });
});

describe('entry point startup — governance config', () => {
   it('[H] loads the shipped config, from the right path, before connecting', async () => {
      await import('../index.js');
      const engine = await import('../../governance/engine.js');
      const create = vi.mocked(engine.createGovernanceEngine);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].configPath).toBe(SHIPPED_CONFIG);
      expect(existsSync(SHIPPED_CONFIG)).toBe(true);
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(mocks.connect.mock.invocationCallOrder[0]);
   });

   it('the shipped config loads with no config error and no shadow warning', async () => {
      await import('../index.js');
      expect(mocks.logEntries.filter(e => ['governance_config_error', 'governance_rule_shadowed'].includes(e.event)))
         .toEqual([]);
   });

   it.each([
      ['an invalid rule', () => {
         const path = join(dir, 'governance.yaml');
         writeFileSync(path, 'governance:\n  rules:\n    - action: approve\n  default: ask\n');
         return path;
      }, /rule at index 0 has no constraint/],
      ['a missing file', () => join(dir, 'missing.yaml'), /governance config not found/],
   ])('[H] %s rejects startup, is logged, and the server never connects', async (_name, makePath, message) => {
      mocks.configOverride = makePath();
      await expect(import('../index.js')).rejects.toThrow(message);
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.logEntries.some(e => 'governance_config_error' === e.event)).toBe(true);
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
   });
});
