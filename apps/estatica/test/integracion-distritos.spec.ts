/**
 * Integración de las tres líneas de trabajo sobre los distritos: contar/perfil/mejor zona (distritos), líneas de OpenStreetMap (rutas)
 * y precio de oferta por m² (Aptología). Se comprueba que todas usan UN buscador de distritos y UN campo «distrito», que las reglas
 * y el modelo (Gemini) llegan a la misma intención y que el perfil del distrito junta lo que hay de cada fuente sin inventar nada.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const A = require('../public/js/asistente.js');
const LLM = require('../public/js/asistente-llm.js');
const RT = require('../public/js/rutas.js');
const { PROMPT_INTERPRETAR } = require('../api/_lib/gemini.js');

const PRECIOS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'precios_m2_distrito.json'), 'utf8'));

const valido = (args: unknown) => {
  const v = LLM.validarSpec(args);
  if (!v.ok) throw new Error(`rechazado: ${v.motivo}`);
  return v.spec;
};
const modelo = (args: unknown) => LLM.aIntencion(valido(args), {});

// Pares frase de reglas ↔ consulta del modelo, una por cada intención que lleva distrito.
const PARES: [string, string, object][] = [
  ['contar', '¿cuántos colegios hay en Paucarpta?', { intencion: 'contar_en_distrito', distrito: 'Paucarpta', criterios: ['colegio'] }],
  ['perfil', 'quiero vivir en Paucarpta', { intencion: 'perfil_distrito', distrito: 'Paucarpta' }],
  ['rutas', '¿qué líneas pasan por Paucarpta?', { intencion: 'rutas', distrito: 'Paucarpta' }],
  ['precio', '¿cuánto cuesta el m² en Paucarpta?', { intencion: 'precio_distrito', distrito: 'Paucarpta' }],
  ['cenepred', '¿Paucarpta se inunda?', { intencion: 'riesgo_cenepred', distrito: 'Paucarpta', fenomenoRiesgo: 'inundacion' }],
  ['buscar', 'busco en Paucarpta un sector con colegio y parque cerca', { intencion: 'buscar', distrito: 'Paucarpta', criterios: ['colegio', 'areaVerde'] }],
];

describe('Un solo buscador y un solo campo «distrito»', () => {
  it.each(PARES)('«%s»: las reglas y el modelo resuelven «Paucarpta» al mismo distrito, con tipeo', (tipo, frase, args) => {
    const reglas = A.interpretar(frase);
    const m = modelo(args);
    expect(reglas.tipo).toBe(tipo);
    expect(m.tipo).toBe(tipo);
    expect(reglas.distrito).toBe('PAUCARPATA');
    expect(m.distrito).toBe('PAUCARPATA');
    expect(m.distritoFuera).toBe(reglas.distritoFuera);
  });

  it('el esquema tiene un único campo «distrito», de texto libre, y el prompt lo describe para todas las intenciones', () => {
    const props = LLM.HERRAMIENTA.parameters.properties;
    expect(Object.keys(props).filter((k) => k === 'distrito')).toHaveLength(1);
    expect(props.distrito.type).toBe('string');
    expect(props.distrito.enum).toBeUndefined();
    ['contar_en_distrito', 'perfil_distrito', 'rutas', 'precio_distrito'].forEach((i) => expect(LLM.INTENCIONES).toContain(i));
    expect(props.distrito.description).toMatch(/rutas/);
    expect(PROMPT_INTERPRETAR).toMatch(/precio_distrito/);
    expect(PROMPT_INTERPRETAR).toMatch(/intencion=rutas/);
  });

  it('la validación del campo es la misma para todas las intenciones', () => {
    ['contar_en_distrito', 'perfil_distrito', 'rutas', 'precio_distrito', 'riesgo_cenepred', 'buscar'].forEach((intencion) => {
      const base = intencion === 'contar_en_distrito' || intencion === 'buscar' ? { criterios: ['colegio'] } : {};
      expect(LLM.validarSpec({ intencion, ...base, distrito: 'Cayma; DROP TABLE' })).toEqual({ ok: false, motivo: 'distrito_invalido' });
      expect(LLM.validarSpec({ intencion, ...base, distrito: 7 })).toEqual({ ok: false, motivo: 'distrito_no_es_texto' });
      expect(LLM.validarSpec({ intencion, ...base, distrito: 'a'.repeat(61) })).toEqual({ ok: false, motivo: 'distrito_invalido' });
    });
  });

  it('un nombre que no es un distrito se dice igual en todas las intenciones, con reglas y con modelo', () => {
    const frases = ['¿qué líneas pasan por Narnia?'];
    frases.forEach((f) => expect(A.interpretar(f)).toMatchObject({ tipo: 'distrito_desconocido', distritoTexto: 'narnia' }));
    PARES.forEach(([, , args]) => {
      expect(modelo({ ...args, distrito: 'Narnia' })).toMatchObject({ tipo: 'distrito_desconocido', distritoTexto: 'Narnia' });
    });
  });

  it('Vítor existe en la provincia pero no está en los datos: contar, perfil, rutas y precio lo dicen igual', () => {
    const fuera = (i: any) => i.distrito === 'VITOR' && i.distritoFuera === true;
    expect(fuera(A.interpretar('¿qué buses pasan por Vitor?'))).toBe(true);
    expect(fuera(A.interpretar('¿cuántos colegios hay en Vitor?'))).toBe(true);
    expect(fuera(A.interpretar('quiero vivir en Vitor'))).toBe(true);
    expect(fuera(A.interpretar('¿cuánto cuesta el m² en Vitor?'))).toBe(true);
    expect(A.responder(A.interpretar('¿qué buses pasan por Vitor?'), { distritoTitulo: 'Vítor' }).texto).toContain('no está en los datos');
  });

  it('el precio ya no tiene lista ni buscador propios', () => {
    const Precios = require('../public/js/precios.js');
    expect(Precios.distritoEnTexto).toBeUndefined();
    expect(Precios.DISTRITOS_AQP).toBeUndefined();
  });
});

describe('Perfil del distrito: líneas de transporte (OpenStreetMap) y precio de oferta', () => {
  const perfil = {
    conteo: {
      colegios: { total: 235, inicial: 134, primaria: 90, secundaria: 55, sinNivel: 0, lista: [] },
      salud: { total: 18, lista: [] },
      paraderos: { total: 43, lista: [] },
      parques: { total: 145, grandes: 8, areaTotalM2: 400000, lista: [] },
    },
    zonas: { conPlano: true, partes: [{ id: 'residencial', etiqueta: 'residencial', pct: 61.6 }] },
    cauces: { nombres: ['Río Chili'], total: 2 },
  };
  const FC = {
    type: 'FeatureCollection',
    metadata: { fuente: 'OpenStreetMap (ODbL), relaciones route=bus de la red SIT y paradas de bus', fecha_extraccion: '2026-11-10' },
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-71.54, -16.4], [-71.53, -16.4]] }, properties: { tipo: 'ruta', fuente: 'OSM', osm: 'relation/1', linea: 'C2', ramal: 'Cettar', nombre: 'Cettar: A → B', desde: 'A', hasta: 'B', operador: 'C2 - Cono Norte' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-71.52, -16.39], [-71.52, -16.41]] }, properties: { tipo: 'ruta', fuente: 'OSM', osm: 'relation/3', linea: 'C5', ramal: 'Norte', nombre: 'Norte: A → B', desde: 'A', hasta: 'B', operador: 'C5 - EtraBus' } },
    ],
  };
  const idx = RT.indexar(FC);
  const poligono = { type: 'Polygon', coordinates: [[[-71.535, -16.43], [-71.505, -16.43], [-71.505, -16.38], [-71.535, -16.38], [-71.535, -16.43]]] };
  const rutasDistrito = (distrito: string) => ({ distrito, res: RT.cruzan(idx, poligono) });
  const perfilDe = (frase: string, extra: object) => A.responder(A.interpretar(frase), { distritoTitulo: 'X', perfil, fecha: '2026-10-28', ...extra });

  it('en Cayma (tiene precio) junta zonificación, servicios, quebradas, líneas que lo cruzan y el precio de oferta', () => {
    const { texto } = perfilDe('quiero vivir en Cayma', { distritoTitulo: 'Cayma', rutasDistrito: rutasDistrito('CAYMA'), precios: PRECIOS });
    expect(texto).toContain('235 colegios');
    expect(texto).toContain('Río Chili');
    expect(texto).toContain('• Líneas de transporte (OpenStreetMap): 2 líneas cruzan el distrito: C2 (Cono Norte), C5 (EtraBus).');
    expect(texto).toMatch(/• Precio de oferta \(Aptología, [^)]+\): S\/ 4,905 por m² \(mediana de 118 avisos de departamentos en venta; es lo que piden, no lo que se paga\)\./);
    expect(texto).toMatch(/¿Qué es lo primero para ti/);
  });

  it('en un distrito sin cifra de precio (Paucarpata) omite el precio: no inventa ni estima', () => {
    const { texto } = perfilDe('quiero vivir en Paucarpata', { distritoTitulo: 'Paucarpata', rutasDistrito: rutasDistrito('PAUCARPATA'), precios: PRECIOS });
    expect(texto).toContain('• Líneas de transporte (OpenStreetMap)');
    expect(texto).not.toMatch(/Precio de oferta|S\/|Aptología/);
  });

  it('si ninguna línea cruza el distrito, lo dice; si no se pudieron leer, no dice nada de líneas', () => {
    const vacio = { distrito: 'SOCABAYA', res: RT.cruzan(idx, { type: 'Polygon', coordinates: [[[-71.5, -16.45], [-71.49, -16.45], [-71.49, -16.44], [-71.5, -16.44], [-71.5, -16.45]]] }) };
    expect(perfilDe('quiero vivir en Socabaya', { rutasDistrito: vacio }).texto).toContain('ninguna de las líneas mapeadas cruza el distrito');
    expect(perfilDe('quiero vivir en Socabaya', { rutasDistrito: { distrito: 'SOCABAYA', error: 'sin red' } }).texto).not.toMatch(/Líneas de transporte/);
    expect(perfilDe('quiero vivir en Socabaya', {}).texto).not.toMatch(/Líneas de transporte|Precio de oferta/);
  });

  it('con una sola línea concuerda en singular', () => {
    const una = { distrito: 'CAYMA', res: { ...rutasDistrito('CAYMA').res, lineas: rutasDistrito('CAYMA').res.lineas.slice(0, 1) } };
    expect(perfilDe('quiero vivir en Cayma', { rutasDistrito: una }).texto).toContain('1 línea cruza el distrito: C2 (Cono Norte).');
  });
});
