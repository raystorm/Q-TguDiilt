/**
 * The end of the service. Whichever of stdin end, SIGTERM, SIGINT or SIGHUP happens first runs the
 * disconnect once, then the service exits; later triggers are ignored.
 */

/** How long a disconnect may take before the service exits anyway. */
export const DISCONNECT_BOUND_MS = 10000;

/** The exit status after a disconnect that failed or hit the bound. */
export const DISCONNECT_ERROR_EXIT_CODE = 1;

export interface ShutdownDeps {
   /** Releases everything. A rejection, or taking longer than the bound, means the disconnect failed. */
   disconnect: () => Promise<void>;
   exit:       (code: number) => void;
}

/** The handler for every trigger: the first call runs the disconnect and exits; later calls do nothing. */
export function createShutdownHandler({ disconnect, exit }: ShutdownDeps): () => void {
   let started = false;
   return () => {
      if (started) { return; }
      started = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const bound = new Promise<'bound'>(resolve => { timer = setTimeout(() => resolve('bound'), DISCONNECT_BOUND_MS); });
      const run   = (async () => disconnect())().then(() => 'done' as const, () => 'failed' as const);
      void Promise.race([run, bound]).then(outcome => {
         clearTimeout(timer);
         exit('done' === outcome ? 0 : DISCONNECT_ERROR_EXIT_CODE);
      });
   };
}
