/**
 * Shared error infrastructure for the ACP package.
 *
 * `TguDiiltError` is the base every project-defined error extends — it
 * exists so error-handling code can distinguish "one of ours" from a
 * library/language error via `instanceof TguDiiltError`, and distinguish
 * *which* kind of ours via `instanceof TheSpecificError` or `.name`.
 *
 * `defineError` is a class factory: it generates a real, distinct,
 * `instanceof`-able subclass of `TguDiiltError` bound to a fixed `name`,
 * from a small per-error-type message builder. This keeps the boilerplate
 * (base class wiring, `name` assignment) to one shared implementation
 * while every error type stays its own real class — `new FooError(...)`
 * and `err instanceof FooError` both work exactly as if `FooError` had
 * been hand-written.
 *
 * See `shared/logger.ts`'s `printErrorMessage` for rendering a `TguDiiltError`
 * (or any error) including its `cause` chain to a single string.
 */

/** Base type for every error this project defines. */
export abstract class TguDiiltError extends Error {}

/**
 * Defines a new concrete `TguDiiltError` subclass bound to a fixed
 * `name`. `buildMessage` receives the constructor's arguments and
 * returns the error message (and optional `cause`); it is the only
 * per-error-type logic callers need to write.
 *
 * Returns the class itself — callers do `new TheError(...args)` exactly as
 * with a hand-written class; `instanceof TheError` and
 * `instanceof TguDiiltError` both work.
 */
export function defineError<Args extends unknown[]>(
   name: string,
   buildMessage: (...args: Args) => { message: string; cause?: unknown },
) {
   return class extends TguDiiltError {
      constructor(...args: Args) {
         const { message, cause } = buildMessage(...args);
         super(message, undefined !== cause ? { cause } : undefined);
         this.name = name;
      }
   };
}
