import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo de la aplicación web (chat, mapa y ficha). Autosuficientes: `webServer` arma una base nueva en `.pglite-e2e/`
 * (migraciones, apps/estatica/public/data y unos avisos de prueba; no usa data/) y sirve la aplicación compilada en su propio puerto.
 *
 * No descarga navegadores: usa el Chrome instalado (`channel: 'chrome'`). Si no hay Chrome: E2E_NAVEGADOR=msedge.
 */
const PUERTO = process.env.E2E_PUERTO ?? '3210';
const URL_DE = (desplazamiento: number) => `http://127.0.0.1:${Number(PUERTO) + desplazamiento}`;
const CANAL = process.env.E2E_NAVEGADOR ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: URL_DE(0),
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Tres servidores (los levanta e2e/iniciar-servidor.mjs): principal, sin publicar (ADR 0002) y degradado (errores internos y 429).
  projects: [
    { name: 'chrome', testIgnore: ['**/restringido.spec.ts', '**/degradado.spec.ts'], use: { ...devices['Desktop Chrome'], channel: CANAL, viewport: { width: 1280, height: 800 } } },
    { name: 'sin-publicar', testMatch: '**/restringido.spec.ts', use: { ...devices['Desktop Chrome'], channel: CANAL, viewport: { width: 1280, height: 800 }, baseURL: URL_DE(1) } },
    { name: 'degradado', testMatch: '**/degradado.spec.ts', fullyParallel: false, use: { ...devices['Desktop Chrome'], channel: CANAL, viewport: { width: 1280, height: 800 }, baseURL: URL_DE(2) } },
  ],
  webServer: {
    command: 'node e2e/iniciar-servidor.mjs',
    url: `http://127.0.0.1:${PUERTO}/`,
    timeout: 300_000,
    // E2E_REUSAR_SERVIDOR=1 reutiliza un servidor ya levantado con `node e2e/iniciar-servidor.mjs` (para repetir pruebas sin recompilar).
    reuseExistingServer: process.env.E2E_REUSAR_SERVIDOR === '1',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PUERTO: PUERTO },
  },
});
