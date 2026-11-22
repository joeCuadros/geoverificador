import { readFileSync } from 'node:fs';
import type { Config } from 'jest';

/**
 * Corre las pruebas de test/ SIN TOCARLAS contra el paquete de dominio (packages/dominio/src/nucleo, módulos ES) en lugar de public/js.
 * Cada `require('../public/js/x.js')` se redirige al puente CommonJS que genera scripts/generar-dominio.mjs. Tarea 5.2 y ADR 0007.
 */
const modulos = JSON.parse(readFileSync('./packages/dominio/cjs/modulos.json', 'utf8')) as string[];

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.spec\\.ts$',
  // auth-controller.spec.ts prueba el controlador de NestJS (src/), no el dominio, y necesita el modo ESM de Jest.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/web/', 'test/auth-controller\\.spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { diagnostics: false, tsconfig: { allowJs: true, module: 'commonjs', moduleResolution: 'node10', esModuleInterop: true, isolatedModules: true, target: 'ES2023' } }],
  },
  moduleNameMapper: {
    [`^(?:\\.\\./)+public/js/(${modulos.join('|')})\\.js$`]: '<rootDir>/packages/dominio/cjs/$1.js',
  },
  setupFiles: ['<rootDir>/test/apoyo/puente-entorno.js'],
  testEnvironment: 'node',
};

export default config;
