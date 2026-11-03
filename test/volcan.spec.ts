/**
 * Pruebas de public/js/volcan.js (peligro volcánico del Misti): punto en polígono con MultiPolygon y huecos, el nivel más
 * alto por fenómeno, las frases (sin «cumple» ni puntaje) y el reparto por distrito. Datos hechos a mano; al final, unas
 * comprobaciones contra el archivo congelado real.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Volcan = require('../public/js/volcan.js');
const fs = require('fs');
const path = require('path');

// Cuadrado de `l` grados de lado con la esquina suroeste en (x, y); anillo cerrado.
const cuadrado = (x: number, y: number, l: number) => [[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]];
const feat = (tipo: string, nivel: string, coordinates: number[][][][], extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'MultiPolygon', coordinates },
  properties: { tipo, nivel, etiqueta: `Peligro ${nivel}`, escenario: null, detalle: null, capa: `Capa ${tipo} ${nivel}`, ...extra },
});

// Zonas de prueba (grados): un lahar bajo grande con un hueco, un lahar alto dentro del hueco, un flujo piroclástico alto
// en dos partes separadas (MultiPolygon) y ceniza en tres escenarios.
const zonas = Volcan.indexar([
  feat('lahar', 'bajo', [[cuadrado(0, 0, 10), cuadrado(4, 4, 2)]]),
  feat('lahar', 'alto', [[cuadrado(4.5, 4.5, 1)]]),
  feat('flujo_piroclastico', 'alto', [[cuadrado(0, 0, 1)], [cuadrado(8, 8, 1)]]),
  feat('ceniza', 'bajo', [[cuadrado(-20, -20, 60)]], { escenario: 'vulcaniana', deposito: '≤ 1 mm' }),
  feat('ceniza', 'alto', [[cuadrado(-1, -1, 4)]], { escenario: 'pliniana', deposito: '≤ 100 cm' }),
]);
const en = (lon: number, lat: number) => Volcan.enZonas(lat, lon, zonas);
const tipos = (lon: number, lat: number) => en(lon, lat).map((z: { tipo: string; nivel: string }) => `${z.tipo}:${z.nivel}`).sort();

describe('Volcan.enZonas: punto en polígono', () => {
  it('un punto dentro de un polígono devuelve su fenómeno y su nivel', () => {
    expect(tipos(2, 8)).toEqual(['ceniza:bajo', 'lahar:bajo']);
  });
  it('un punto en el hueco de un polígono queda fuera de él (y dentro del polígono que llena el hueco)', () => {
    expect(tipos(5, 5)).toEqual(['ceniza:bajo', 'lahar:alto']); // el hueco del lahar bajo está lleno por el lahar alto
    expect(tipos(4.2, 4.2)).toEqual(['ceniza:bajo']); // hueco sin otro polígono: ningún lahar
  });
  it('un MultiPolygon cuenta si el punto cae en cualquiera de sus partes', () => {
    expect(tipos(8.5, 8.5)).toContain('flujo_piroclastico:alto');
    expect(tipos(0.5, 0.5)).toContain('flujo_piroclastico:alto');
    expect(tipos(5, 0.5)).not.toContain('flujo_piroclastico:alto');
  });
  it('un punto fuera de todo no devuelve nada', () => {
    expect(en(50, 50)).toEqual([]);
  });
  it('ignora lo que no es un polígono o no tiene tipo y nivel conocidos', () => {
    const z = Volcan.indexar([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { tipo: 'lahar', nivel: 'alto' } },
      feat('inventado', 'alto', [[cuadrado(0, 0, 1)]]),
      feat('lahar', 'enorme', [[cuadrado(0, 0, 1)]]),
      feat('lahar', 'alto', [[cuadrado(0, 0, 1)]]),
    ]);
    expect(z).toHaveLength(1);
  });
});

describe('Volcan.resumirPunto', () => {
  it('deja el nivel más alto de cada fenómeno y los ordena (lahares primero, ceniza al final)', () => {
    const r = Volcan.resumirPunto(en(0.5, 0.5)); // lahar bajo, flujo alto y ceniza (bajo vulcaniano y alto pliniano)
    expect(r.map((x: { tipo: string; nivel: string }) => `${x.tipo}:${x.nivel}`)).toEqual(['lahar:bajo', 'flujo_piroclastico:alto', 'ceniza:alto']);
  });
  it('sin zonas, la lista está vacía', () => {
    expect(Volcan.resumirPunto([])).toEqual([]);
  });
});

describe('Volcan.frasePunto: informativa, sin cumple ni puntaje', () => {
  it('un solo fenómeno: «peligro bajo por lahares del Misti, según el IGP»', () => {
    const z = Volcan.indexar([feat('lahar', 'bajo', [[cuadrado(0, 0, 10)]])]);
    const f = Volcan.frasePunto(Volcan.resumirPunto(Volcan.enZonas(5, 5, z)));
    expect(f).toBe('Tu punto está en zona de peligro bajo por lahares del Misti, según el IGP.');
  });
  it('varios fenómenos se agrupan por nivel, del más alto al más bajo', () => {
    const f = Volcan.frasePunto(Volcan.resumirPunto([
      { tipo: 'lahar', nivel: 'bajo' }, { tipo: 'avalancha', nivel: 'alto' }, { tipo: 'lava', nivel: 'bajo' },
    ]));
    expect(f).toBe('Tu punto está en zona de peligro alto por avalanchas de escombros y bajo por lahares y flujos de lava del Misti, según el IGP.');
  });
  it('la ceniza aclara que depende del escenario de erupción', () => {
    expect(Volcan.frasePunto(Volcan.resumirPunto([{ tipo: 'ceniza', nivel: 'moderado' }]))).toContain('ceniza volcánica (según el escenario de erupción)');
  });
  it('la ceniza no se atribuye al Misti: la capa del IGP no indica de qué volcán es', () => {
    const solo = Volcan.frasePunto(Volcan.resumirPunto([{ tipo: 'ceniza', nivel: 'moderado' }]));
    expect(solo).not.toMatch(/Misti/);
    expect(solo).toBe('Tu punto está en zona de peligro moderado por ceniza volcánica (según el escenario de erupción), según el IGP; la capa de ceniza no indica de qué volcán es.');
    const mixto = Volcan.frasePunto(Volcan.resumirPunto([{ tipo: 'ceniza', nivel: 'alto' }, { tipo: 'lahar', nivel: 'bajo' }]));
    expect(mixto).toBe('Tu punto está en zona de peligro bajo por lahares del Misti, según el IGP. También está en zona de peligro alto por ceniza volcánica (según el escenario de erupción); la capa de ceniza no indica de qué volcán es.');
  });
  it('fuera de las zonas lo dice sin afirmar que no haya peligro', () => {
    const f = Volcan.frasePunto([]);
    expect(f).toMatch(/no cae dentro de ninguna zona de peligro volcánico/);
    expect(f).toMatch(/no significa que no haya peligro/);
  });
  it('nunca dice cumple ni da un puntaje', () => {
    const f = Volcan.frasePunto(Volcan.resumirPunto(en(5, 5)));
    expect(f).not.toMatch(/cumple|puntaje|riesgo bajo/i);
    expect(f).not.toMatch(/\d/);
  });
});

describe('Volcan.lineasPunto', () => {
  it('una línea por fenómeno; la ceniza trae el nivel y el depósito de cada escenario', () => {
    const l = Volcan.lineasPunto(Volcan.resumirPunto(en(0.5, 0.5)));
    expect(l.map((x: { texto: string }) => x.texto)).toEqual([
      'Lahares: peligro bajo.',
      'Flujos piroclásticos: peligro alto.',
      'Ceniza volcánica: peligro alto (erupción vulcaniana: bajo, depósito ≤ 1 mm; erupción pliniana: alto, depósito ≤ 100 cm).',
    ]);
  });
  it('el alcance con decimales usa la coma', () => {
    const l = Volcan.lineasPunto(Volcan.resumirPunto([{ tipo: 'flujo_piroclastico', nivel: 'alto', detalle: 'Alcance 2 km a 4.2 km' }]));
    expect(l[0].texto).toBe('Flujos piroclásticos: peligro alto (alcance 2 km a 4,2 km).');
  });
});

describe('Volcan.porDistrito: parte del distrito en cada nivel', () => {
  // Un distrito de ~2 km de lado cerca del Misti (el paso de la muestra está en metros).
  const o = { x: -71.5, y: -16.4 };
  const g = 2000 / ((Math.PI / 180) * 6371008.8); // 2 km en grados
  const distrito = [[cuadrado(o.x, o.y, g)]]; // un polígono con un anillo
  const mitad = [[[o.x, o.y], [o.x + g / 2, o.y], [o.x + g / 2, o.y + g], [o.x, o.y + g], [o.x, o.y]]]; // la mitad oeste
  const zs = Volcan.indexar([feat('lahar', 'alto', [mitad]), feat('lahar', 'bajo', [[cuadrado(o.x, o.y, g)]]), feat('lava', 'moderado', [[cuadrado(o.x - 1, o.y - 1, 0.5)]])]);

  it('reparte el área entre los niveles: la mitad en alto y la otra en bajo', () => {
    const r = Volcan.porDistrito(zs, distrito, { pasoM: 100 });
    expect(r.porTipo.lahar.alto).toBeGreaterThan(45);
    expect(r.porTipo.lahar.alto).toBeLessThan(55);
    expect(r.porTipo.lahar.bajo + r.porTipo.lahar.alto).toBeCloseTo(100, 5);
    expect(r.porTipo.lahar.ninguno).toBe(0);
  });
  it('un fenómeno que no toca el distrito queda en 0 % y no sale en la frase', () => {
    const r = Volcan.porDistrito(zs, distrito, { pasoM: 200 });
    expect(r.porTipo.lava.ninguno).toBe(100);
    const f = Volcan.fraseDistrito('Paucarpata', r);
    expect(f).toContain('Lahares');
    expect(f).not.toContain('lava');
    expect(f).toMatch(/según el IGP/);
  });
  it('los porcentajes de cada fenómeno suman 100', () => {
    const r = Volcan.porDistrito(zs, distrito, { pasoM: 150 });
    Object.values(r.porTipo).forEach((p: any) => expect(p.alto + p.moderado + p.bajo + p.ninguno).toBeCloseTo(100, 5));
  });
  it('un distrito que no toca ninguna zona lo dice sin afirmar que no haya peligro', () => {
    const lejos = [[cuadrado(0, 0, g)]];
    const f = Volcan.fraseDistrito('Yura', Volcan.porDistrito(zs, lejos, { pasoM: 200 }));
    expect(f).toMatch(/Ninguna parte de Yura/);
    expect(f).toMatch(/no significa que no haya peligro/);
  });
  it('sin zonas o sin distrito no inventa nada', () => {
    expect(Volcan.porDistrito([], distrito).muestras).toBe(0);
    expect(Volcan.fraseDistrito('X', Volcan.porDistrito(zs, []))).toMatch(/No pude medir/);
  });
});

describe('Volcan.leyenda: una línea por nivel', () => {
  const zs = Volcan.indexar([
    feat('lahar', 'alto', [[cuadrado(0, 0, 1)]]), feat('lahar', 'bajo', [[cuadrado(0, 0, 1)]]), feat('lava', 'alto', [[cuadrado(0, 0, 1)]]), feat('ceniza', 'alto', [[cuadrado(0, 0, 1)]]),
  ]);
  it('agrupa los fenómenos por nivel, del más alto al más bajo, y no dibuja la ceniza', () => {
    const l = Volcan.leyenda(zs);
    expect(l.map((x: { texto: string }) => x.texto)).toEqual(['Peligro alto: lahares y flujos de lava', 'Peligro bajo: lahares']);
  });
  it('con un fenómeno pedido, solo ese', () => {
    expect(Volcan.leyenda(zs, { tipos: ['lava'] }).map((x: { texto: string }) => x.texto)).toEqual(['Peligro alto: flujos de lava']);
  });
  it('pedir solo ceniza no dibuja nada', () => {
    expect(Volcan.leyenda(zs, { tipos: ['ceniza'] })).toEqual([]);
  });
});

describe('Datos congelados reales (public/data/peligro_volcanico_misti.geojson)', () => {
  const fc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'peligro_volcanico_misti.geojson'), 'utf8'));
  const real = Volcan.indexar(fc.features);
  it('todos los polígonos tienen tipo, nivel y capa de origen, y la metadata cita la fuente y la referencia', () => {
    expect(real).toHaveLength(fc.features.length);
    expect(fc.features.every((f: any) => f.properties.capa && f.properties.capaId)).toBe(true);
    expect(fc.metadata.fuente).toMatch(/Instituto Geofísico/);
    expect(fc.metadata.referencia).toMatch(/Boletín/);
    expect(fc.metadata.fechaDelMapa).toMatch(/Sin metadatos de fecha/);
  });
  it('la cima del Misti está en zona de peligro alto de flujos piroclásticos y avalanchas', () => {
    const r = Volcan.resumirPunto(Volcan.enZonas(-16.294, -71.409, real));
    expect(r.find((x: any) => x.tipo === 'flujo_piroclastico').nivel).toBe('alto');
    expect(r.find((x: any) => x.tipo === 'avalancha').nivel).toBe('alto');
  });
  it('un punto del desierto lejos del volcán no tiene zonas de lahares ni de flujos', () => {
    const r = Volcan.resumirPunto(Volcan.enZonas(-16.55, -71.7, real));
    expect(r.find((x: any) => x.tipo === 'lahar')).toBeUndefined();
    expect(r.find((x: any) => x.tipo === 'flujo_piroclastico')).toBeUndefined();
  });
});
