/**
 * Consultorios médicos: una categoría APARTE de la salud y solo INFORMATIVA. Sin umbral (la distancia de referencia es una decisión
 * pendiente de la persona responsable del proyecto), así que no hay cumple / no cumple, no suman al puntaje ni a la búsqueda de zonas
 * del asistente, y el chat nunca dice que un consultorio satisface «salud cerca». Aquí: la configuración, la ficha (Equipamiento),
 * el mapa (Capas), el conteo por distrito (Entidades), el chat (Asistente) y el informe (Reporte). La clasificación de RENIPRESS y de
 * OpenStreetMap está en test/equipamiento-oficial.spec.ts y test/calculos.spec.ts. Sin red: `fetch` devuelve los archivos de prueba.
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
const Entidades = require('../public/js/entidades.js');
const Reporte = require('../public/js/reporte.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const P = { lat: -16.409, lon: -71.5375 };
const alNorte = (m: number) => [P.lon, P.lat + m / M_POR_GRADO_LAT];
const punto = (coords: number[], properties: object) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } });

// ------------------------------------------------------------------------------ Configuración

describe('CONFIG: el consultorio no tiene umbral', () => {
  it('su umbral es null y dice que falta una decisión; los demás umbrales no cambian', () => {
    expect(CONFIG.umbrales.consultorio).toBeNull();
    expect(CONFIG.fuentesUmbral.consultorio).toMatch(/decisi[oó]n/i);
    expect(CONFIG.umbrales.salud).toBe(1000);
    expect(CONFIG.umbrales.educacion).toEqual({ inicial: 500, primaria: 1500, secundaria: 3000 });
    expect(CONFIG.umbrales.transporte).toBe(400);
    expect(CONFIG.umbrales.areaVerde).toEqual({ distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 });
  });
  it('tiene su propio archivo de datos', () => {
    expect(CONFIG.equipamiento.archivos.consultorios).toBe('data/equipamiento/consultorios.geojson');
    expect(CONFIG.equipamiento.archivos.salud).toBe('data/equipamiento/salud.geojson');
  });
});

// ------------------------------------------------------------------------------ Ficha

const FUENTES = [
  { rol: 'primaria', id: 'RENIPRESS', nombre: 'RENIPRESS (SUSALUD)', fecha: '2026-10-30' },
  { rol: 'respaldo', id: 'OSM', nombre: 'OpenStreetMap', fecha: '2026-10-28' },
];
const archivo = (features: object[]) => ({
  type: 'FeatureCollection',
  metadata: { fuente: 'RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', fecha_extraccion: '2026-10-30', fuentes: FUENTES, deduplicacion: { radio_m: 200 } },
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
  Object.assign(ARCHIVOS, { educacion: vacio, transporte: vacio, areasVerdes: vacio, ...datos });
  jest.resetModules();
  Object.assign(globalThis, { CONFIG, Calculos: require('../public/js/calculos.js'), Services: {}, Rutas: {} });
  return require('../public/js/equipamiento.js');
};

const POSTA = punto(alNorte(900), { fuente: 'RENIPRESS', nombre: 'POSTA LEJANA', codigo_renipress: '00000009', categoria: 'I-2', clasificacion: 'PUESTOS DE SALUD O POSTAS DE SALUD' });
const CONSULTORIO = punto(alNorte(120), { fuente: 'RENIPRESS', nombre: 'CONSULTORIO DR. PEREZ', codigo_renipress: '00004', categoria: 'I-1', clasificacion: 'CONSULTORIOS MEDICOS Y DE OTROS PROFESIONALES DE LA SALUD' });

describe('Equipamiento.evaluar: el consultorio es informativo y la salud no lo cuenta', () => {
  it('da el consultorio más cercano y su distancia, INFORMATIVO, sin umbral, con su fuente y su código', async () => {
    const e = await cargarEquipamiento({ salud: archivo([POSTA]), consultorios: archivo([CONSULTORIO]) }).evaluar(P.lat, P.lon);
    expect(e.consultorio).toMatchObject({ estado: 'INFORMATIVO', nombre: 'CONSULTORIO DR. PEREZ', umbralM: null, fuenteElemento: 'RENIPRESS', codigo: '00004', categoria: 'I-1' });
    expect(e.consultorio.distanciaM).toBeCloseTo(120, 0);
    expect(e.consultorio.metodo).toMatch(/sin umbral|informativ/i);
    expect(e.consultorio.fecha).toBe('2026-10-30');
  });
  it('la salud se evalúa SOLO con los establecimientos: un consultorio más cercano no la hace cumplir', async () => {
    const e = await cargarEquipamiento({ salud: archivo([POSTA]), consultorios: archivo([CONSULTORIO]) }).evaluar(P.lat, P.lon);
    expect(e.salud).toMatchObject({ estado: 'CUMPLE', nombre: 'POSTA LEJANA', umbralM: 1000 });
    const lejos = punto(alNorte(2500), { fuente: 'RENIPRESS', nombre: 'HOSPITAL LEJANO', codigo_renipress: '00000010', categoria: 'II-1' });
    const e2 = await cargarEquipamiento({ salud: archivo([lejos]), consultorios: archivo([CONSULTORIO]) }).evaluar(P.lat, P.lon);
    expect(e2.salud).toMatchObject({ estado: 'NO CUMPLE', nombre: 'HOSPITAL LEJANO' }); // el consultorio a 120 m no cuenta
    expect(e2.consultorio.estado).toBe('INFORMATIVO');
  });
  it('un consultorio lejísimos sigue siendo informativo: nunca «no cumple»', async () => {
    const lejos = punto(alNorte(30000), { fuente: 'RENIPRESS', nombre: 'CONSULTORIO REMOTO', codigo_renipress: '5', categoria: 'I-1' });
    const e = await cargarEquipamiento({ salud: archivo([POSTA]), consultorios: archivo([lejos]) }).evaluar(P.lat, P.lon);
    expect(e.consultorio.estado).toBe('INFORMATIVO');
  });
  it('si falta el archivo de consultorios dice SIN DATO, no consulta nada en vivo y no afecta a la salud', async () => {
    const e = await cargarEquipamiento({ salud: archivo([POSTA]) }).evaluar(P.lat, P.lon);
    expect(e.consultorio).toMatchObject({ estado: 'SIN DATO', distanciaM: null, umbralM: null });
    expect(e.salud.estado).toBe('CUMPLE');
  });
});

describe('Equipamiento.datosCongelados: los consultorios no son necesarios para buscar zonas', () => {
  it('con los cuatro archivos de siempre devuelve datos aunque falte el de consultorios, y no incluye consultorios', async () => {
    const d = await cargarEquipamiento({ salud: archivo([POSTA]) }).datosCongelados();
    expect(Object.keys(d).sort()).toEqual(['areasVerdes', 'educacion', 'salud', 'transporte']);
  });
  it('consultorios() los lee aparte y devuelve null si faltan', async () => {
    expect(await cargarEquipamiento({ salud: archivo([POSTA]) }).consultorios()).toBeNull();
    const c = await cargarEquipamiento({ salud: archivo([POSTA]), consultorios: archivo([CONSULTORIO]) }).consultorios();
    expect(c.features).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------ Mapa y conteo

const UMBRALES = { salud: 1000, consultorio: null, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
const DISTRITO = [[[[-71.55, -16.42], [-71.53, -16.42], [-71.53, -16.40], [-71.55, -16.40], [-71.55, -16.42]]]];
const en = (i: number) => [-71.54, -16.41 + i * 0.0002];
const C1 = punto(en(0), { fuente: 'RENIPRESS', nombre: 'CONSULTORIO A', codigo_renipress: '00004', categoria: 'I-1' });
const C2 = punto(en(1), { fuente: 'OSM', osm: 'node/9', nombre: 'Dr. Lejano', tags: { amenity: 'doctors' } });
const S1 = punto(en(2), { fuente: 'RENIPRESS', nombre: 'POLICLINICO X', codigo_renipress: '00001231', categoria: 'I-3' });
const datos = Asistente.prepararDatos({ salud: [S1], consultorios: [C1, C2], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);

describe('Asistente.prepararDatos: los consultorios van aparte de la salud', () => {
  it('datos.consultorios trae los consultorios con su fuente y datos.salud solo los establecimientos', () => {
    expect(datos.salud.map((p: { nombre: string }) => p.nombre)).toEqual(['POLICLINICO X']);
    expect(datos.consultorios.map((p: { nombre: string }) => p.nombre)).toEqual(['CONSULTORIO A', 'Dr. Lejano']);
    expect(datos.consultorios[0]).toMatchObject({ fuente: 'RENIPRESS', codigo: '00004' });
  });
  it('sin consultorios en la entrada, la lista está vacía', () => {
    expect(Asistente.prepararDatos({ salud: [S1], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES).consultorios).toEqual([]);
  });
});

describe('Capas: el consultorio es su propia capa, sin círculo de distancia', () => {
  it('está entre las capas de servicio con su etiqueta', () => {
    expect(Capas.CAPAS.find((c: { id: string }) => c.id === 'consultorios')).toMatchObject({ etiqueta: 'Consultorios médicos', grupo: 'servicio' });
  });
  it('dibuja los consultorios con su fuente y sin radio ni círculo; la capa de salud no los trae', () => {
    const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UMBRALES, area: { polys: DISTRITO } };
    const c = Capas.construir({ ...base, capas: [{ id: 'consultorios' }] });
    expect(c.puntos.map((p: { nombre: string }) => p.nombre)).toEqual(['CONSULTORIO A', 'Dr. Lejano']);
    expect(c.puntos[0]).toMatchObject({ capa: 'consultorios', tipo: 'consultorio', detalle: 'Consultorio médico', fuenteTexto: 'RENIPRESS (SUSALUD) · código 00004 · categoría I-1' });
    expect(c.puntos.every((p: { radioM?: number }) => p.radioM === undefined)).toBe(true);
    expect(c.circulos).toEqual([]);
    expect(c.leyenda[0].texto).toMatch(/Consultorios médicos: 2/);
    const s = Capas.construir({ ...base, capas: [{ id: 'salud' }] });
    expect(s.puntos.map((p: { nombre: string }) => p.nombre)).toEqual(['POLICLINICO X']);
  });
  it('una búsqueda del asistente no genera la capa de consultorios', () => {
    expect(Capas.deCriterios([{ id: 'salud', umbralEfectivoM: 1000 }]).map((c: { id: string }) => c.id)).toEqual(['salud']);
  });
});

describe('Entidades.contarConsultorios', () => {
  it('cuenta los consultorios del distrito por fuente, aparte de la salud', () => {
    const r = Entidades.contarConsultorios(datos, DISTRITO);
    expect(r).toMatchObject({ total: 2, fuentes: { RENIPRESS: 1, OSM: 1 } });
    expect(Entidades.contar(datos, DISTRITO).salud.total).toBe(1);
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: el consultorio no es «salud cerca»', () => {
  const ids = (t: string, ctx = {}) => Asistente.interpretar(t, ctx).criterios.map((c: { id: string }) => c.id);

  it('«consultorio» y «médico» ya no son el criterio de salud', () => {
    expect(ids('busco una zona con consultorio')).not.toContain('salud');
    expect(ids('busco cerca de un médico')).not.toContain('salud');
    expect(ids('busco cerca de un doctor')).not.toContain('salud');
  });
  it('posta, hospital, clínica, centro de salud y centro médico siguen siendo salud', () => {
    for (const t of ['una posta', 'un hospital', 'una clínica', 'un centro de salud', 'un centro médico']) {
      expect(ids(`busco cerca de ${t}`)).toEqual(['salud']);
    }
  });
  it('«¿hay un consultorio cerca?» con un punto es una pregunta de consultorio, no de servicio', () => {
    const i = Asistente.interpretar('¿hay un consultorio cerca de mi punto?', { hayPunto: true });
    expect(i).toMatchObject({ tipo: 'consultorio', criterios: [], consultorio: true });
  });
  it('«¿cuántos consultorios hay en Cayma?» cuenta consultorios del distrito', () => {
    const i = Asistente.interpretar('¿cuántos consultorios hay en Cayma?');
    expect(i).toMatchObject({ tipo: 'consultorio', distrito: 'CAYMA', criterios: [] });
  });
  it('una búsqueda que mezcla posta y consultorio busca solo por la posta y avisa del consultorio', () => {
    const i = Asistente.interpretar('busco una zona cerca de una posta y un consultorio');
    expect(i.tipo).toBe('buscar');
    expect(i.criterios.map((c: { id: string }) => c.id)).toEqual(['salud']);
    expect(i.consultorio).toBe(true);
    expect(Asistente.interpretar('busco una zona cerca de una posta').consultorio).toBe(false);
  });
  it('buscar zonas solo por consultorio no se puede: lo dice, sin inventar un criterio', () => {
    const i = Asistente.interpretar('busco una zona cerca de un consultorio');
    expect(i.tipo).toBe('no_soportado');
    expect(i.temaNoSoportado).toBe('consultorio_busqueda');
    const r = Asistente.responder(i, {});
    expect(r.texto).toMatch(/informativ/i);
    expect(r.texto).not.toMatch(/cumple/i);
  });
  it('mencionaConsultorio detecta las palabras de consultorio (para no mandar la frase al modelo)', () => {
    expect(Asistente.mencionaConsultorio('¿Hay un Consultorio médico cerca?')).toBe(true);
    expect(Asistente.mencionaConsultorio('doctores en Cayma')).toBe(true);
    expect(Asistente.mencionaConsultorio('busco una posta')).toBe(false);
    expect(Asistente.mencionaConsultorio('un centro médico')).toBe(false);
  });

  const entorno = {
    salud: { estado: 'NO CUMPLE', nombre: 'HOSPITAL LEJANO', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS', codigo: '00000010', categoria: 'II-1' },
    consultorio: { estado: 'INFORMATIVO', nombre: 'CONSULTORIO DR. PEREZ', distanciaM: 120, umbralM: null, fuenteElemento: 'RENIPRESS', codigo: '00004', categoria: 'I-1' },
    educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
    transporte: { estado: 'CUMPLE', nombre: 'Paradero', distanciaM: 100, umbralM: 400 },
    areaVerde: { estado: 'CUMPLE', nombre: 'Parque', distanciaM: 100, umbralM: 300 },
  };
  const ctx = { punto: { lat: -16.4, lon: -71.5 }, zona: null, entorno, estadoPDM: null };

  it('la respuesta del punto da el consultorio más cercano, su distancia y su fuente, sin cumple / no cumple', () => {
    const t = Asistente.responder({ tipo: 'consultorio', criterios: [], consultorio: true }, ctx).texto;
    expect(t).toContain('CONSULTORIO DR. PEREZ');
    expect(t).toContain('120 m');
    expect(t).toContain('RENIPRESS (SUSALUD) · código 00004 · categoría I-1');
    expect(t).toMatch(/informativ/i);
    expect(t).not.toMatch(/cumple|referencia \d/i);
    expect(t).toMatch(/no cuenta como/i); // no cuenta como establecimiento de salud
  });
  it('sin punto pide elegir uno o preguntar por un distrito', () => {
    expect(Asistente.responder({ tipo: 'consultorio', criterios: [], consultorio: true }, {}).texto).toMatch(/punto|distrito/);
  });
  it('sin dato lo dice sin inventar', () => {
    const t = Asistente.responder({ tipo: 'consultorio', criterios: [], consultorio: true }, { ...ctx, entorno: { ...entorno, consultorio: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: null } } }).texto;
    expect(t).toMatch(/sin dato|no tengo/i);
  });
  it('el conteo de un distrito da el total por fuente y avisa que no es salud', () => {
    const r = Asistente.responder({ tipo: 'consultorio', distrito: 'CAYMA', criterios: [], consultorio: true }, { distritoTitulo: 'Cayma', fecha: '2026-10-30', consultorios: { total: 12, fuentes: { RENIPRESS: 10, OSM: 2 }, lista: [] } });
    expect(r.texto).toContain('12 consultorios médicos');
    expect(r.texto).toContain('RENIPRESS');
    expect(r.texto).toMatch(/informativ/i);
    expect(r.mapa).toMatchObject({ distrito: 'CAYMA', capas: ['consultorios'] });
  });
  it('«¿hay una posta cerca?» solo habla de salud: no menciona al consultorio ni lo suma', () => {
    const t = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'salud' }] }, ctx).texto;
    expect(t).toContain('HOSPITAL LEJANO');
    expect(t).toMatch(/no cumple/i);
    expect(t).not.toContain('CONSULTORIO');
  });
  it('el resumen del punto trae el consultorio como una línea informativa aparte de la salud', () => {
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, ctx).texto;
    expect(t).toMatch(/Salud: .*HOSPITAL LEJANO/);
    expect(t).toMatch(/Consultorio médico \(informativo\): CONSULTORIO DR\. PEREZ a 120 m/);
  });
  it('la nota de una búsqueda con consultorio dice que no entra y que no es salud', () => {
    expect(Asistente.notaConsultorio()).toMatch(/consultorio/i);
    expect(Asistente.notaConsultorio()).toMatch(/no entra|no entran/i);
  });
  it('«fuentes» y la explicación de los servicios mencionan al consultorio como informativo', () => {
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/consultorio/i);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: el consultorio es una sección informativa aparte de Salud', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD) (fuente primaria) y OpenStreetMap (ODbL, respaldo)', metodo: 'Distancia en línea recta.', ...extra });
  const d = (consultorio?: object) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UMBRALES,
    fuentesUmbral: { salud: 'x', consultorio: CONFIG.fuentesUmbral.consultorio, educacion: 'x', transporte: 'x', areaVerde: 'x' },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({ fuenteElemento: 'RENIPRESS', codigo: '00000009', categoria: 'I-2' }),
      ...(consultorio ? { consultorio } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  const consultorio = servicio({ estado: 'INFORMATIVO', nombre: 'CONSULTORIO DR. PEREZ', distanciaM: 120, umbralM: null, fuenteElemento: 'RENIPRESS', codigo: '00004', categoria: 'I-1', metodo: 'Distancia en línea recta hasta el consultorio médico más cercano.' });
  const seccion = (datos: object, t: string) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => s.titulo.includes(t));

  it('hay una sección «Consultorio médico (informativo)» con el nombre, la distancia, la fuente y el estado INFORMATIVO', () => {
    const s = seccion(d(consultorio), 'Consultorio');
    expect(s.titulo).toMatch(/informativo/i);
    expect(s.cuerpo).toContain('CONSULTORIO DR. PEREZ');
    expect(s.cuerpo).toContain('120 m');
    expect(s.cuerpo).toContain('RENIPRESS (SUSALUD) · código 00004 · categoría I-1');
    expect(s.cuerpo).toContain('INFORMATIVO');
    expect(s.cuerpo).not.toMatch(/Umbral/);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE/);
  });
  it('la sección de Salud no menciona al consultorio', () => {
    expect(seccion(d(consultorio), 'Salud').cuerpo).not.toContain('CONSULTORIO DR. PEREZ');
  });
  it('sin consultorio en las variables, el informe no cambia', () => {
    expect(seccion(d(), 'Consultorio')).toBeUndefined();
  });
  it('las limitaciones dicen que el consultorio es informativo y su umbral sigue pendiente', () => {
    expect(Reporte.limites(d(consultorio)).join(' ')).toMatch(/consultorio[^.]*informativ/i);
  });
});
