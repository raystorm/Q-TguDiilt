/**
 * Model dispatch result types.
 *
 * Registry schema types (`RegistryConfig`, `ProfilePreference`,
 * `PreferredModel`, `FallbackMode`, etc.) live in `../drivers/registry.js`
 * — that module owns the registry YAML file and its format. This module
 * only defines types specific to the dispatch resolver itself.
 */

/** The outcome of a successful dispatch resolution. */
export interface DispatchResult {
   driver: string;
   model:  string;
   /** Which resolution source supplied the winning (model, driver) pair. */
   source: 'profile' | 'registry-default';
}
