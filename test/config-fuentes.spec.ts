/**
 * Pruebas de las fuentes citadas para los umbrales de public/js/config.js.
 * Los valores de los umbrales son una decisión del equipo: esta prueba los fija para que un cambio de texto de la fuente
 * no los mueva sin querer, y exige que la fuente nombre la norma y el artículo o la página verificados.
 * config.js es JavaScript de navegador sin exportación, así que se evalúa en un contexto aislado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

type Config = {
  umbrales: {
    educacion: { inicial: number; primaria: number; secundaria: number };
    areaVerde: { distanciaM: number; areaMinM2: number; areaGrandeM2: number };
  };
  fuentesUmbral: { educacion: string; areaVerde: string };
};

function cargarConfig(): Config {
  const codigo = readFileSync(join(__dirname, '..', 'public', 'js', 'config.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`${codigo}\nglobalThis.__CONFIG = CONFIG;`, ctx, { filename: 'config.js' });
  return (ctx as { __CONFIG: Config }).__CONFIG;
}

describe('fuentes de los umbrales (config.js)', () => {
  const config = cargarConfig();

  it('no cambia los valores de los umbrales de educación ni de área verde', () => {
    expect(config.umbrales.educacion).toEqual({ inicial: 500, primaria: 1500, secundaria: 3000 });
    expect(config.umbrales.areaVerde).toEqual({ distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 });
  });

  it('la fuente de educación cita las dos RVM, el numeral 7.1 y que las distancias son referenciales', () => {
    const f = config.fuentesUmbral.educacion;
    expect(f).toMatch(/RVM 104-2019-MINEDU/);
    expect(f).toMatch(/RVM 208-2019-MINEDU/);
    expect(f).toMatch(/7\.1/);
    expect(f).toMatch(/Cuadro N\.° 1/);
    expect(f).toMatch(/referencial/i);
  });

  it('la fuente de educación no remite a un instructivo que no se verificó', () => {
    expect(config.fuentesUmbral.educacion).not.toMatch(/Instructivo FTE/);
  });

  it('la fuente de área verde cita el informe de la OMS Europa con su página y dice que es un indicador, no una norma', () => {
    const f = config.fuentesUmbral.areaVerde;
    expect(f).toMatch(/OMS Europa/);
    expect(f).toMatch(/Urban green spaces and health/);
    expect(f).toMatch(/p\. 39/);
    expect(f).toMatch(/indicador/i);
  });
});
