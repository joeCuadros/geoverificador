import type { Config } from 'jest';

/** Pruebas del front estático (public/js) y de las funciones de Vercel (api/). */
const config: Config = {
  displayName: 'estatica',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['public/js/**/*.js', 'api/**/*.js'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
