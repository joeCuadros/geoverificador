/**
 * El asistente y las líneas de transporte (OpenStreetMap): «¿qué buses pasan por aquí?» y «¿qué líneas pasan por Paucarpata?».
 * Reglas (Asistente.interpretar), respuesta (Asistente.responder), contrato con Gemini (AsistenteLLM) e indicación al modelo.
 * Las líneas salen siempre del motor determinista: el modelo solo nombra la intención y, si lo dijo la persona, el distrito.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const A = require('../public/js/asistente.js');
const LLM = require('../public/js/asistente-llm.js');
const RT = require('../public/js/rutas.js');
const { PROMPT_INTERPRETAR } = require('../api/_lib/gemini.js');

const FC = {
  type: 'FeatureCollection',
  metadata: { fuente: 'OpenStreetMap (ODbL), relaciones route=bus de la red SIT y paradas de bus', fecha_extraccion: '2026-11-10' },
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-71.54, -16.4], [-71.53, -16.4]] }, properties: { tipo: 'ruta', fuente: 'OSM', osm: 'relation/1', linea: 'C2', ramal: 'Cettar', nombre: 'Cettar: A → B', desde: 'A', hasta: 'B', operador: 'C2 - Cono Norte' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-71.52, -16.39], [-71.52, -16.41]] }, properties: { tipo: 'ruta', fuente: 'OSM', osm: 'relation/3', linea: 'C5', ramal: 'Norte', nombre: 'Norte: A → B', desde: 'A', hasta: 'B', operador: 'C5 - EtraBus' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-71.535, -16.4] }, properties: { tipo: 'parada', osm: 'node/1', nombre: 'Cettar - 2', clase: 'platform', rutas: ['relation/1'], lineas: ['C2'] } },
  ],
};
const idx = RT.indexar(FC);
const paucarpata = { type: 'Polygon', coordinates: [[[-71.535, -16.43], [-71.505, -16.43], [-71.505, -16.38], [-71.535, -16.38], [-71.535, -16.43]]] };
const entorno = (rutas: any) => ({ transporte: { estado: 'CUMPLE', nombre: 'Paradero X', distanciaM: 120, umbralM: 400, rutas } });

describe('Asistente.interpretar: líneas de transporte', () => {
  const tipo = (t: string, ctx = {}) => A.interpretar(t, ctx);

  it.each([
    '¿Qué buses pasan por aquí?',
    '¿qué líneas pasan por mi punto?',
    'que combis pasan cerca',
    '¿Cuáles rutas pasan por este lugar?',
    '¿hay buses cerca?',
    'qué micros circulan por aquí',
  ])('«%s» es una pregunta de líneas sobre el punto', (frase) => {
    const i = tipo(frase, { hayPunto: true });
    expect(i.tipo).toBe('rutas');
    expect(i.distrito).toBeNull();
    expect(i.criterios).toEqual([]);
  });

  it.each([
    ['¿Qué líneas pasan por Paucarpata?', 'PAUCARPATA'],
    ['que lineas pasan por el distrito de Cerro Colorado', 'CERRO COLORADO'],
    ['¿qué buses pasan por José Luis Bustamante y Rivero?', 'JOSE LUIS BUSTAMANTE Y RIVERO'],
    ['que combis hay en Cayma', 'CAYMA'],
    ['¿Cuáles rutas cruzan Yanahuara hoy?', 'YANAHUARA'],
    ['¿qué líneas pasan por Paucarpta?', 'PAUCARPATA'], // el mismo buscador con tolerancia a errores de tipeo que usan contar y perfil
  ])('«%s» nombra el distrito %s', (frase, distrito) => {
    const i = tipo(frase);
    expect(i.tipo).toBe('rutas');
    expect(i.distrito).toBe(distrito);
  });

  it('una búsqueda de zonas con transporte sigue siendo una búsqueda', () => {
    expect(tipo('busco una zona cerca de un paradero y de buses').tipo).toBe('buscar');
    expect(tipo('busco zonas donde pasen buses').tipo).toBe('buscar');
    expect(tipo('¿Hay un paradero cerca?', { hayPunto: true }).tipo).toBe('servicio');
  });

  it('un nombre que no es un distrito de la provincia no se adivina: se dice', () => {
    const i = tipo('¿qué líneas pasan por Narnia?');
    expect(i).toMatchObject({ tipo: 'distrito_desconocido', distritoTexto: 'narnia' });
    expect(A.responder(i, {}).texto).toContain('No reconozco «narnia»');
  });

  it('un distrito que existe pero no está en los datos (Vítor) lo dice', () => {
    const i = tipo('¿qué buses pasan por Vitor?');
    expect(i).toMatchObject({ tipo: 'rutas', distrito: 'VITOR', distritoFuera: true });
    expect(A.responder(i, { distritoTitulo: 'Vítor' }).texto).toContain('no está en los datos');
  });

  it('no confunde un distrito con «hoy», «ahora» ni con el punto', () => {
    expect(tipo('que lineas pasan ahora').distrito).toBeNull();
    expect(tipo('que lineas pasan por mi zona').distrito).toBeNull();
  });
});

describe('Asistente.responder: líneas del punto', () => {
  const r = RT.cerca(idx, -16.402, -71.535, 400);
  const ask = (c: any) => A.responder(A.interpretar('¿qué buses pasan por aquí?', { hayPunto: true }), c);

  it('lista las líneas con su empresa, la distancia al trazado y la parada mapeada más cercana, con fuente y licencia', () => {
    const { texto } = ask({ punto: { lat: -16.402, lon: -71.535 }, entorno: entorno(r) });
    expect(texto).toContain('Líneas que pasan a 400 m o menos de tu punto: C2 (Cono Norte).');
    expect(texto).toContain('• C2 (Cono Norte): el trazado pasa a 222 m; parada mapeada más cercana «Cettar - 2» a 222 m.');
    expect(texto).toContain('400 m es una convención del proyecto');
    expect(texto).toContain('OpenStreetMap (ODbL)');
    expect(texto).toContain('© colaboradores de OpenStreetMap (ODbL)');
    expect(texto).not.toMatch(/SmartBus|autorización verbal/);
    expect(texto).toContain('sin frecuencias ni horarios');
  });

  it('dice cuando ninguna línea pasa tan cerca, sin inventar', () => {
    const lejos = RT.cerca(idx, -16.45, -71.5, 400);
    expect(ask({ punto: { lat: -16.45, lon: -71.5 }, entorno: entorno(lejos) }).texto).toContain('Ninguna de las líneas mapeadas en OpenStreetMap pasa a 400 m o menos de tu punto');
  });

  it('si no hay punto lo pide y ofrece preguntar por un distrito', () => {
    expect(ask({ punto: null }).texto).toMatch(/Elige un punto.*Paucarpata/);
  });

  it('si el archivo falló lo dice; si aún no llegó, pide esperar', () => {
    expect(ask({ punto: { lat: 0, lon: 0 }, entorno: entorno({ error: 'sin archivo', lineas: [], distanciaM: 400 }) }).texto).toContain('No pude leer las líneas de transporte (sin archivo)');
    expect(ask({ punto: { lat: 0, lon: 0 }, entorno: null }).texto).toContain('todavía');
  });

  it('la ficha y la pregunta de servicio agregan las líneas junto al paradero', () => {
    const ctx = { punto: { lat: -16.402, lon: -71.535 }, distrito: 'AREQUIPA', entorno: { ...entorno(r), salud: entorno(r).transporte, educacion: { inicial: entorno(r).transporte, primaria: entorno(r).transporte, secundaria: entorno(r).transporte }, areaVerde: entorno(r).transporte }, zona: null };
    expect(A.responder(A.interpretar('dame un resumen', { hayPunto: true }), ctx).texto).toContain('Líneas que pasan a ≤400 m: C2 (Cono Norte).');
    expect(A.responder(A.interpretar('¿hay un paradero cerca?', { hayPunto: true }), ctx).texto).toContain('Líneas que pasan a ≤400 m: C2 (Cono Norte).');
  });
});

describe('Asistente.responder: líneas de un distrito', () => {
  const i = A.interpretar('¿qué líneas pasan por Paucarpata?');

  it('lista las líneas que cruzan el distrito y cuántas paradas tienen dentro', () => {
    const res = RT.cruzan(idx, paucarpata);
    const { texto } = A.responder(i, { rutasDistrito: { distrito: 'PAUCARPATA', res } });
    expect(texto).toContain('Líneas con trazado dentro del distrito de Paucarpata: C2 (Cono Norte), C5 (EtraBus).');
    expect(texto).toContain('• C5 (EtraBus): el trazado entra al distrito, sin paradas dentro.');
    expect(texto).toContain('OpenStreetMap (ODbL)');
    expect(texto).not.toMatch(/SmartBus|autorización verbal/);
  });

  it('no necesita un punto elegido', () => {
    const res = RT.cruzan(idx, paucarpata);
    expect(A.responder(i, { punto: null, rutasDistrito: { distrito: 'PAUCARPATA', res } }).texto).toContain('Paucarpata');
  });

  it('dice si ninguna línea entra al distrito y si falló la lectura', () => {
    const vacio = RT.cruzan(idx, { type: 'Polygon', coordinates: [[[-71.5, -16.45], [-71.49, -16.45], [-71.49, -16.44], [-71.5, -16.44], [-71.5, -16.45]]] });
    expect(A.responder(i, { distritoTitulo: 'Socabaya', rutasDistrito: { distrito: 'SOCABAYA', res: vacio } }).texto).toContain('Ninguna de las líneas mapeadas en OpenStreetMap tiene su trazado dentro del distrito de Socabaya');
    expect(A.responder(i, { rutasDistrito: { distrito: 'PAUCARPATA', error: 'sin red' } }).texto).toContain('No pude leer las líneas de transporte (sin red)');
  });

  it('las fuentes y la ayuda del asistente nombran a OpenStreetMap, sin SmartBus, y el tipo tiene su explicación', () => {
    expect(A.responder({ tipo: 'fuentes', criterios: [] }, {}).texto).toMatch(/Líneas de transporte \(recorridos y paradas\): OpenStreetMap/);
    expect(A.responder({ tipo: 'fuentes', criterios: [] }, {}).texto).not.toMatch(/SmartBus/);
    expect(A.responder({ tipo: 'ayuda', criterios: [] }, {}).texto).toContain('¿qué líneas pasan por Paucarpata?');
    const e = A.explicar('rutas');
    expect(e.porque.length + e.fuente.length + e.limites.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(e)).toMatch(/sin frecuencias ni horarios/);
  });
});

describe('AsistenteLLM: intención «rutas»', () => {
  const valido = (args: unknown) => {
    const v = LLM.validarSpec(args);
    expect(v.ok).toBe(true);
    return v.spec;
  };

  it('el esquema ofrece la intención y el campo distrito, y la indicación al modelo las describe', () => {
    expect(LLM.INTENCIONES).toContain('rutas');
    expect(LLM.HERRAMIENTA.parameters.properties.intencion.enum).toContain('rutas');
    expect(LLM.HERRAMIENTA.parameters.properties.distrito.type).toBe('string');
    expect(PROMPT_INTERPRETAR).toContain('intencion=rutas');
    expect(PROMPT_INTERPRETAR).toContain('distrito');
  });

  it('valida el distrito y lo vacía en las demás intenciones', () => {
    expect(valido({ intencion: 'rutas', distrito: '  Cerro Colorado ' }).distrito).toBe('Cerro Colorado');
    expect(valido({ intencion: 'rutas' }).distrito).toBeNull();
    expect(valido({ intencion: 'zona', distrito: 'Cayma' }).distrito).toBeNull();
    expect(valido({ intencion: 'buscar', criterios: ['salud'], distrito: 'Cayma' }).distrito).toBe('Cayma'); // en una búsqueda, la acota al distrito
  });

  it('rechaza un distrito con caracteres raros, demasiado largo o que no es texto', () => {
    expect(LLM.validarSpec({ intencion: 'rutas', distrito: 'Cayma; DROP TABLE' })).toEqual({ ok: false, motivo: 'distrito_invalido' });
    expect(LLM.validarSpec({ intencion: 'rutas', distrito: '<script>' })).toEqual({ ok: false, motivo: 'distrito_invalido' });
    expect(LLM.validarSpec({ intencion: 'rutas', distrito: 'a'.repeat(61) })).toEqual({ ok: false, motivo: 'distrito_invalido' });
    expect(LLM.validarSpec({ intencion: 'rutas', distrito: 7 })).toEqual({ ok: false, motivo: 'distrito_no_es_texto' });
  });

  it('la consulta del modelo se convierte en la misma intención que arma el intérprete de reglas', () => {
    const conDistrito = LLM.aIntencion(valido({ intencion: 'rutas', distrito: 'Paucarpata' }));
    const reglas = A.interpretar('¿qué líneas pasan por Paucarpata?');
    expect({ tipo: conDistrito.tipo, distrito: conDistrito.distrito, criterios: conDistrito.criterios }).toEqual({ tipo: reglas.tipo, distrito: reglas.distrito, criterios: reglas.criterios });
    const delPunto = LLM.aIntencion(valido({ intencion: 'rutas' }));
    expect(delPunto).toMatchObject({ tipo: 'rutas', distrito: null });
    // Con tipeo erróneo el modelo y las reglas resuelven igual: es el mismo buscador de distritos.
    expect(LLM.aIntencion(valido({ intencion: 'rutas', distrito: 'Paucarpta' }))).toMatchObject({ tipo: 'rutas', distrito: 'PAUCARPATA', distritoFuera: false });
    expect(LLM.aIntencion(valido({ intencion: 'rutas', distrito: 'Narnia' }))).toMatchObject({ tipo: 'distrito_desconocido', distritoTexto: 'Narnia' });
  });

  it('con el modelo, las líneas siguen saliendo del motor determinista (el modelo no aporta ningún dato)', () => {
    const intencion = LLM.aIntencion(valido({ intencion: 'rutas', distrito: 'paucarpata' }));
    const res = RT.cruzan(idx, paucarpata);
    const { texto } = A.responder(intencion, { rutasDistrito: { distrito: 'PAUCARPATA', res } });
    expect(texto).toContain('C2 (Cono Norte), C5 (EtraBus)');
  });

  it('verificarTexto acepta una redacción con las líneas del resultado y rechaza una línea inventada', () => {
    const res = RT.cruzan(idx, paucarpata);
    const hechos = { texto: A.responder(A.interpretar('¿qué líneas pasan por Paucarpata?'), { rutasDistrito: { distrito: 'PAUCARPATA', res } }).texto };
    expect(LLM.verificarTexto('Por Paucarpata pasan C2 (Cono Norte) y C5 (EtraBus), según OpenStreetMap.', hechos).ok).toBe(true);
    expect(LLM.verificarTexto('Por Paucarpata pasan C2, C5 y C7.', hechos)).toEqual({ ok: false, motivo: 'cifra_nueva' });
  });
});
