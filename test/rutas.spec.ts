/**
 * Pruebas de public/js/rutas.js con un GeoJSON pequeño hecho a mano, con la forma de rutas_osm.geojson (relaciones route=bus y paradas de OpenStreetMap):
 * las distancias esperadas se calculan a mano con 1° de latitud ≈ 111 195 m.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Rutas = require('../public/js/rutas.js');

const ruta = (id: string, linea: string, empresa: string, ramal: string, sentido: string, coords: number[][][], extra = {}) => {
  const [desde, hasta] = sentido.split(' → ');
  return {
    type: 'Feature',
    geometry: coords.length === 1 ? { type: 'LineString', coordinates: coords[0] } : { type: 'MultiLineString', coordinates: coords },
    properties: { tipo: 'ruta', fuente: 'OSM', osm: `relation/${id}`, linea, ramal, nombre: `${ramal}: ${sentido}`, desde, hasta, operador: empresa === linea ? linea : `${linea} - ${empresa}`, red: 'SIT', ...extra },
  };
};
// Una parada de OSM es un objeto suelto: guarda las relaciones (osm) a las que sirve.
const parada = (n: number, nombre: string | null, lon: number, lat: number, rutas: string[], lineas: string[]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { tipo: 'parada', osm: `node/${n}`, nombre, clase: 'platform', operador: null, red: null, rutas: rutas.map((r) => `relation/${r}`), lineas },
});

// C2 (Cono Norte): recorrido de ida y vuelta por la misma calle, a lat -16.400. C5 (EtraBus): avenida norte-sur a lon -71.520.
// C9: un trazado con un hueco (MultiLineString) entre lon -71.5300 y -71.5200 a lat -16.420: el hueco NO es calle.
const FC = {
  type: 'FeatureCollection',
  metadata: { fuente: 'OpenStreetMap (ODbL), relaciones route=bus de la red SIT y paradas de bus', fecha_extraccion: '2026-11-10' },
  features: [
    ruta('1', 'C2', 'Cono Norte', 'Cettar', 'Ciudad Municipal → Terminal', [[[-71.54, -16.4], [-71.53, -16.4]]]),
    ruta('2', 'C2', 'Cono Norte', 'Cettar', 'Terminal → Ciudad Municipal', [[[-71.53, -16.4], [-71.54, -16.4]]]),
    ruta('3', 'C5', 'EtraBus', 'Norte', 'A → B', [[[-71.52, -16.39], [-71.52, -16.41]]]),
    ruta('4', 'C9', 'Emarsistran', '3 de octubre', 'X → Y', [[[-71.54, -16.42], [-71.53, -16.42]], [[-71.52, -16.42], [-71.51, -16.42]]]),
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-71.5, -16.4] }, properties: { tipo: 'otra-cosa' } },
    parada(1, 'Cettar - 1', -71.54, -16.4, ['1', '2'], ['C2']),
    parada(2, 'Cettar - 2', -71.535, -16.4, ['1', '2'], ['C2']),
    parada(3, 'Cettar - 3', -71.53, -16.4, ['1', '2'], ['C2']),
    parada(4, 'Norte 1', -71.52, -16.39, ['3'], ['C5']),
    parada(5, null, -71.52, -16.4, ['3'], ['C5']),
  ],
};
const idx = Rutas.indexar(FC);

describe('Rutas.indexar', () => {
  it('separa recorridos y paradas e ignora lo que no entiende', () => {
    expect(idx.rutas).toHaveLength(4);
    expect(idx.paradas).toHaveLength(5);
    expect(idx.lineas).toEqual(['C2', 'C5', 'C9']);
  });

  it('tolera un GeoJSON vacío o ausente', () => {
    expect(Rutas.indexar(null).rutas).toEqual([]);
    expect(Rutas.indexar({ features: [{ type: 'Feature', geometry: null, properties: { tipo: 'ruta' } }] }).rutas).toEqual([]);
  });
});

describe('Rutas.cerca', () => {
  it('incluye una línea a menos de la distancia y calcula bien la distancia al trazado', () => {
    // 0.002° de latitud al sur de la calle de C2 = 222 m.
    const r = Rutas.cerca(idx, -16.402, -71.535, 400);
    expect(r.lineas.map((l: any) => l.linea)).toEqual(['C2']);
    expect(r.lineas[0].distanciaM).toBeGreaterThan(220);
    expect(r.lineas[0].distanciaM).toBeLessThan(224);
    expect(r.rutas).toBe(2); // ida y vuelta
    expect(r.distanciaM).toBe(400);
    expect(r.fuente).toBe(FC.metadata.fuente);
    expect(r.fecha).toBe('2026-11-10');
    expect(r.atribucion).toBe('© colaboradores de OpenStreetMap (ODbL)');
    expect(r).not.toHaveProperty('permiso');
  });

  it('deja fuera lo que pasa más lejos que la distancia', () => {
    expect(Rutas.cerca(idx, -16.405, -71.535, 400).lineas).toEqual([]); // 556 m de C2
    expect(Rutas.cerca(idx, -16.402, -71.535, 200).lineas).toEqual([]); // 222 m > 200 m
  });

  it('mide hasta el extremo del tramo, no hasta la recta prolongada', () => {
    // 0.004° al oeste del inicio de C2 (lon -71.54): ≈ 427 m, más que 400 m aunque la recta de C2 pase por esa latitud.
    expect(Rutas.cerca(idx, -16.4, -71.544, 400).lineas).toEqual([]);
    expect(Rutas.cerca(idx, -16.4, -71.5425, 400).lineas.map((l: any) => l.linea)).toEqual(['C2']);
  });

  it('agrupa ramales y sentidos de una misma línea y los ordena de la línea más cercana a la más lejana', () => {
    // Entre el extremo este de C2 (≈ 587 m) y la avenida de C5 (≈ 480 m).
    const r = Rutas.cerca(idx, -16.4, -71.5245, 600);
    expect(r.lineas.map((l: any) => l.linea)).toEqual(['C5', 'C2']);
    const c2 = r.lineas.find((l: any) => l.linea === 'C2');
    expect(c2.ramales).toHaveLength(2);
    expect(c2.ramales.map((x: any) => x.sentido).sort()).toEqual(['Ciudad Municipal → Terminal', 'Terminal → Ciudad Municipal']);
    expect(c2.empresas).toEqual(['Cono Norte']);
    expect(r.lineas[0].distanciaM).toBeLessThan(r.lineas[1].distanciaM);
  });

  it('da la parada más cercana de la línea con su distancia', () => {
    const r = Rutas.cerca(idx, -16.402, -71.5352, 400);
    const c2 = r.lineas[0];
    expect(c2.parada.nombre).toBe('Cettar - 2'); // la de lon -71.535, a ≈ 0.0002° (≈ 21 m) al oeste del punto
    expect(c2.parada.distanciaM).toBeGreaterThan(220);
    expect(c2.parada.distanciaM).toBeLessThan(230);
    expect(c2.paradasMapeadas).toBe(3);
  });

  it('una línea sin ninguna parada ligada dice «paradas no mapeadas» (0) y no inventa una parada', () => {
    const r = Rutas.cerca(idx, -16.42, -71.5305, 400);
    const c9 = r.lineas[0];
    expect(c9.linea).toBe('C9');
    expect(c9.paradasMapeadas).toBe(0);
    expect(c9.parada).toBeNull();
  });

  it('una parada solo cuenta para las rutas a las que está ligada, no por estar cerca de otra línea', () => {
    // La parada de C5 en lon -71,52 queda a 0,0045° (≈ 480 m) del extremo de C2; con C5 a 600 m solo la parada de C5 puede ser la de C5.
    const r = Rutas.cerca(idx, -16.4, -71.5245, 600);
    const c5 = r.lineas.find((l: any) => l.linea === 'C5');
    expect(c5.paradasMapeadas).toBe(2);
    expect(['Norte 1', null]).toContain(c5.parada.nombre);
  });

  it('la parada mapeada más cercana solo se da si está a la distancia pedida o menos: una parada a 10 km no sirve de nada', () => {
    const lejos = Rutas.indexar({ features: [ruta('9', 'C9', 'Emarsistran', 'X', 'A → B', [[[-71.6, -16.4], [-71.5, -16.4]]]), parada(9, 'Final', -71.5, -16.4, ['9'], ['C9'])] });
    const l = Rutas.cerca(lejos, -16.4, -71.6, 400).lineas[0];
    expect(l.distanciaM).toBeLessThan(1);
    expect(l.parada).toBeNull(); // la única parada mapeada de la línea queda a ≈ 10,7 km
    expect(l.paradasMapeadas).toBe(1); // …pero la línea sí tiene paradas mapeadas (no es «paradas no mapeadas»)
  });

  it('no mide contra el hueco entre dos tramos de un MultiLineString', () => {
    // En el medio del hueco de C9 (lon -71.525, lat -16.420) la calle más cercana está a 0.005° ≈ 534 m.
    expect(Rutas.cerca(idx, -16.42, -71.525, 400).lineas).toEqual([]);
    // Pero junto a uno de los tramos sí pasa.
    expect(Rutas.cerca(idx, -16.42, -71.5305, 400).lineas.map((l: any) => l.linea)).toEqual(['C9']);
  });

  it('no inventa líneas si no hay rutas', () => {
    expect(Rutas.cerca(Rutas.indexar(null), -16.4, -71.53, 400)).toMatchObject({ lineas: [], rutas: 0 });
  });
});

describe('Rutas.cruzan', () => {
  // Un distrito rectangular que cubre solo la mitad este de C2 y la avenida C5.
  const distrito = { type: 'Polygon', coordinates: [[[-71.535, -16.43], [-71.505, -16.43], [-71.505, -16.38], [-71.535, -16.38], [-71.535, -16.43]]] };

  it('lista las líneas con algún tramo dentro del polígono, en orden natural', () => {
    const r = Rutas.cruzan(idx, distrito);
    expect(r.lineas.map((l: any) => l.linea)).toEqual(['C2', 'C5', 'C9']);
    expect(r.rutas).toBe(4);
    expect(r.fuente).toBe(FC.metadata.fuente);
  });

  it('cuenta las paradas que caen dentro', () => {
    const r = Rutas.cruzan(idx, distrito);
    expect(r.lineas.find((l: any) => l.linea === 'C5').paradas).toBe(2);
    expect(r.lineas.find((l: any) => l.linea === 'C9').paradas).toBe(0);
  });

  it('no incluye una línea que solo pasa por fuera del distrito', () => {
    const chico = { type: 'Polygon', coordinates: [[[-71.5, -16.45], [-71.49, -16.45], [-71.49, -16.44], [-71.5, -16.44], [-71.5, -16.45]]] };
    expect(Rutas.cruzan(idx, chico).lineas).toEqual([]);
  });

  it('detecta un cruce que cae entre dos vértices (trazado largo con un solo tramo recto)', () => {
    // C2 mide ≈ 1,07 km entre sus dos únicos vértices: este cuadrado queda en el medio y no contiene ninguno.
    const medio = { type: 'Polygon', coordinates: [[[-71.5355, -16.4005], [-71.5345, -16.4005], [-71.5345, -16.3995], [-71.5355, -16.3995], [-71.5355, -16.4005]]] };
    expect(Rutas.cruzan(idx, medio).lineas.map((l: any) => l.linea)).toEqual(['C2']);
  });

  it('acepta MultiPolygon y respeta los huecos', () => {
    const multi = { type: 'MultiPolygon', coordinates: [distrito.coordinates] };
    expect(Rutas.cruzan(idx, multi).lineas).toHaveLength(3);
    const conHueco = { type: 'Polygon', coordinates: [distrito.coordinates[0], [[-71.52 - 0.001, -16.395], [-71.52 + 0.001, -16.395], [-71.52 + 0.001, -16.405], [-71.52 - 0.001, -16.405], [-71.52 - 0.001, -16.395]]] };
    // El hueco tapa la avenida de C5 en el tramo central, pero sus extremos (lat -16.39 y -16.41) siguen dentro.
    expect(Rutas.cruzan(idx, conHueco).lineas.map((l: any) => l.linea)).toContain('C5');
  });

  it('con una geometría que no es polígono no devuelve nada', () => {
    expect(Rutas.cruzan(idx, null).lineas).toEqual([]);
    expect(Rutas.cruzan(idx, { type: 'Point', coordinates: [0, 0] }).lineas).toEqual([]);
  });
});

describe('Rutas.resumen y etiquetas', () => {
  it('rotula la línea con su empresa', () => {
    expect(Rutas.etiquetaLinea({ linea: 'C2', empresas: ['Cono Norte'] })).toBe('C2 (Cono Norte)');
    expect(Rutas.etiquetaLinea({ linea: 'Albotran', empresas: ['Albotran'] })).toBe('Albotran');
    expect(Rutas.etiquetaLinea({ linea: 'C4', empresas: ['Unión Aqp', 'Otra'] })).toBe('C4 (Otra / Unión Aqp)');
  });

  it('arma la frase de la ficha con la distancia de referencia', () => {
    const r = Rutas.cerca(idx, -16.4, -71.5245, 600);
    expect(Rutas.resumen(r)).toBe('Líneas que pasan a ≤600 m: C5 (EtraBus), C2 (Cono Norte)');
    expect(Rutas.resumen(Rutas.cerca(idx, -16.45, -71.5, 400))).toBe('Ninguna línea mapeada en OpenStreetMap pasa a ≤400 m');
  });

  it('acorta una lista larga con «y N más»', () => {
    const lineas = ['C2', 'C3', 'C4', 'C5'].map((linea) => ({ linea, empresas: ['E'] }));
    expect(Rutas.listaTexto(lineas, 2)).toBe('C2 (E), C3 (E) y 2 más');
    expect(Rutas.listaTexto(lineas)).toBe('C2 (E), C3 (E), C4 (E), C5 (E)');
  });

  it('ordena C2 antes que C10 y las líneas sin número al final', () => {
    expect(['C10', 'Chiguata', 'C2', 'Albotran', 'C11', 'C3'].sort(Rutas.compararLineas)).toEqual(['C2', 'C3', 'C10', 'C11', 'Albotran', 'Chiguata']);
  });
});
