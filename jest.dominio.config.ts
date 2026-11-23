import { readFileSync } from 'node:fs';
import type { Config } from 'jest';

/**
 * Corre las pruebas de apps/estatica/test y de tools/test SIN TOCARLAS contra el paquete de dominio (packages/dominio/src/nucleo, módulos ES) en lugar de apps/estatica/public/js.
 * Cada `require('../public/js/x.js')` (o `../../apps/estatica/public/js/x.js` desde tools/test) se redirige al puente CommonJS que genera tools/generar-dominio.mjs. Tarea 5.2 y ADR 0007.
 */
const modulos = JSON.parse(readFileSync('./packages/dominio/cjs/modulos.json', 'utf8')) as string[];

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '(apps/estatica|tools)/test/.*\\.spec\\.ts$',
  // Las pruebas de apps/api prueban los controladores de NestJS, no el dominio, y necesitan el modo ESM de Jest.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/apps/web/', '/apps/api/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { diagnostics: false, tsconfig: { allowJs: true, module: 'commonjs', moduleResolution: 'node10', esModuleInterop: true, isolatedModules: true, target: 'ES2023' } }],
  },
  moduleNameMapper: {
    [`^(?:\\.\\./)+(?:apps/estatica/)?public/js/(${modulos.join('|')})\\.js$`]: '<rootDir>/packages/dominio/cjs/$1.js',
  },
  setupFiles: ['<rootDir>/apps/estatica/test/apoyo/puente-entorno.js'],
  testEnvironment: 'node',
};

export default config;
