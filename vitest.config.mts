import { defineConfig } from 'vitest/config';

/**
 * Pruebas del código nuevo (paquetes y aplicación Next.js). Las pruebas de siempre siguen en Jest (`pnpm test`).
 * Las de integración usan una base PostgreSQL + PostGIS embebida (PGlite) que se arma una vez en pruebas/preparar-base.ts.
 */
export default defineConfig({
  test: {
    include: ['packages/*/pruebas/**/*.test.ts', 'apps/web/pruebas/**/*.test.ts', 'arquitectura/**/*.test.ts'],
    globalSetup: ['./packages/datos/pruebas/preparar-base.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
