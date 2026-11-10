/**
 * Rutas de bus de OpenStreetMap (relaciones route=bus de la red SIT de Arequipa): la lógica pura detrás de scripts/descargar-rutas-osm.mjs.
 * Consulta única, ensamblado de las vías de una relación en un trazado ordenado y conversión a Features con sus etiquetas. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const RutasOsm = require('../scripts/lib/rutas-osm.js');

const g = (...pts: number[][]) => pts.map(([lon, lat]) => ({ lat, lon }));
const via = (id: number, ...pts: number[][]) => ({ type: 'way', ref: id, role: '', geometry: g(...pts) });
const rel = (id: number, miembros: object[], tags: Record<string, string> = {}) => ({
  type: 'relation', id, tags: { type: 'route', route: 'bus', ref: 'Enace', operator: 'C3 - Transcayma', from: 'A', to: 'B', name: 'C-3 Bus Enace: A → B', ...tags }, members: miembros,
});

describe('RutasOsm.construirConsulta', () => {
  it('es una sola consulta de relaciones route=bus de la caja, con geometría de las vías', () => {
    const q = RutasOsm.construirConsulta([-16.6, -71.75, -16.2, -71.35]);
    expect(q).toContain('relation["type"="route"]["route"~"^(bus|share_taxi|minibus|trolleybus)$"](-16.6,-71.75,-16.2,-71.35)');
    expect(q).toContain('out geom;');
    expect(q).toMatch(/^\[out:json\]/);
  });
});

describe('RutasOsm.ensamblar: las vías de la relación, en orden y orientadas', () => {
  it('une vías que ya van en orden', () => {
    const r = RutasOsm.ensamblar([via(1, [0, 0], [1, 0]), via(2, [1, 0], [2, 0])]);
    expect(r.partes).toEqual([[[0, 0], [1, 0], [2, 0]]]);
    expect(r.saltos).toEqual([]);
  });
  it('da la vuelta a una vía que viene al revés, incluida la primera', () => {
    const r = RutasOsm.ensamblar([via(1, [1, 0], [0, 0]), via(2, [2, 0], [1, 0]), via(3, [2, 0], [3, 0])]);
    expect(r.partes).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]]);
  });
  it('si una vía no conecta (más lejos que el salto máximo), abre otra parte y anota el salto en vez de unirlas con una recta', () => {
    const r = RutasOsm.ensamblar([via(1, [0, 0], [0.0005, 0]), via(2, [0.5, 0], [0.5005, 0])], { saltoMaxM: 300 });
    expect(r.partes).toHaveLength(2);
    expect(r.saltos).toHaveLength(1);
    expect(r.saltos[0].metros).toBeGreaterThan(300);
  });
  it('ignora lo que no es una vía con geometría (paradas, miembros vacíos)', () => {
    const r = RutasOsm.ensamblar([{ type: 'node', ref: 5, role: 'stop', lat: 0, lon: 0 }, via(1, [0, 0], [1, 0]), { type: 'way', ref: 9, role: '', geometry: [] }]);
    expect(r.partes).toEqual([[[0, 0], [1, 0]]]);
  });
});

describe('RutasOsm.convertir', () => {
  const R = rel(100, [via(1, [-71.55, -16.33], [-71.54, -16.33]), via(2, [-71.54, -16.33], [-71.53, -16.32])], {
    duration: '52', interval: '5', opening_hours: 'Mo-Su 05:00-21:00', charge: '1.30 PEN', colour: '#FEDD00', network: 'SIT', 'survey:date': '2026-08-28',
  });
  it('una Feature por relación con su línea (C3), ref, ramal, de dónde a dónde, operador, duración, intervalo, horario, tarifa, color y el id de OSM', () => {
    const { features } = RutasOsm.convertir([R]);
    expect(features).toHaveLength(1);
    expect(features[0].geometry).toEqual({ type: 'LineString', coordinates: [[-71.55, -16.33], [-71.54, -16.33], [-71.53, -16.32]] });
    expect(features[0].properties).toEqual({
      tipo: 'ruta', fuente: 'OSM', osm: 'relation/100', linea: 'C3', ramal: 'Enace', nombre: 'C-3 Bus Enace: A → B', desde: 'A', hasta: 'B', operador: 'C3 - Transcayma',
      red: 'SIT', duracion_min: 52, intervalo_min: 5, horario: 'Mo-Su 05:00-21:00', tarifa: '1.30 PEN', color: '#FEDD00', verificado_el: '2026-08-28',
    });
  });
  it('MultiLineString si el trazado tiene saltos; el salto se cuenta', () => {
    const rota = rel(101, [via(1, [0, 0], [0.0005, 0]), via(2, [0.5, 0], [0.5005, 0])]);
    const r = RutasOsm.convertir([rota]);
    expect(r.features[0].geometry.type).toBe('MultiLineString');
    expect(r.conSaltos).toBe(1);
  });
  it('la línea sale del operador («C10 - MegaBus» → C10; «Albotran» → Albotran) y sin ella se deja en null', () => {
    expect(RutasOsm.lineaDe('C10 - MegaBus')).toBe('C10');
    expect(RutasOsm.lineaDe('Albotran')).toBe('Albotran');
    expect(RutasOsm.lineaDe('')).toBeNull();
  });
  it('lo que no se puede usar (sin vías) se descarta diciendo por qué; nada se inventa', () => {
    const r = RutasOsm.convertir([rel(102, [])]);
    expect(r.features).toEqual([]);
    expect(r.descartadas).toEqual([{ osm: 'relation/102', motivo: expect.stringMatching(/vías/) }]);
  });
  it('número no válido en duration / interval queda en null (no se adivina)', () => {
    const r = RutasOsm.convertir([rel(103, [via(1, [0, 0], [1, 0])], { duration: '1:30', interval: 'cada rato' })]);
    expect(r.features[0].properties.duracion_min).toBeNull();
    expect(r.features[0].properties.intervalo_min).toBeNull();
  });
});
