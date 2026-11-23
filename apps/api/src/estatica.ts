import { join } from 'path';

// Both src/ (ts-jest, nest start) and dist/ (node dist/main) sit in apps/api/, so the same relative path works in either.
export const RAIZ_DEL_REPOSITORIO = join(__dirname, '..', '..', '..');

/** The legacy static front (apps/estatica/public) that this server also serves. */
export const CARPETA_ESTATICA = join(__dirname, '..', '..', 'estatica', 'public');
