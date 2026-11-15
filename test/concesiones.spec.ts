/**
 * Concesiones de distribución eléctrica (MINEM, DGE): la lógica pura detrás de scripts/descargar-concesiones-electricas.mjs.
 * Consulta paginada al servicio ArcGIS REST, conversión a Features con la concesionaria etiquetada, validación de los polígonos y resumen.
 * Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Concesiones = require('../scripts/lib/concesiones.js');

const anillo = [[-71.6, -16.4], [-71.5, -16.4], [-71.5, -16.3], [-71.6, -16.3], [-71.6, -16.4]];
const arc = (props: object, geometry: object = { type: 'Polygon', coordinates: [anillo] }) => ({ type: 'Feature', properties: props, geometry });
const SEAL = { OBJECTID: 133, NOMBRE_ZON: 'DISTRIBUCION AREQUIPA', SITUACION: 'DERECHO VIGENTE', CONCESION: 'DISTRIBUCION AREQUIPA', EMPRESA: 'SOCIEDAD ELECTRICA DEL SUR OESTE S.A.', EXPEDIENTE: '15008293-00-00', TIPO_CONCE: 'Concesion Definitiva', SISTEMA_EL: 'SEIN', Shape_Length: 1.2, Shape_Area: 0.02 };
const ELECTROSUR = { ...SEAL, OBJECTID: 78, NOMBRE_ZON: 'AMPLIACION-ZONA PUQUINA OMATE UBINAS (TRAMO 1)', CONCESION: 'DISTRIBUCION MOQUEGUA', EMPRESA: 'EMP. REG. DE SERV. PUB. DE ELECT.  ELECTROSUR S.A - ELECTROSUR S.A.', EXPEDIENTE: '15005193-00-00' };

describe('Concesiones.parametrosConsulta: una página de la consulta al servicio ArcGIS REST', () => {
  it('pide GeoJSON en WGS84, todos los campos, la geometría completa y la caja como filtro de intersección', () => {
    const p = Concesiones.parametrosConsulta([-16.6, -71.75, -16.2, -71.35], 0, 500);
    expect(p.get('f')).toBe('geojson');
    expect(p.get('outSR')).toBe('4326');
    expect(p.get('outFields')).toBe('*');
    expect(p.get('returnGeometry')).toBe('true');
    expect(p.get('geometry')).toBe('-71.75,-16.6,-71.35,-16.2'); // oeste, sur, este, norte
    expect(p.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(p.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(p.get('resultOffset')).toBe('0');
    expect(p.get('resultRecordCount')).toBe('500');
    expect(p.get('orderByFields')).toBe('OBJECTID');
  });
});

describe('Concesiones.concesionariaDe', () => {
  it('SEAL para la Sociedad Eléctrica del Sur Oeste; otra empresa conserva su nombre con la sigla si la conocemos', () => {
    expect(Concesiones.concesionariaDe('SOCIEDAD ELECTRICA DEL SUR OESTE S.A.')).toBe('SEAL');
    expect(Concesiones.concesionariaDe('Sociedad Eléctrica del Sur Oeste S.A.')).toBe('SEAL');
    expect(Concesiones.concesionariaDe('EMP. REG. DE SERV. PUB. DE ELECT.  ELECTROSUR S.A - ELECTROSUR S.A.')).toBe('Electrosur');
    expect(Concesiones.concesionariaDe('EMPRESA DESCONOCIDA S.A.')).toBe('EMPRESA DESCONOCIDA S.A.');
    expect(Concesiones.concesionariaDe('')).toBeNull();
  });
});

describe('Concesiones.convertir', () => {
  it('conserva el polígono entero y lleva cada campo con nombre propio, más la concesionaria', () => {
    const r = Concesiones.convertir([arc(SEAL), arc(ELECTROSUR)]);
    expect(r.features).toHaveLength(2);
    expect(r.descartados).toEqual([]);
    expect(r.features[0].geometry.coordinates[0]).toEqual(anillo);
    expect(r.features[0].properties).toEqual({
      objectid: 133, nombre_zona: 'DISTRIBUCION AREQUIPA', situacion: 'DERECHO VIGENTE', concesion: 'DISTRIBUCION AREQUIPA',
      empresa: 'SOCIEDAD ELECTRICA DEL SUR OESTE S.A.', concesionaria: 'SEAL', expediente: '15008293-00-00',
      tipo_concesion: 'Concesion Definitiva', sistema_electrico: 'SEIN',
    });
    expect(r.features[1].properties.concesionaria).toBe('Electrosur');
  });
  it('acepta MultiPolygon y descarta (diciendo por qué) lo que no es un polígono cerrado', () => {
    const multi = arc(SEAL, { type: 'MultiPolygon', coordinates: [[anillo], [anillo]] });
    const punto = arc({ ...SEAL, OBJECTID: 1 }, { type: 'Point', coordinates: [-71.5, -16.4] });
    const abierto = arc({ ...SEAL, OBJECTID: 2 }, { type: 'Polygon', coordinates: [anillo.slice(0, 4)] });
    const sinGeom = { type: 'Feature', properties: { ...SEAL, OBJECTID: 3 }, geometry: null };
    const r = Concesiones.convertir([multi, punto, abierto, sinGeom]);
    expect(r.features).toHaveLength(1);
    expect(r.features[0].geometry.type).toBe('MultiPolygon');
    expect(r.descartados.map((d: { objectid: number }) => d.objectid)).toEqual([1, 2, 3]);
    expect(r.descartados[0].motivo).toMatch(/polígono/);
  });
});

describe('Concesiones.resumir', () => {
  it('cuenta por concesionaria y por expediente', () => {
    const { features } = Concesiones.convertir([arc(SEAL), arc({ ...SEAL, OBJECTID: 231, NOMBRE_ZON: 'AREQUIPA (AMPLIACION)' }), arc(ELECTROSUR)]);
    expect(Concesiones.resumir(features)).toEqual({
      total: 3,
      por_concesionaria: { SEAL: 2, Electrosur: 1 },
      expedientes: ['15005193-00-00', '15008293-00-00'],
    });
  });
});
