/**
 * Paradas de bus de OpenStreetMap ligadas a las rutas (scripts/lib/paradas-osm.js, usada por scripts/descargar-rutas-osm.mjs).
 * Las relaciones route=bus de Arequipa NO traen paradas como miembros: las paradas (highway=bus_stop, public_transport=platform|stop_position) son objetos sueltos.
 * Se ligan a una ruta solo si caen sobre su trazado y, cuando la parada nombra a su empresa, si es la de la ruta. Lo que no se puede ligar no se inventa.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const P = require('../scripts/lib/paradas-osm.js');

const ruta = (osm: string, linea: string, operador: string, coords: number[][]) => ({
  type: 'Feature', properties: { tipo: 'ruta', osm, linea, operador }, geometry: { type: 'LineString', coordinates: coords },
});
// Un trazado de oeste a este sobre la latitud -16,40 (0,001° de longitud ≈ 107 m).
const R1 = ruta('relation/1', 'C3', 'C3 - Transcayma', [[-71.54, -16.4], [-71.53, -16.4]]);
const R2 = ruta('relation/2', 'C9', 'C9 - Emarsistran', [[-71.54, -16.4], [-71.53, -16.4]]);
const R3 = ruta('relation/3', 'C4', 'C4 - Unión AQP', [[-71.54, -16.41], [-71.53, -16.41]]);
const nodo = (id: number, lat: number, lon: number, tags: Record<string, string> = {}) => ({ type: 'node', id, lat, lon, tags: { highway: 'bus_stop', public_transport: 'platform', bus: 'yes', ...tags } });

describe('construirConsultaParadas', () => {
  it('una consulta con los nodos y vías de parada de la caja, con tiempo máximo y salida de etiquetas y centro', () => {
    const q = P.construirConsultaParadas([-16.6, -71.75, -16.2, -71.35], 120);
    expect(q).toContain('[out:json][timeout:120]');
    expect(q).toContain('node["highway"="bus_stop"](-16.6,-71.75,-16.2,-71.35)');
    expect(q).toContain('public_transport"~"^(platform|stop_position)$"');
    expect(q).toContain('out tags center;');
  });
});

describe('convertirParadas', () => {
  it('una Feature Point por parada con su nombre, tipo, empresa y red; el centro de las vías', () => {
    const r = P.convertirParadas([
      nodo(10, -16.4, -71.535, { name: 'Paucarpata', operator: 'Transcayma S.A.C.', network: 'Sistema Integrado de Transporte (SIT)' }),
      { type: 'way', id: 20, center: { lat: -16.41, lon: -71.53 }, tags: { public_transport: 'platform', bus: 'yes' } },
    ]);
    expect(r.features).toHaveLength(2);
    expect(r.features[0].properties).toMatchObject({ tipo: 'parada', osm: 'node/10', nombre: 'Paucarpata', operador: 'Transcayma S.A.C.', clase: 'platform', red: 'Sistema Integrado de Transporte (SIT)' });
    expect(r.features[0].geometry).toEqual({ type: 'Point', coordinates: [-71.535, -16.4] });
    expect(r.features[1].properties).toMatchObject({ osm: 'way/20', nombre: null, clase: 'platform' });
    expect(r.features[1].geometry.coordinates).toEqual([-71.53, -16.41]);
  });
  it('descarta lo que no tiene coordenada, no es una parada de bus (tren) o se repite, y lo cuenta', () => {
    const r = P.convertirParadas([
      nodo(1, -16.4, -71.5), nodo(1, -16.4, -71.5), { type: 'node', id: 2, tags: { highway: 'bus_stop' } },
      { type: 'node', id: 3, lat: -16.4, lon: -71.5, tags: { public_transport: 'stop_position', train: 'yes', network: 'Peru Rail' } },
      { type: 'relation', id: 4, tags: {} },
    ]);
    expect(r.features.map((f: any) => f.properties.osm)).toEqual(['node/1']);
    expect(r.descartadas).toMatchObject({ sinCoordenada: 1, noEsBus: 1, repetidas: 1 });
  });
  it('la clase es platform, stop_position o bus_stop según la etiqueta', () => {
    const r = P.convertirParadas([nodo(1, -16.4, -71.5, { public_transport: 'stop_position' }), { type: 'node', id: 2, lat: -16.4, lon: -71.5, tags: { highway: 'bus_stop' } }]);
    expect(r.features.map((f: any) => f.properties.clase)).toEqual(['stop_position', 'bus_stop']);
  });
});

describe('clavesEmpresa', () => {
  it('reduce los nombres de las empresas del SIT, con sus erratas, a una clave estable', () => {
    expect([...P.clavesEmpresa('Transcayma S.A.C.')]).toEqual(['transcayma']);
    expect([...P.clavesEmpresa('C3 - Transcayma')]).toEqual(['transcayma']);
    expect([...P.clavesEmpresa('Coutm Express S.A.C.')]).toEqual(['cotum']);
    expect([...P.clavesEmpresa('Consorcio Empresarial Cono Norte S.A.C.')]).toEqual(['conorte']);
    expect([...P.clavesEmpresa('Unión AQP S.A.')]).toEqual(['unionaqp']);
    expect([...P.clavesEmpresa('Unión Grau S.A.C.;AQP Masivo S.A.C.;Emarsistran S.A.')].sort()).toEqual(['aqpmasivo', 'emarsistran', 'uniongrau']);
    expect([...P.clavesEmpresa('Megabus AQP')]).toEqual(['megabus']);
  });
  it('una empresa desconocida o vacía no da claves', () => {
    expect(P.clavesEmpresa('').size).toBe(0);
    expect(P.clavesEmpresa(null).size).toBe(0);
    expect(P.clavesEmpresa('Ferrocarril del Sur del Perú').size).toBe(0);
  });
});

describe('asociar: qué paradas sirven a qué ruta', () => {
  const paradas = (x: any[]) => P.convertirParadas(x).features;
  it('liga una parada a la ruta si cae a 25 m o menos de su trazado; una a 60 m no', () => {
    const r = P.asociar([R1], paradas([nodo(1, -16.40009, -71.535), nodo(2, -16.4005, -71.535)]), { radioM: 25 });
    expect(r.paradas[0].properties.rutas).toEqual(['relation/1']);
    expect(r.paradas[1].properties.rutas).toEqual([]);
  });
  it('una parada que nombra a una empresa solo se liga a las rutas de esa empresa', () => {
    const r = P.asociar([R1, R2], paradas([nodo(1, -16.4, -71.535, { operator: 'Transcayma S.A.C.' })]));
    expect(r.paradas[0].properties.rutas).toEqual(['relation/1']);
    expect(r.paradas[0].properties.lineas).toEqual(['C3']);
  });
  it('una parada sin empresa se liga a todas las rutas que pasan por ella', () => {
    const r = P.asociar([R1, R2], paradas([nodo(1, -16.4, -71.535)]));
    expect(r.paradas[0].properties.rutas.sort()).toEqual(['relation/1', 'relation/2']);
  });
  it('una parada con una empresa que no es ninguna de las conocidas se liga sin filtrar (no se descarta por no reconocer el nombre)', () => {
    const r = P.asociar([R1], paradas([nodo(1, -16.4, -71.535, { operator: 'Cooperativa X' })]));
    expect(r.paradas[0].properties.rutas).toEqual(['relation/1']);
  });
  it('resume cuántas rutas tienen paradas mapeadas y cuántas no, por línea, sin inventar posiciones', () => {
    const r = P.asociar([R1, R2, R3], paradas([nodo(1, -16.4, -71.535, { operator: 'Transcayma S.A.C.' }), nodo(2, -16.4, -71.532)]));
    expect(r.resumen.rutas).toBe(3);
    expect(r.resumen.conParadas).toBe(2); // R1 y R2 (la parada sin empresa pasa por las dos); R3 queda sin paradas
    expect(r.resumen.sinParadas).toBe(1);
    expect(r.resumen.sinParadasIds).toEqual(['relation/3']);
    expect(r.resumen.porLinea.C4).toEqual({ rutas: 1, conParadas: 0 });
    expect(r.resumen.porLinea.C3).toEqual({ rutas: 1, conParadas: 1 });
    expect(r.resumen.paradasSinRuta).toBe(0);
  });
  it('cuenta las paradas que no sirven a ninguna ruta', () => {
    const r = P.asociar([R1], paradas([nodo(1, -16.4, -71.535), nodo(2, -16.5, -71.5)]));
    expect(r.resumen.paradasSinRuta).toBe(1);
  });
  it('el número de paradas por ruta se puede leer de las paradas', () => {
    const r = P.asociar([R1], paradas([nodo(1, -16.4, -71.535), nodo(2, -16.4, -71.534)]));
    expect(P.paradasPorRuta(r.paradas)['relation/1']).toBe(2);
  });
});
