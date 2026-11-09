/**
 * Dónde se muestra de qué fuente es cada establecimiento de salud y de educación (RENIPRESS, ESCALE u OpenStreetMap como
 * respaldo): el mapa del chat, el conteo por distrito, las respuestas del chat y el informe imprimible. La ficha está en
 * test/equipamiento-fuentes.spec.ts.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');
const Entidades = require('../public/js/entidades.js');
const Reporte = require('../public/js/reporte.js');

const UMBRALES = {
  salud: 1000,
  educacion: { inicial: 500, primaria: 1500, secundaria: 3000 },
  transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 },
  zona: { campina: 500, comercial: 600, historico: 800 },
};
const DISTRITO = [[[[-71.55, -16.42], [-71.53, -16.42], [-71.53, -16.40], [-71.55, -16.40], [-71.55, -16.42]]]];
const en = (i: number) => [-71.54, -16.41 + i * 0.0002];
const punto = (coords: number[], properties: object) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } });

const ESCALE = punto(en(0), {
  fuente: 'ESCALE', nombre: 'ESCUELA 1', codigo_modular: '0100001', codigo_local: '100001', niveles: ['primaria', 'secundaria'],
  instituciones: [
    { codigo_modular: '0100001', nombre: 'ESCUELA 1', nivel: 'primaria', gestion: 'Pública' },
    { codigo_modular: '0100002', nombre: 'COLEGIO 2', nivel: 'secundaria', gestion: 'Privada' },
  ],
});
const KINDER_OSM = punto(en(1), { fuente: 'OSM', osm: 'node/7', nombre: 'Kínder Arco Iris', tags: { amenity: 'kindergarten' }, niveles: ['inicial'] });
const RENIPRESS = punto(en(2), { fuente: 'RENIPRESS', nombre: 'POLICLINICO X', codigo_renipress: '00001231', categoria: 'I-3', clasificacion: 'POLICLINICOS' });
const CLINICA_OSM = punto(en(3), { fuente: 'OSM', osm: 'node/5', nombre: 'Clínica Vallesur', tags: { amenity: 'clinic' } });

const datos = Asistente.prepararDatos({ educacion: [ESCALE, KINDER_OSM], salud: [RENIPRESS, CLINICA_OSM], transporte: [], areasVerdes: [] }, [], UMBRALES);

describe('Asistente.prepararDatos con archivos de RENIPRESS y ESCALE', () => {
  it('toma los niveles de un local de ESCALE de sus propiedades, no de etiquetas', () => {
    expect(datos.colegios.primaria.map((c: { nombre: string }) => c.nombre)).toEqual(['ESCUELA 1']);
    expect(datos.colegios.secundaria.map((c: { nombre: string }) => c.nombre)).toEqual(['COLEGIO 2']);
    expect(datos.colegios.inicial.map((c: { nombre: string }) => c.nombre)).toEqual(['Kínder Arco Iris']);
    expect(datos.colegiosLista).toHaveLength(2);
  });
  it('cada punto conserva su fuente y su código oficial', () => {
    expect(datos.salud[0]).toMatchObject({ fuente: 'RENIPRESS', codigo: '00001231', categoria: 'I-3' });
    expect(datos.salud[1]).toMatchObject({ fuente: 'OSM', osm: 'node/5', codigo: null });
    expect(datos.colegios.secundaria[0]).toMatchObject({ fuente: 'ESCALE', codigo: '0100002', gestion: 'Privada' });
  });
});

describe('Entidades.contar: cuántos hay de cada fuente', () => {
  const c = Entidades.contar(datos, DISTRITO);
  it('cuenta los colegios y los establecimientos de salud por fuente', () => {
    expect(c.colegios.total).toBe(2);
    expect(c.colegios.fuentes).toEqual({ ESCALE: 1, OSM: 1 });
    expect(c.salud.total).toBe(2);
    expect(c.salud.fuentes).toEqual({ RENIPRESS: 1, OSM: 1 });
  });
  it('«sin nivel declarado» es solo de OpenStreetMap: un local de ESCALE siempre dice su nivel', () => {
    expect(c.colegios.sinNivel).toBe(0);
  });
});

describe('Capas.construir: el popup dice la fuente', () => {
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES, area: { polys: DISTRITO } };
  it('colegios: la fuente y el código modular del local, con su nombre y gestión', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'colegios' }] });
    const e = r.puntos.find((p: { nombre: string }) => p.nombre === 'ESCUELA 1');
    expect(e).toMatchObject({ fuente: 'ESCALE', fuenteTexto: 'ESCALE (MINEDU) · código modular 0100001 · pública' });
    const k = r.puntos.find((p: { osm: string }) => p.osm === 'node/7');
    expect(k.fuenteTexto).toBe('OpenStreetMap (respaldo: no hay un punto oficial cerca) · node/7');
  });
  it('salud: la fuente, el código y la categoría de RENIPRESS', () => {
    const r = Capas.construir({ ...base, capas: [{ id: 'salud' }] });
    const p = r.puntos.find((x: { nombre: string }) => x.nombre === 'POLICLINICO X');
    expect(p.fuenteTexto).toBe('RENIPRESS (SUSALUD) · código 00001231 · categoría I-3');
    expect(r.puntos.find((x: { osm: string }) => x.osm === 'node/5').fuenteTexto).toMatch(/^OpenStreetMap \(respaldo/);
  });
});

describe('chat: las respuestas nombran la fuente', () => {
  const entorno = {
    salud: { estado: 'CUMPLE', nombre: 'POLICLINICO X', distanciaM: 300, umbralM: 1000, fuenteElemento: 'RENIPRESS', codigo: '00001231', categoria: 'I-3' },
    educacion: {
      inicial: { estado: 'CUMPLE', nombre: 'Kínder Arco Iris', distanciaM: 100, umbralM: 500, fuenteElemento: 'OSM', osm: 'node/7' },
      primaria: { estado: 'CUMPLE', nombre: 'ESCUELA 1', distanciaM: 200, umbralM: 1500, fuenteElemento: 'ESCALE', codigo: '0100001', gestion: 'Pública' },
      secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000, fuenteElemento: null },
    },
    transporte: { estado: 'CUMPLE', nombre: 'Paradero', distanciaM: 100, umbralM: 400 },
    areaVerde: { estado: 'CUMPLE', nombre: 'Parque', distanciaM: 100, umbralM: 300 },
  };
  const ctx = { punto: { lat: -16.4, lon: -71.5 }, zona: null, entorno, estadoPDM: null };

  it('«¿hay una posta cerca?» dice de qué fuente es el establecimiento y su código', () => {
    const t = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'salud' }] }, ctx).texto;
    expect(t).toContain('POLICLINICO X');
    expect(t).toContain('RENIPRESS (SUSALUD) · código 00001231 · categoría I-3');
  });
  it('cada nivel de colegio dice su fuente; un paradero no dice ninguna', () => {
    const t = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'colegio' }] }, ctx).texto;
    expect(t).toContain('ESCALE (MINEDU) · código modular 0100001 · pública');
    expect(t).toContain('OpenStreetMap (respaldo');
    const p = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'transporte' }] }, ctx).texto;
    expect(p).not.toContain('RENIPRESS');
    expect(p).not.toContain('respaldo');
  });
  it('el cierre ya no dice que todo viene de OpenStreetMap', () => {
    const t = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'salud' }, { id: 'colegio' }, { id: 'transporte' }] }, ctx).texto;
    expect(t).not.toContain('Distancias en línea recta, con datos de OpenStreetMap.');
    expect(t).toMatch(/RENIPRESS.*ESCALE.*OpenStreetMap/s);
  });
  it('«fuentes» explica que RENIPRESS y ESCALE son la fuente primaria y OpenStreetMap el respaldo', () => {
    const t = Asistente.responder({ tipo: 'fuentes', criterios: [] }, ctx).texto;
    expect(t).toMatch(/RENIPRESS/);
    expect(t).toMatch(/ESCALE/);
    expect(t).toMatch(/respaldo/);
  });
  it('«Por qué, fuente y límites» de los servicios cita las dos fuentes oficiales', () => {
    const e = Asistente.explicar('servicio');
    expect(e.fuente.join(' ')).toMatch(/RENIPRESS.*ESCALE/s);
    expect(e.limites.join(' ')).toMatch(/oficial/);
  });
});

describe('Reporte: la fuente del establecimiento más cercano', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POLICLINICO X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', metodo: 'Distancia en línea recta.', ...extra });
  const d = {
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UMBRALES,
    fuentesUmbral: { salud: 'x', educacion: 'x', transporte: 'x', areaVerde: 'x' },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({ fuenteElemento: 'RENIPRESS', codigo: '00001231', categoria: 'I-3' }),
      educacion: {
        inicial: servicio({ nombre: 'Kínder', fuenteElemento: 'OSM', osm: 'node/7' }),
        primaria: servicio({ nombre: 'ESCUELA 1', fuenteElemento: 'ESCALE', codigo: '0100001', gestion: 'Pública' }),
        secundaria: servicio({ estado: 'SIN DATO', nombre: null, distanciaM: null, fuenteElemento: null }),
      },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  };
  const secciones = Reporte.construirSecciones(d);
  const cuerpo = (t: string) => secciones.find((s: { titulo: string }) => s.titulo.includes(t)).cuerpo;

  it('la tabla de salud trae una fila con la fuente, el código y la categoría', () => {
    expect(cuerpo('Salud')).toContain('Fuente del establecimiento');
    expect(cuerpo('Salud')).toContain('RENIPRESS (SUSALUD) · código 00001231 · categoría I-3');
  });
  it('educación dice la fuente de cada nivel', () => {
    const h = cuerpo('Educación');
    expect(h).toContain('ESCALE (MINEDU) · código modular 0100001 · pública');
    expect(h).toContain('OpenStreetMap (respaldo');
  });
  it('la nota de educación ya no atribuye todo a OpenStreetMap', () => {
    expect(cuerpo('Educación')).toMatch(/ESCALE/);
  });
  it('transporte no muestra fila de fuente del establecimiento', () => {
    expect(cuerpo('Transporte')).not.toContain('Fuente del establecimiento');
  });
  it('las notas finales dicen que salud y educación salen de RENIPRESS y ESCALE, con OpenStreetMap de respaldo', () => {
    const notas = Reporte.limites(d).join(' ');
    expect(notas).toMatch(/RENIPRESS/);
    expect(notas).toMatch(/respaldo/);
  });
});
