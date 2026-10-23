import { PreferredDefaults, RegistryConfig, RegistryDriverEntry } from '../registry.js';

/** Module path for registry fixtures that never import the module. */
export const FIXTURE_MODULE = './fixture-driver.js';

/** Registry entry fixture: the given models plus a placeholder module. */
export function driverEntry(models: string[]): RegistryDriverEntry
{ return { module: FIXTURE_MODULE, models }; }

/** Model lists by driver name, in registry order. */
export type ModelLists = Record<string, string[]>;

type EntryOf = (name: string, list: string[]) => RegistryDriverEntry;

/**
 * Registry config from model lists by driver name. `preferred` and `extra` are
 * added when given. `entryOf` builds each driver entry; the default is the
 * placeholder module.
 */
export function registryOf(
   models:     ModelLists,
   preferred?: PreferredDefaults,
   extra:      Partial<RegistryConfig> = {},
   entryOf:    EntryOf = (_name, list) => driverEntry(list),
): RegistryConfig
{
   const drivers = Object.fromEntries(
      Object.entries(models).map(([name, list]) => [name, entryOf(name, list)]),
   );
   return { drivers, ...(undefined !== preferred ? { preferred } : {}), ...extra };
}

/** Names every object has. A registry never lists them, and nothing may throw on them. */
export const INHERITED_NAMES = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];

/** "kiro" then "copilot": both list auto and m1, each lists one more model. */
export const TWO_DRIVERS: ModelLists = {
   kiro:    ['auto', 'm1', 'm2'],
   copilot: ['auto', 'm1', 'm3'],
};

const KIRO_WITHOUT_AUTO:    ModelLists = { ...TWO_DRIVERS, kiro:    ['m1', 'm2'] };
const COPILOT_WITHOUT_AUTO: ModelLists = { ...TWO_DRIVERS, copilot: ['m1', 'm3'] };

/** The (model, driver) pair the registry defaults resolve to. */
export interface DefaultsPair { model: string; driver: string; }

/** A label, the preferred section, the model lists, and the pair the defaults resolve to. */
type DefaultsCase = [string, PreferredDefaults | undefined, ModelLists, DefaultsPair];

export const DEFAULT_CASES: DefaultsCase[] = [
   [
      'the preferred pair, both listed',
      { driver: 'copilot', model: 'm3' }, TWO_DRIVERS, { model: 'm3', driver: 'copilot' },
   ],
   [
      'two drivers list the model: the preferred driver wins',
      { driver: 'copilot', model: 'm1' }, TWO_DRIVERS, { model: 'm1', driver: 'copilot' },
   ],
   [
      'a driver only means auto on that driver',
      { driver: 'copilot' }, TWO_DRIVERS, { model: 'auto', driver: 'copilot' },
   ],
   [
      'no preferred: auto on the first driver listed',
      undefined, TWO_DRIVERS, { model: 'auto', driver: 'kiro' },
   ],
   [
      'no preferred and the first driver has no auto',
      undefined, KIRO_WITHOUT_AUTO, { model: 'auto', driver: 'copilot' },
   ],
   [
      'the preferred driver lacks the model, another lists it',
      { driver: 'kiro', model: 'm3' }, TWO_DRIVERS, { model: 'm3', driver: 'copilot' },
   ],
   [
      'nobody lists the model: auto on the preferred driver',
      { driver: 'copilot', model: 'm9' }, TWO_DRIVERS, { model: 'auto', driver: 'copilot' },
   ],
   [
      'nobody lists the model and the preferred driver has no auto',
      { driver: 'copilot', model: 'm9' }, COPILOT_WITHOUT_AUTO, { model: 'auto', driver: 'kiro' },
   ],
   [
      'a preferred driver that is not listed, the model is listed',
      { driver: 'kiroo', model: 'm3' }, TWO_DRIVERS, { model: 'm3', driver: 'copilot' },
   ],
   [
      'a preferred driver that is not listed, nobody lists the model',
      { driver: 'kiroo', model: 'm9' }, TWO_DRIVERS, { model: 'auto', driver: 'kiro' },
   ],
];
