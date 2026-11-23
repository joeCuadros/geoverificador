import type { Config } from 'jest';

/** Pruebas de las herramientas de datos (tools/lib: descarga, conversión y recolección). */
const config: Config = {
  displayName: 'tools',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['lib/**/*.js'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
