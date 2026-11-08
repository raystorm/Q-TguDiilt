/**
 * Model dispatch result types.
 *
 * Registry schema types (`RegistryConfig`, `ProfilePreference`,
 * `PreferredDefaults`, `FallbackMode`, etc.) live in `../drivers/registry.js`
 * — that module owns the registry YAML file and its format. This module
 * only defines types specific to the dispatch resolver itself.
 */

/**
 * What a profile's entry asked for, when the result differs from it.
 *
 * `reason` is the first cause that applies:
 * - `driver not available`: the entry names a driver the registry does not list (or that
 *   failed to load, so the resolver never sees it).
 * - `model not listed`: the asked driver, or every driver, does not list the model.
 * - `entry could not be resolved`: nothing resolved from the entry, so the registry
 *   defaults were used.
 */
export interface DispatchSubstitution {
   /** The entry as written. `driver` is absent when the entry has none. */
   asked:  { model: string; driver?: string };
   reason: 'driver not available' | 'model not listed' | 'entry could not be resolved';
}

/** The outcome of a successful dispatch resolution. */
export interface DispatchResult {
   driver: string;
   model:  string;
   /** Which resolution source supplied the winning (model, driver) pair. */
   source: 'profile' | 'registry-default';
   /**
    * Set when a profile entry was tried and the result differs from what it asked.
    * A result without it matches the entry exactly, or there was no entry.
    */
   substitution?: DispatchSubstitution;
}
