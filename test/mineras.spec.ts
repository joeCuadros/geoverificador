/**
 * Concesiones mineras del Catastro Minero de INGEMMET (GEOCATMIN): la lógica pura detrás de scripts/descargar-concesiones-mineras.mjs. Parámetros de la consulta,
 * conversión a Features con el estado traducido y SIN el nombre del titular (datos de personas), validación de los polígonos y resumen. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Mineras = require('../scripts/lib/mineras.js');

const anillo = [[-71.6, -16.4], [-71.5, -16.4], [-71.5, -16.3], [-71.6, -16.3], [-71.6, -16.4]];
const arc = (props: object, geometry: object = { type: 'Polygon', coordinates: [anillo] }) => ({ type: 'Feature', properties: props, geometry });
const BASE = {
  CODIGOU: '050021422', CONCESION: 'CYM AGREGADOS', TIT_CONCES: 'JUAN PEREZ', HECTAGIS: 700, ESTADO: 'T', D_ESTADO: 'D.M. Titulado D.L. 708', LEYENDA: 'TITULADO', ESTADO_MINEM: null,
  SUSTANCIA: 'N', DISTRI: 'LA JOYA', FEC_DENU: 1654146000000, FECHA_ACTUALIZACION: 1794334740000,
};

describe('Mineras.parametrosConsulta', () => {
  it('pide GeoJSON en WGS84 de lo que interseca la caja, sin paginado (el servicio no lo admite) y sin el titular', () => {
    const p = Mineras.parametrosConsulta([-16.6, -71.75, -16.2, -71.35]);
    expect(p.get('f')).toBe('geojson');
    expect(p.get('outSR')).toBe('4326');
    expect(p.get('geometry')).toBe('-71.75,-16.6,-71.35,-16.2');
    expect(p.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(p.has('resultOffset')).toBe(false);
    expect(p.get('outFields')).not.toMatch(/TIT_CONCES/);
    expect(p.get('outFields')).toMatch(/CODIGOU/);
  });
});

describe('Mineras.convertir', () => {
  it('una Feature por concesión, con el estado en palabras, la sustancia, las hectáreas, la fecha en ISO y sin el nombre del titular', () => {
    const { features, descartados } = Mineras.convertir([arc(BASE)]);
    expect(descartados).toEqual([]);
    expect(features[0].properties).toEqual({
      codigo: '050021422', nombre: 'CYM AGREGADOS', hectareas: 700, estado: 'TITULADO', estado_detalle: 'D.M. Titulado D.L. 708', sustancia: 'no metálica',
      explotacion_o_exploracion: null, distritos: ['LA JOYA'], fecha_denuncio: '2022-06-02', actualizado: '2026-11-10',
    });
    expect(JSON.stringify(features[0])).not.toMatch(/PEREZ/);
  });
  it('traduce el estado: titulado, en trámite, extinguido y otros (cantera, planta de beneficio)', () => {
    const e = (leyenda: string, d: string) => Mineras.convertir([arc({ ...BASE, LEYENDA: leyenda, D_ESTADO: d })]).features[0].properties;
    expect(e('TRAMITE', 'D.M. en Trámite D.L. 708').estado).toBe('EN TRÁMITE');
    expect(e('EXTINGUIDO', 'D.M. Exting. a publicar de L.D.').estado).toBe('EXTINGUIDO');
    expect(e('OTROS', 'Cantera D.S. 037-96-EM').estado).toBe('OTRO');
    expect(e('RARO', 'x').estado).toBe('OTRO');
  });
  it('los distritos «A / B / C» pasan a una lista; la sustancia M es metálica; el estado del MINEM (explotación / exploración) se conserva', () => {
    const p = Mineras.convertir([arc({ ...BASE, DISTRI: 'UCHUMAYO / LA JOYA ', SUSTANCIA: 'M', ESTADO_MINEM: 'EXPLOTACIÓN' })]).features[0].properties;
    expect(p.distritos).toEqual(['UCHUMAYO', 'LA JOYA']);
    expect(p.sustancia).toBe('metálica');
    expect(p.explotacion_o_exploracion).toBe('EXPLOTACIÓN');
  });
  it('descarta, diciendo por qué, lo que no es un polígono cerrado', () => {
    const r = Mineras.convertir([arc(BASE, { type: 'Point', coordinates: [-71.5, -16.4] }), arc({ ...BASE, CODIGOU: '2' }, { type: 'Polygon', coordinates: [anillo.slice(0, 4)] })]);
    expect(r.features).toHaveLength(0);
    expect(r.descartados.map((d: { codigo: string }) => d.codigo)).toEqual(['050021422', '2']);
  });
});

describe('Mineras.resumir', () => {
  it('cuenta por estado y por sustancia y suma las hectáreas', () => {
    const { features } = Mineras.convertir([arc(BASE), arc({ ...BASE, CODIGOU: '2', LEYENDA: 'TRAMITE', SUSTANCIA: 'M', HECTAGIS: 100 })]);
    expect(Mineras.resumir(features)).toEqual({ total: 2, por_estado: { TITULADO: 1, 'EN TRÁMITE': 1 }, por_sustancia: { 'no metálica': 1, metálica: 1 }, hectareas: 800 });
  });
});
