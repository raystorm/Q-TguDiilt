import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
   createDiagnostics, createLogger,
} from '../acp-driver-core/__tests__/acp-driver.helpers.js';
import { failureOf } from '../acp-driver-core/__tests__/failures.helpers.js';
import { startStub, stubKiroCliBin } from '../acp-driver-core/__tests__/stub-agent.helpers.js';
import { AgentNotFoundError } from '../acp-driver-core/errors.js';
import { KIRO_ARGS, KIRO_COMMAND, createKiroAcpDriver } from '../kiro-driver-acp.js';

let bin: string;
let path: string | undefined;
let stub: ReturnType<typeof startStub>;

beforeEach(() => {
   bin  = stubKiroCliBin();
   path = process.env.PATH;
   stub = startStub();
});
afterEach(() => {
   process.env.PATH = path;
   stub.stop();
   rmSync(bin, { recursive: true, force: true });
});

describe.skipIf('win32' === process.platform)('the Kiro driver over the real connect', () => {
   it('[H] starts kiro-cli from PATH with the specified arguments and the service directory', async () => {
      process.env.PATH = bin;
      const driver = createKiroAcpDriver({
         logger: createLogger(), diagnostics: createDiagnostics(),
      });
      await driver.execute('go');
      await driver.close();
      expect(stub.state()).toMatchObject({ argv: [...KIRO_ARGS], cwd: realpathSync(process.cwd()) });
   });

   it('[H] a missing kiro-cli is an error that names it', async () => {
      process.env.PATH = join(bin, 'nothing-here');
      const driver = createKiroAcpDriver({
         logger: createLogger(), diagnostics: createDiagnostics(),
      });
      const error = await failureOf(driver.execute('go'));
      expect(error).toBeInstanceOf(AgentNotFoundError);
      expect(error?.message).toContain(KIRO_COMMAND);
   });
});
