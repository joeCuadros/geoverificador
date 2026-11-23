import { defineConfig } from 'vitest/config';

/** Solo la prueba de capas (arquitectura/): no arma la base de datos embebida, así corre en segundos. `pnpm test:arquitectura`. */
export default defineConfig({
  test: {
    include: ['arquitectura/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
