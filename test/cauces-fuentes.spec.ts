/**
 * Pruebas de la unión de cauces de varias fuentes (scripts/lib/cauces.js, scripts/lib/geometria.js) y de lo que el contexto
 * dice de ellos (Calculos.evaluarCauces con fuente, quebradasMencionadas, quebradasAusentes). Sin red: geometrías hechas a mano.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Cauces = require('../scripts/lib/cauces.js');
const Geo = require('../scripts/lib/geometria.js');
const Calculos = require('../public/js/calculos.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const O = { lat: -16.4, lon: -71.53 };
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((O.lat * Math.PI) / 180));
// Una línea norte-sur de `largoM` metros, desplazada `este` metros al este del origen y `y0` metros al norte.
const linea = (este: number, largoM = 1000, y0 = 0) => ({
  type: 'LineString',
  coordinates: [[O.lon + dLon(este), O.lat + dLat(y0)], [O.lon + dLon(este), O.lat + dLat(y0 + largoM)]],
});
const cand = (fuente: string, nombre: string | null, geometry: unknown, extra = {}) => ({ fuente, capa: null, nombre, tipo: null, categoria: null, cuenca: null, longKm: null, geometry, ...extra });
type F = { properties: Record<string, any> };

describe('Cauces.nombreLegible', () => {
  it('expande «Qda.» y restituye las tildes conocidas', () => {
    expect(Cauces.nombreLegible('Qda. San Lazaro')).toBe('Quebrada San Lázaro');
    expect(Cauces.nombreLegible('Rio Chili')).toBe('Río Chili');
    expect(Cauces.nombreLegible('Quebrada Anashuayco')).toBe('Quebrada Añashuayco');
  });
  it('pasa a minúsculas con inicial un nombre en mayúsculas y descarta los códigos', () => {
    expect(Cauces.nombreLegible('POROTO')).toBe('Poroto');
    expect(Cauces.nombreLegible(' ')).toBeNull();
    expect(Cauces.nombreLegible('R')).toBeNull();
    expect(Cauces.nombreLegible(null)).toBeNull();
  });
  it('deja como vienen los demás nombres', () => {
    expect(Cauces.nombreLegible('Quebrada El Cuico')).toBe('Quebrada El Cuico');
    expect(Cauces.nombreLegible('Av. Venezuela')).toBe('Av. Venezuela');
  });
});

describe('Cauces.unirCauces: duplicados entre fuentes', () => {
  it('descarta la misma línea de una fuente de menor prioridad y cuenta los duplicados', () => {
    const { features, resumen } = Cauces.unirCauces([[cand('ANA', 'Río Chili', linea(0))], [cand('IGP', 'Rio Chili', linea(10))]]);
    expect(features).toHaveLength(1);
    expect(features[0].properties.fuente).toBe('ANA');
    expect(features[0].properties.tambienEn).toEqual(['IGP']);
    expect(resumen.map((r: { duplicados: number }) => r.duplicados)).toEqual([0, 1]);
  });

  it('conserva una línea que está a más de la tolerancia (30 m)', () => {
    const { features } = Cauces.unirCauces([[cand('ANA', 'A', linea(0))], [cand('IGP', 'B', linea(80))]]);
    expect(features.map((f: F) => f.properties.fuente)).toEqual(['ANA', 'IGP']);
  });

  it('conserva una línea que solo se solapa en una parte pequeña (menos del 70 %)', () => {
    // La ANA cubre los primeros 400 m; la del IGP mide 1 km: solo el 40 % está cubierto.
    const { features } = Cauces.unirCauces([[cand('ANA', 'A', linea(0, 400))], [cand('IGP', 'B', linea(5, 1000))]]);
    expect(features).toHaveLength(2);
  });

  it('descarta una línea corta contenida en otra larga', () => {
    const { features } = Cauces.unirCauces([[cand('ANA', 'A', linea(0, 5000))], [cand('OSM', 'B', linea(3, 800, 1000))]]);
    expect(features).toHaveLength(1);
  });

  it('la duplicada sin nombre en la ganadora le da su nombre y deja anotada la fuente', () => {
    const { features } = Cauces.unirCauces([[cand('IGP', null, linea(0))], [cand('OSM', 'Quebrada Anashuayco', linea(4))]]);
    expect(features).toHaveLength(1);
    expect(features[0].properties.nombre).toBe('Quebrada Añashuayco');
    expect(features[0].properties.nombreDe).toBe('OSM');
  });

  it('si la ganadora tiene otro nombre, el de la duplicada queda como alias (ningún nombre se pierde)', () => {
    const { features } = Cauces.unirCauces([[cand('IGP', 'Qda. Estanquillo', linea(0))], [cand('OSM', 'Quebrada Anashuayco', linea(4))]]);
    expect(features[0].properties.nombre).toBe('Quebrada Estanquillo');
    expect(features[0].properties.alias).toEqual([{ nombre: 'Quebrada Añashuayco', fuente: 'OSM' }]);
  });

  it('una duplicada cubierta por varias líneas juntas (ninguna llega sola al 70 %) también se descarta y reparte su nombre', () => {
    const tramos = [cand('IGP', null, linea(0, 500, 0)), cand('IGP', null, linea(2, 500, 500))];
    const { features } = Cauces.unirCauces([tramos, [cand('OSM', 'Quebrada Larga', linea(1, 1000))]]);
    expect(features).toHaveLength(2);
    expect(features.every((f: F) => f.properties.nombre === 'Quebrada Larga')).toBe(true);
  });

  it('las líneas de un mismo grupo no se comparan entre sí', () => {
    const { features } = Cauces.unirCauces([[cand('IGP', 'A', linea(0)), cand('IGP', 'B', linea(0))]]);
    expect(features).toHaveLength(2);
  });

  it('cada feature trae su fuente, ids únicos y la capa', () => {
    const { features } = Cauces.unirCauces([[cand('ANA', 'A', linea(0))], [cand('IGP', 'B', linea(500), { capa: 'Quebrada' })], [cand('OSM', 'C', linea(900), { capa: 'way/1' })]]);
    expect(features.map((f: F) => f.properties.fuente)).toEqual(['ANA', 'IGP', 'OSM']);
    expect(new Set(features.map((f: F) => f.properties.id)).size).toBe(3);
    expect(features[1].properties.capa).toBe('Quebrada');
  });
});

describe('Geometria: recorte y simplificación', () => {
  const caja = [0, 0, 10, 10];
  it('recorta una línea que sale de la caja', () => {
    expect(Geo.recortarLinea([[-5, 5], [5, 5], [15, 5]], caja)).toEqual([[[0, 5], [5, 5], [10, 5]]]);
  });
  it('una línea que entra, sale y vuelve a entrar da dos tramos', () => {
    expect(Geo.recortarLinea([[2, 2], [2, 12], [8, 12], [8, 2]], caja)).toHaveLength(2);
  });
  it('una línea fuera de la caja se descarta', () => {
    expect(Geo.recortarGeometria({ type: 'LineString', coordinates: [[20, 20], [30, 30]] }, caja)).toBeNull();
  });
  it('simplifica una línea casi recta y conserva los extremos', () => {
    expect(Geo.simplificarLinea([[0, 0], [1, 0.00001], [2, -0.00001], [3, 0]], 0.0001)).toEqual([[0, 0], [3, 0]]);
  });
  it('un anillo que degenera se descarta y uno válido sigue cerrado', () => {
    expect(Geo.simplificarAnillo([[0, 0], [1, 0], [0, 0]], 0.1)).toBeNull();
    const a = Geo.simplificarAnillo([[0, 0], [5, 0.0001], [10, 0], [10, 10], [0, 10], [0, 0]], 0.01);
    expect(a[0]).toEqual(a[a.length - 1]);
  });
});

describe('Calculos.evaluarCauces: la fuente del cauce más cercano', () => {
  const P = { lat: O.lat, lon: O.lon };
  const cauces = [
    { nombre: 'Río Chili', tipo: 'Río', fuente: 'ANA', geometry: linea(900) },
    { nombre: null, tipo: null, fuente: 'IGP', alias: [{ nombre: 'Quebrada X', fuente: 'OSM' }], geometry: linea(200) },
    { nombre: 'Quebrada Paccha', tipo: 'Quebrada', fuente: 'OSM', geometry: linea(500) },
  ];
  it('dice de cuál fuente es y rotula los sin nombre con esa fuente', () => {
    const r = Calculos.evaluarCauces(P, cauces, {});
    expect(r.fuenteId).toBe('IGP');
    expect(r.fuenteCorta).toBe('IGP');
    expect(r.nombre).toBe('Sin nombre en el IGP');
    expect(r.alias).toEqual([{ nombre: 'Quebrada X', fuente: 'OSM' }]);
  });
  it('un cauce de OpenStreetMap se nombra «OpenStreetMap»', () => {
    expect(Calculos.evaluarCauces(P, [cauces[2]], {}).fuenteCorta).toBe('OpenStreetMap');
  });
  it('sin fuente en el cauce se supone la ANA (archivos antiguos)', () => {
    const r = Calculos.evaluarCauces(P, [{ nombre: null, geometry: linea(100) }], {});
    expect(r.fuenteId).toBe('ANA');
    expect(r.nombre).toBe('Sin nombre en la ANA');
  });
  it('textoFuentesCauces lista las fuentes con sus tramos', () => {
    expect(Calculos.textoFuentesCauces([{ id: 'ANA', registros: 14 }, { id: 'IGP', registros: 231 }, { id: 'OSM', registros: 1 }])).toBe('ANA (14 tramos), IGP (231 tramos) y OpenStreetMap (1 tramo)');
    expect(Calculos.textoFuentesCauces(undefined)).toBe('la ANA');
  });
});

describe('Calculos.quebradasMencionadas y quebradasAusentes (se calculan, no se escriben a mano)', () => {
  const sectores = ['Quebrada San Lazaro (margen izquierda)', 'TORRENTERA SAN LAZARO', 'Quebrada Cabreria / Rio Chili', 'Quebrada cabreria', 'Qda. Pajonal', 'Quebrada Pajonal', 'Quebrada Rara', 'Zona sin nombre', null];
  it('cuenta en cuántos registros aparece cada nombre y deja los que aparecen 2 veces o más', () => {
    const m = Calculos.quebradasMencionadas(sectores);
    expect(m.map((x: { clave: string; registros: number }) => [x.clave, x.registros])).toEqual([['cabreria', 2], ['pajonal', 2], ['san lazaro', 2]]);
  });
  it('un nombre repetido dentro del mismo registro cuenta una vez', () => {
    expect(Calculos.quebradasMencionadas(['Quebrada Onda y quebrada Onda'], { minRegistros: 1 })[0].registros).toBe(1);
  });
  it('separa las que no figuran entre los cauces (con alias) de las que sí', () => {
    const m = Calculos.quebradasMencionadas(sectores);
    const r = Calculos.quebradasAusentes({ mencionadas: m, citadas: ['Añashuayco', 'Chullo'], nombresCauces: ['Quebrada San Lázaro', 'Torrentera Chullo', 'Quebrada Añashuayco'] });
    expect(r.ausentes.map((x: { nombre: string }) => x.nombre.toLowerCase())).toEqual(['cabreria', 'pajonal']);
    expect(r.presentes).toHaveLength(3);
  });
  it('una quebrada solo citada por los informes sale con 0 registros y en último lugar', () => {
    const r = Calculos.quebradasAusentes({ mencionadas: [{ nombre: 'Cabreria', clave: 'cabreria', registros: 10 }], citadas: ['El Pato'], nombresCauces: [] });
    expect(r.ausentes.map((x: { registros: number }) => x.registros)).toEqual([10, 0]);
    expect(Calculos.textoQuebradasAusentes(r.ausentes)).toBe('Cabreria (10 registros de INGEMMET), El Pato (la citan los informes de INGEMMET)');
  });
  it('no inventa nada cuando todo figura', () => {
    const r = Calculos.quebradasAusentes({ citadas: ['Chullo'], nombresCauces: ['Torrentera Chullo'] });
    expect(r.ausentes).toEqual([]);
    expect(Calculos.textoQuebradasAusentes(r.ausentes)).toBeNull();
  });
});
