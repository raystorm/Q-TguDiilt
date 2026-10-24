import { buildDriverCatalog, type BuildDriverCatalogOptions } from '../driver-catalog.js';
import { createDiagnostics } from '../acp-driver-core/__tests__/acp-driver.helpers.js';

/** Builds a catalog with a recording diagnostics seam, which every catalog requires. */
export const buildCatalog = (options: Omit<BuildDriverCatalogOptions, 'diagnostics'>) =>
   buildDriverCatalog({ ...options, diagnostics: createDiagnostics() });
