import type { Config } from 'jest';

/** Una sola corrida de Jest para las tres piezas con pruebas de siempre; cada una tiene su configuración. `pnpm test`. */
const config: Config = {
  projects: ['<rootDir>/apps/api', '<rootDir>/apps/estatica', '<rootDir>/tools'],
};

export default config;
