/**
 * Electricidad: ¿el punto está dentro de un área de concesión de distribución eléctrica (SEAL u otra)? Es INFORMATIVO: una concesión dice a quién
 * le corresponde dar el servicio en esa zona, NO que el predio tenga conexión. Aquí: el cálculo (Calculos), la ficha (Equipamiento), el mapa (Capas),
 * el chat (Asistente), el informe (Reporte) y los archivos reales. Sin red: `fetch` devuelve los archivos de prueba.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const cargarConfig = () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${readFileSync(join(__dirname, '..', 'public', 'js', 'config.js'), 'utf8')}\nglobalThis.__CONFIG = CONFIG;`, ctx, { filename: 'config.js' });
  return (ctx as { __CONFIG: any }).__CONFIG;
};
const CONFIG = cargarConfig();
const Calculos = require('../public/js/calculos.js');
Object.assign(globalThis, { CONFIG, Calculos, Services: {}, Rutas: {} });
const Asistente = require('../public/js/asistente.js');
const Capas = require('../public/js/capas.js');
const Reporte = require('../public/js/reporte.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const P = { lat: -16.409, lon: -71.5375 };
const dLon = (m: number) => m / (M_POR_GRADO_LAT * Math.cos((P.lat * Math.PI) / 180));
/** Cuadrado de `lado` m cuyo borde sur queda `mNorte` m al norte del punto y su borde oeste `mEste` m al este. */
const cuadrado = (mNorte: number, mEste: number, lado: number, properties: object) => {
  const x0 = P.lon + dLon(mEste);
  const x1 = P.lon + dLon(mEste + lado);
  const y0 = P.lat + mNorte / M_POR_GRADO_LAT;
  const y1 = P.lat + (mNorte + lado) / M_POR_GRADO_LAT;
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
};
const props = (nombre: string, extra: object = {}) => ({
  objectid: 1, nombre_zona: nombre, situacion: 'DERECHO VIGENTE', concesion: 'DISTRIBUCION AREQUIPA', empresa: 'SOCIEDAD ELECTRICA DEL SUR OESTE S.A.',
  concesionaria: 'SEAL', expediente: '15008293-00-00', tipo_concesion: 'Concesion Definitiva', sistema_electrico: 'SEIN', ...extra,
});
// SEAL: 2 km de lado, el punto está dentro (borde sur 1000 m al sur). Electrosur: más al este.
const SEAL = cuadrado(-1000, -1000, 2000, props('DISTRIBUCION AREQUIPA'));
const SEAL_AMPLIACION = cuadrado(-500, -500, 1000, props('AREQUIPA (AMPLIACION)', { objectid: 2 })); // se superpone con la anterior
const LEJOS = cuadrado(3000, 3000, 1000, props('ZONA LEJANA', { objectid: 3 }));
const OTRA = cuadrado(0, 600, 500, props('ZONA ELECTROSUR', { objectid: 4, concesionaria: 'Electrosur', empresa: 'ELECTROSUR S.A.', expediente: '15005193-00-00' }));
const META = { fuente: 'MINEM (DGE), Concesiones de Distribución Eléctrica', fecha: '2026-11-10', metodo: 'm' };

// ------------------------------------------------------------------------------ Cálculo

describe('Calculos.evaluarConcesion', () => {
  it('dentro de una concesión: dice cuál, la concesionaria y distancia 0; INFORMATIVO, sin umbral', () => {
    const r = Calculos.evaluarConcesion(P, [LEJOS, SEAL], META);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', dentro: true, distanciaM: 0, umbralM: null, concesionaria: 'SEAL', nombre: 'DISTRIBUCION AREQUIPA' });
    expect(r.concesiones).toHaveLength(1);
    expect(r.concesiones[0]).toMatchObject({ nombre_zona: 'DISTRIBUCION AREQUIPA', expediente: '15008293-00-00', empresa: 'SOCIEDAD ELECTRICA DEL SUR OESTE S.A.' });
  });
  it('si varios polígonos de la misma concesión contienen el punto, los lista todos y las concesionarias distintas sin repetir', () => {
    const r = Calculos.evaluarConcesion(P, [SEAL, SEAL_AMPLIACION], META);
    expect(r.concesiones.map((c: { nombre_zona: string }) => c.nombre_zona).sort()).toEqual(['AREQUIPA (AMPLIACION)', 'DISTRIBUCION AREQUIPA']);
    expect(r.concesionarias).toEqual(['SEAL']);
  });
  it('fuera de toda concesión: dentro=false y la distancia al BORDE de la más cercana', () => {
    const r = Calculos.evaluarConcesion(P, [LEJOS, OTRA], META);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', dentro: false, concesionaria: 'Electrosur', nombre: 'ZONA ELECTROSUR' });
    expect(r.distanciaM).toBeGreaterThan(590);
    expect(r.distanciaM).toBeLessThan(610);
    expect(r.concesiones).toEqual([]);
  });
  it('el punto sobre el borde cuenta como dentro; unos metros afuera, no', () => {
    const sobre = Calculos.evaluarConcesion({ lat: P.lat, lon: P.lon + dLon(-1000) + 1e-9 }, [SEAL], META);
    expect(sobre.dentro).toBe(true);
    const afuera = Calculos.evaluarConcesion({ lat: P.lat, lon: P.lon + dLon(-1050) }, [SEAL], META);
    expect(afuera.dentro).toBe(false);
    expect(afuera.distanciaM).toBeGreaterThan(40);
    expect(afuera.distanciaM).toBeLessThan(60);
  });
  it('un hueco del polígono queda fuera de la concesión', () => {
    const conHueco = JSON.parse(JSON.stringify(SEAL));
    const h = cuadrado(-100, -100, 200, {}).geometry.coordinates[0];
    conHueco.geometry.coordinates.push(h);
    const r = Calculos.evaluarConcesion(P, [conHueco], META);
    expect(r.dentro).toBe(false);
    expect(r.distanciaM).toBeLessThan(110);
  });
  it('sin polígonos válidos es SIN DATO y no inventa una distancia', () => {
    for (const lista of [[], null, [{ type: 'Feature', properties: props('x'), geometry: { type: 'Point', coordinates: [P.lon, P.lat] } }]]) {
      expect(Calculos.evaluarConcesion(P, lista, META)).toMatchObject({ estado: 'SIN DATO', dentro: null, distanciaM: null, concesiones: [] });
    }
  });
  it('lleva la fuente, la fecha y el método que se le dan', () => {
    expect(Calculos.evaluarConcesion(P, [SEAL], META)).toMatchObject({ fuente: META.fuente, fecha: '2026-11-10', metodo: 'm' });
  });
});

describe('Calculos.textoElectricidad: no afirma que haya luz', () => {
  const dentro = Calculos.evaluarConcesion(P, [SEAL], META);
  const fuera = Calculos.evaluarConcesion(P, [OTRA], META);
  const sinDato = Calculos.evaluarConcesion(P, [], META);
  const PROHIBIDO = /\b(tiene|tienes|cuenta con|dispone de|hay) (luz|servicio el[eé]ctrico|electricidad|energ[ií]a|conexi[oó]n)\b|est[aá] (electrificad|conectad)|con luz\b/i;

  it('dentro: dice «dentro del área de concesión de SEAL» y aclara que eso no es una conexión', () => {
    const t = Calculos.textoElectricidad(dentro);
    expect(t).toMatch(/dentro del área de concesión de distribución eléctrica de SEAL/);
    expect(t).toMatch(/no significa/i);
    expect(t).toMatch(/conexi[oó]n/i);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('fuera: la distancia al borde de la más cercana, sin decir que no hay luz', () => {
    const t = Calculos.textoElectricidad(fuera);
    expect(t).toMatch(/fuera de las áreas de concesión/);
    expect(t).toMatch(/Electrosur/);
    expect(t).toMatch(/\d+ m/);
    expect(t).toMatch(/no significa/i);
    expect(t).not.toMatch(/no (tiene|hay) (luz|electricidad|servicio)/i);
  });
  it('sin dato: lo dice sin inventar', () => {
    expect(Calculos.textoElectricidad(sinDato)).toMatch(/sin dato/i);
  });
  it('la nota cita el artículo 34 de la Ley de Concesiones Eléctricas con lo que dice y lo que no, y que la cobertura real vendría del censo', () => {
    const n = Calculos.NOTA_ELECTRICIDAD;
    expect(n).toMatch(/artículo 34/i);
    expect(n).toMatch(/solicite/i);
    expect(n).toMatch(/censo/i);
    expect(n).toMatch(/no (dice|significa)/i);
    expect(n).not.toMatch(PROHIBIDO);
  });
});

describe('CONFIG: la electricidad no tiene umbral', () => {
  it('umbral null con su fuente, y la ruta del archivo; lo demás no cambia', () => {
    expect(CONFIG.umbrales.electricidad).toBeNull();
    expect(CONFIG.fuentesUmbral.electricidad).toMatch(/sin umbral/i);
    expect(CONFIG.equipamiento.archivos.electricidad).toBe('data/electricidad/concesiones_distribucion.geojson');
    expect(CONFIG.umbrales.salud).toBe(1000);
    expect(CONFIG.umbrales.transporte).toBe(400);
  });
});

// ------------------------------------------------------------------------------ Ficha

const archivo = (features: object[]) => ({
  type: 'FeatureCollection',
  metadata: { fuente: 'MINEM (DGE), Concesiones de Distribución Eléctrica', fecha_descarga: '2026-11-10', licencia: 'ODC-By' },
  features,
});
const vacio = { type: 'FeatureCollection', metadata: { fecha_extraccion: '2026-10-28' }, features: [] };
const ARCHIVOS: Record<string, any> = {};
(globalThis as any).fetch = async (url: string) => {
  const hallado = Object.entries(CONFIG.equipamiento.archivos).find(([, ruta]) => ruta === url);
  const datos = hallado ? ARCHIVOS[hallado[0]] : undefined;
  return datos ? { ok: true, status: 200, json: async () => datos } : { ok: false, status: 404, json: async () => ({}) };
};
const cargarEquipamiento = (datos: Record<string, object>) => {
  for (const k of Object.keys(ARCHIVOS)) delete ARCHIVOS[k];
  Object.assign(ARCHIVOS, { salud: vacio, educacion: vacio, transporte: vacio, areasVerdes: vacio, ...datos });
  jest.resetModules();
  Object.assign(globalThis, { CONFIG, Calculos: require('../public/js/calculos.js'), Services: {}, Rutas: {} });
  return require('../public/js/equipamiento.js');
};
const ev = (datos: Record<string, object>) => cargarEquipamiento(datos).evaluar(P.lat, P.lon);

describe('Equipamiento.evaluar: electricidad', () => {
  it('lee el archivo congelado y dice si el punto está dentro de una concesión, con la fuente y la fecha del archivo', async () => {
    const e = await ev({ electricidad: archivo([SEAL, LEJOS]) });
    expect(e.electricidad).toMatchObject({ estado: 'INFORMATIVO', dentro: true, concesionaria: 'SEAL', umbralM: null, fecha: '2026-11-10', fuente: 'MINEM (DGE), Concesiones de Distribución Eléctrica' });
    expect(e.electricidad.metodo).toMatch(/sin umbral/i);
    expect(e.electricidad.metodo).toMatch(/no (dice|significa)/i);
  });
  it('fuera de las concesiones del archivo da la distancia al borde de la más cercana', async () => {
    const e = await ev({ electricidad: archivo([OTRA]) });
    expect(e.electricidad).toMatchObject({ estado: 'INFORMATIVO', dentro: false });
    expect(e.electricidad.distanciaM).toBeGreaterThan(590);
  });
  it('sin el archivo dice SIN DATO, no consulta nada en vivo y no afecta a lo demás', async () => {
    const e = await ev({});
    expect(e.electricidad).toMatchObject({ estado: 'SIN DATO', dentro: null, distanciaM: null, umbralM: null });
    expect(e.salud.estado).toBe('SIN DATO');
  });
});

// ------------------------------------------------------------------------------ Sin efecto en la búsqueda ni el puntaje

const UMBRALES = { salud: 1000, consultorio: null, electricidad: null, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };

describe('la electricidad no es un criterio de búsqueda ni suma al puntaje', () => {
  it('no hay un criterio de electricidad y «un parque con luz» busca solo por el parque', () => {
    expect(Asistente.CRITERIOS.electricidad).toBeUndefined();
    expect(Asistente.interpretar('quiero un parque con luz').criterios.map((c: { id: string }) => c.id)).toEqual(['areaVerde']);
  });
});

// ------------------------------------------------------------------------------ Mapa

describe('Capas: la concesión eléctrica es una capa de polígonos', () => {
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES, area: null };
  it('está entre las capas de riesgo/servicio con su etiqueta', () => {
    expect(Capas.CAPAS.find((c: { id: string }) => c.id === 'electricidad')).toMatchObject({ etiqueta: 'Concesión eléctrica (SEAL y otras)' });
  });
  it('dibuja cada polígono entero con su concesionaria y su expediente, y una línea de leyenda por concesionaria', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'electricidad' }], electricidad: [SEAL, SEAL_AMPLIACION, OTRA] });
    expect(c.poligonos.filter((p: { capa: string }) => p.capa === 'electricidad')).toHaveLength(3);
    const p = c.poligonos.find((x: { nombre: string }) => x.nombre === 'DISTRIBUCION AREQUIPA');
    expect(p.detalle).toMatch(/SEAL/);
    expect(p.detalle).toMatch(/15008293-00-00/);
    expect(p.geometry).toBe(SEAL.geometry);
    expect(c.circulos).toEqual([]);
    expect(c.puntos).toEqual([]);
    expect(c.leyenda.map((l: { texto: string }) => l.texto).sort()).toEqual(['Concesión de Electrosur: 1', 'Concesión de SEAL: 2']);
  });
  it('sin el archivo lo dice y no dibuja nada', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'electricidad' }], electricidad: null });
    expect(c.poligonos).toEqual([]);
    expect(c.sinDatos).toContain('electricidad');
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: «con luz», «electricidad» y «SEAL» se responden con la concesión, con la salvedad', () => {
  const ctxBase = { punto: { lat: P.lat, lon: P.lon }, zona: null, estadoPDM: null };
  const dentro = Calculos.evaluarConcesion(P, [SEAL], META);
  const fuera = Calculos.evaluarConcesion(P, [OTRA], META);
  const PROHIBIDO = /\b(tiene|tienes|cuenta con|dispone de|hay) (luz|servicio el[eé]ctrico|electricidad|energ[ií]a|conexi[oó]n)\b|est[aá] (electrificad|conectad)/i;

  it('las preguntas por la luz son una intención propia, no un criterio de búsqueda', () => {
    for (const t of ['¿hay luz en mi punto?', '¿tiene electricidad este terreno?', '¿es zona de SEAL?', '¿quién da el servicio eléctrico aquí?', 'tiene luz mi punto', '¿esto está en la concesión de SEAL?']) {
      expect(Asistente.interpretar(t, { hayPunto: true })).toMatchObject({ tipo: 'electricidad', criterios: [] });
    }
  });
  it('buscar zonas «con luz» no se puede y lo dice', () => {
    expect(Asistente.interpretar('busco una zona con luz y electricidad')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'electricidad_busqueda' });
  });
  it('mencionaElectricidad detecta las palabras (para no mandar la frase al modelo)', () => {
    for (const t of ['¿hay luz?', 'electricidad', 'zona de SEAL', 'servicio eléctrico', 'energía eléctrica']) expect(Asistente.mencionaElectricidad(t)).toBe(true);
    expect(Asistente.mencionaElectricidad('busco una posta')).toBe(false);
    expect(Asistente.mencionaElectricidad('luz del día')).toBe(false);
  });
  it('dentro: dice la concesión, que no es una conexión, la fuente y el censo pendiente', () => {
    const t = Asistente.responder({ tipo: 'electricidad', criterios: [] }, { ...ctxBase, entorno: { electricidad: dentro } }).texto;
    expect(t).toMatch(/dentro del área de concesión de distribución eléctrica de SEAL/);
    expect(t).toMatch(/no significa/i);
    expect(t).toMatch(/censo/i);
    expect(t).toMatch(/MINEM/);
    expect(t).not.toMatch(PROHIBIDO);
    expect(t).not.toMatch(/cumple/i);
  });
  it('fuera: la distancia al borde sin decir que no hay luz', () => {
    const t = Asistente.responder({ tipo: 'electricidad', criterios: [] }, { ...ctxBase, entorno: { electricidad: fuera } }).texto;
    expect(t).toMatch(/fuera de las áreas de concesión/);
    expect(t).toMatch(/\d+ m/);
    expect(t).not.toMatch(/no (tiene|hay) (luz|electricidad|servicio)/i);
  });
  it('sin punto pide elegir uno; sin dato lo dice', () => {
    expect(Asistente.responder({ tipo: 'electricidad', criterios: [] }, {}).texto).toMatch(/punto/);
    const sin = Calculos.evaluarConcesion(P, [], META);
    expect(Asistente.responder({ tipo: 'electricidad', criterios: [] }, { ...ctxBase, entorno: { electricidad: sin } }).texto).toMatch(/sin dato|no tengo/i);
  });
  it('el resumen del punto trae una línea informativa de electricidad', () => {
    const entorno: any = {
      electricidad: dentro,
      salud: { estado: 'NO CUMPLE', nombre: 'H', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS' },
      educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
      transporte: { estado: 'CUMPLE', nombre: 'P', distanciaM: 100, umbralM: 400 },
      areaVerde: { estado: 'CUMPLE', nombre: 'Q', distanciaM: 100, umbralM: 300 },
    };
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, { ...ctxBase, entorno }).texto;
    expect(t).toMatch(/Electricidad \(informativo\): dentro del área de concesión de SEAL/);
  });
  it('«fuentes» menciona la concesión del MINEM', () => {
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/concesi[oó]n/i);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: electricidad es una sección informativa', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD)', metodo: 'Distancia en línea recta.', ...extra });
  const d = (conElectricidad: boolean) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UMBRALES,
    fuentesUmbral: { ...CONFIG.fuentesUmbral },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({}),
      ...(conElectricidad ? { electricidad: Calculos.evaluarConcesion(P, [SEAL], META) } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  const seccion = (datos: object) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => s.titulo.includes('Electricidad'));
  it('hay una sección «Electricidad (informativo)» con la concesión, la concesionaria, el expediente, la fuente y la salvedad', () => {
    const s = seccion(d(true));
    expect(s.titulo).toMatch(/informativo/i);
    for (const t of ['SEAL', 'DISTRIBUCION AREQUIPA', '15008293-00-00', 'INFORMATIVO']) expect(s.cuerpo).toContain(t);
    expect(s.cuerpo).toMatch(/no significa/i);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE|Umbral/);
    expect(s.fuente).toMatch(/MINEM/);
  });
  it('sin electricidad en las variables, el informe no cambia', () => {
    expect(seccion(d(false))).toBeUndefined();
  });
  it('las limitaciones dicen que una concesión no es una conexión', () => {
    expect(Reporte.limites(d(true)).join(' ')).toMatch(/concesi[oó]n[^.]*no[^.]*conexi[oó]n|no[^.]*conexi[oó]n[^.]*concesi[oó]n/i);
  });
});

// ------------------------------------------------------------------------------ Archivo real

describe('archivo real de concesiones', () => {
  const ruta = join(__dirname, '..', 'public', 'data', 'electricidad', 'concesiones_distribucion.geojson');
  const fc = JSON.parse(readFileSync(ruta, 'utf8'));
  const PLAZA_DE_ARMAS = { lat: -16.3989, lon: -71.5369 };

  it('trae la procedencia: fuente, enlaces, fecha de descarga, licencia y expedientes', () => {
    const m = fc.metadata;
    expect(m.fuente).toMatch(/MINEM/);
    expect(m.url_servicio).toMatch(/^https:\/\/geoportal\.minem\.gob\.pe\/.*MapServer\/0$/);
    expect(m.url_datos_abiertos).toMatch(/datosabiertos\.gob\.pe/);
    expect(m.fecha_descarga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.licencia).toMatch(/ODC-By/);
    expect(m.expedientes).toContain('15008293-00-00');
  });
  it('la Plaza de Armas de Arequipa está dentro de la concesión de SEAL', () => {
    const r = Calculos.evaluarConcesion(PLAZA_DE_ARMAS, fc.features, META);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', dentro: true, distanciaM: 0, concesionarias: ['SEAL'] });
    expect(r.concesiones.every((c: { expediente: string }) => c.expediente === '15008293-00-00')).toBe(true);
  });
  it('un punto en Lima (fuera del archivo) queda fuera, con una distancia grande', () => {
    const r = Calculos.evaluarConcesion({ lat: -12.05, lon: -77.04 }, fc.features, META);
    expect(r.dentro).toBe(false);
    expect(r.distanciaM).toBeGreaterThan(500000);
  });
});
