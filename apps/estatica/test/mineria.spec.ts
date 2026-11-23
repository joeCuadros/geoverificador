/**
 * Concesiones mineras (Catastro Minero de INGEMMET): ¿el punto cae dentro de una concesión? INFORMATIVO. Una concesión minera es el derecho a explorar y explotar los
 * minerales dentro de su perímetro (art. 9 del TUO de la Ley General de Minería), un inmueble distinto y separado del predio: NO dice que haya minería ni de quién es el predio.
 * Aquí: el cálculo (Calculos), la ficha (Equipamiento), el mapa (Capas), el chat (Asistente), el informe (Reporte) y el archivo real. Sin red.
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
const cuadrado = (mNorte: number, mEste: number, lado: number, properties: object) => {
  const x0 = P.lon + dLon(mEste);
  const x1 = P.lon + dLon(mEste + lado);
  const y0 = P.lat + mNorte / M_POR_GRADO_LAT;
  const y1 = P.lat + (mNorte + lado) / M_POR_GRADO_LAT;
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
};
const props = (nombre: string, extra: object = {}) => ({
  codigo: '050000001', nombre, hectareas: 700, estado: 'TITULADO', estado_detalle: 'D.M. Titulado D.L. 708', sustancia: 'no metálica', explotacion_o_exploracion: null,
  distritos: ['YURA'], fecha_denuncio: '2022-06-02', actualizado: '2026-11-10', ...extra,
});
const TITULADA = cuadrado(-500, -500, 1000, props('CYM AGREGADOS')); // contiene el punto
const TRAMITE = cuadrado(-300, -300, 600, props('SAN JOSE 4', { codigo: '050000002', estado: 'EN TRÁMITE', estado_detalle: 'D.M. en Trámite D.L. 708', sustancia: 'metálica' }));
const EXTINGUIDA = cuadrado(-100, -100, 200, props('VIEJA', { codigo: '050000003', estado: 'EXTINGUIDO' }));
const LEJOS = cuadrado(3000, 3000, 1000, props('LEJANA', { codigo: '050000004' }));
const CERCA_TIT = cuadrado(0, 600, 500, props('VECINA', { codigo: '050000005' })); // a 600 m al este del punto
const META = { fuente: 'INGEMMET, Catastro Minero (GEOCATMIN)', fecha: '2026-11-10', metodo: 'm' };
const PROHIBIDO = /\b(tu predio|tu lote|tu terreno) (es|pertenece|no es|está en manos|puede|no puede)\b|hay (minería|una mina) en tu|no (puedes|se puede) construir|puedes construir/i;

describe('Calculos.evaluarMinera', () => {
  it('dentro de una concesión: la lista (las tituladas primero), cuántas de cada estado; INFORMATIVO, sin umbral', () => {
    const r = Calculos.evaluarMinera(P, [LEJOS, TRAMITE, TITULADA], META);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', dentro: true, distanciaM: 0, umbralM: null, tituladas: 1, enTramite: 1 });
    expect(r.concesiones.map((c: any) => c.nombre)).toEqual(['CYM AGREGADOS', 'SAN JOSE 4']);
    expect(r.concesiones[0]).toMatchObject({ codigo: '050000001', estado: 'TITULADO', sustancia: 'no metálica', hectareas: 700 });
  });
  it('una concesión extinguida no cuenta como dentro: se ignora', () => {
    const r = Calculos.evaluarMinera(P, [EXTINGUIDA], META);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', dentro: false, concesiones: [] });
  });
  it('fuera de toda concesión: la titulada o en trámite más cercana y la distancia a su BORDE', () => {
    const r = Calculos.evaluarMinera(P, [LEJOS, CERCA_TIT], META);
    expect(r).toMatchObject({ dentro: false, concesiones: [] });
    expect(r.cercana.nombre).toBe('VECINA');
    expect(r.distanciaM).toBeGreaterThan(590);
    expect(r.distanciaM).toBeLessThan(610);
  });
  it('sin polígonos válidos es SIN DATO y no inventa una distancia', () => {
    for (const l of [[], null, [{ type: 'Feature', properties: props('x'), geometry: { type: 'Point', coordinates: [P.lon, P.lat] } }]]) {
      expect(Calculos.evaluarMinera(P, l, META)).toMatchObject({ estado: 'SIN DATO', dentro: null, distanciaM: null, concesiones: [] });
    }
  });
});

describe('Calculos.textoMinera: derecho a explorar y explotar, no «minería en tu predio»', () => {
  const dentro = Calculos.evaluarMinera(P, [TITULADA, TRAMITE], META);
  const fuera = Calculos.evaluarMinera(P, [CERCA_TIT], META);
  it('dentro: dice cuántas, cuáles y de qué estado, y que es un derecho sobre los minerales, no sobre el predio', () => {
    const t = Calculos.textoMinera(dentro);
    expect(t).toMatch(/dentro de 2 concesiones mineras/);
    expect(t).toContain('CYM AGREGADOS');
    expect(t).toMatch(/titulada/);
    expect(t).toMatch(/en trámite/);
    expect(t).toMatch(/derecho a explorar y explotar/);
    expect(t).toMatch(/no dice/i);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('fuera: la más cercana y la distancia, sin garantizar que no haya otras', () => {
    const t = Calculos.textoMinera(fuera);
    expect(t).toMatch(/no cae dentro de ninguna concesión minera/);
    expect(t).toContain('VECINA');
    expect(t).toMatch(/\d+ m/);
    expect(t).toMatch(/referencial/);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('sin dato lo dice', () => {
    expect(Calculos.textoMinera(Calculos.evaluarMinera(P, [], META))).toMatch(/sin dato/i);
  });
  it('la nota cita lo que dice la Ley General de Minería (art. 9, inmueble separado, servidumbres a solicitud del titular) y lo que no', () => {
    const n = Calculos.NOTA_MINERA;
    expect(n).toMatch(/artículo 9/i);
    expect(n).toMatch(/inmueble distinto y separado/);
    expect(n).toMatch(/servidumbre/);
    expect(n).toMatch(/solicitar|pedir/);
    expect(n).toMatch(/no dice/i);
    expect(n).not.toMatch(PROHIBIDO);
  });
});

describe('CONFIG: la minería no tiene umbral', () => {
  it('umbral null, fuente de umbral y la ruta del archivo', () => {
    expect(CONFIG.umbrales.mineria).toBeNull();
    expect(CONFIG.fuentesUmbral.mineria).toMatch(/sin umbral/i);
    expect(CONFIG.equipamiento.archivos.mineria).toBe('data/mineria/concesiones_mineras.geojson');
  });
});

// ------------------------------------------------------------------------------ Ficha

const archivo = (features: object[]) => ({
  type: 'FeatureCollection',
  metadata: { fuente: 'INGEMMET, Catastro Minero (GEOCATMIN)', fecha_descarga: '2026-11-10' },
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

describe('Equipamiento.evaluar: minería', () => {
  it('lee el archivo congelado y dice si el punto cae en una concesión, con la fuente y la fecha', async () => {
    const e = await cargarEquipamiento({ mineria: archivo([TITULADA]) }).evaluar(P.lat, P.lon);
    expect(e.mineria).toMatchObject({ estado: 'INFORMATIVO', dentro: true, fecha: '2026-11-10', fuente: 'INGEMMET, Catastro Minero (GEOCATMIN)', umbralM: null });
    expect(e.mineria.metodo).toMatch(/sin umbral/i);
    expect(e.mineria.metodo).toMatch(/referencial/i);
  });
  it('sin el archivo dice SIN DATO y no afecta a lo demás', async () => {
    const e = await cargarEquipamiento({}).evaluar(P.lat, P.lon);
    expect(e.mineria).toMatchObject({ estado: 'SIN DATO', dentro: null });
    expect(e.salud.estado).toBe('SIN DATO');
  });
});

// ------------------------------------------------------------------------------ Sin efecto + mapa

const UM = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };

describe('la minería no es un criterio de búsqueda ni suma al puntaje', () => {
  it('no hay criterio de minería y «un parque cerca de una mina» busca solo por el parque', () => {
    expect(Asistente.CRITERIOS.mineria).toBeUndefined();
    expect(Asistente.interpretar('quiero un parque lejos de una concesión minera').criterios.map((c: { id: string }) => c.id)).toEqual(['areaVerde']);
  });
});

describe('Capas: concesiones mineras como capa de polígonos, coloreadas por estado', () => {
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UM);
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UM, area: null };
  it('tiene su etiqueta; cada polígono entero con su nombre, estado y hectáreas; leyenda por estado', () => {
    expect(Capas.CAPAS.find((c: { id: string }) => c.id === 'mineria')).toMatchObject({ etiqueta: 'Concesiones mineras (INGEMMET)' });
    const c = Capas.construir({ ...base, capas: [{ id: 'mineria' }], mineria: [TITULADA, TRAMITE, EXTINGUIDA] });
    const pol = c.poligonos.filter((p: { capa: string }) => p.capa === 'mineria');
    expect(pol).toHaveLength(2); // la extinguida no se dibuja
    const p = pol.find((x: { nombre: string }) => x.nombre === 'CYM AGREGADOS');
    expect(p).toMatchObject({ estado: 'TITULADO' });
    expect(p.detalle).toMatch(/titulada/);
    expect(p.detalle).toMatch(/700 ha/);
    expect(p.geometry).toBe(TITULADA.geometry);
    expect(c.leyenda.map((l: { texto: string }) => l.texto).sort()).toEqual(['Concesión en trámite: 1', 'Concesión titulada: 1']);
  });
  it('sin el archivo lo dice y no dibuja nada', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'mineria' }], mineria: null });
    expect(c.poligonos).toEqual([]);
    expect(c.sinDatos).toContain('mineria');
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: minería', () => {
  const ctxBase = { punto: { lat: P.lat, lon: P.lon }, zona: null, estadoPDM: null };
  const dentro = Calculos.evaluarMinera(P, [TITULADA], META);
  const fuera = Calculos.evaluarMinera(P, [CERCA_TIT], META);
  it('«¿hay una concesión minera en mi punto?», «minería», «mina» son una intención propia', () => {
    for (const t of ['¿hay una concesión minera en mi punto?', '¿mi terreno está en una concesión minera?', '¿hay minería cerca?', '¿hay una mina aquí?', 'concesiones mineras']) {
      expect(Asistente.interpretar(t, { hayPunto: true })).toMatchObject({ tipo: 'mineria', criterios: [] });
    }
  });
  it('buscar zonas «sin minería» no se puede y lo dice', () => {
    expect(Asistente.interpretar('busco una zona lejos de minas')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'mineria_busqueda' });
  });
  it('mencionaMineria detecta las palabras', () => {
    for (const t of ['concesión minera', 'minería', 'una mina', 'derechos mineros']) expect(Asistente.mencionaMineria(t)).toBe(true);
    expect(Asistente.mencionaMineria('busco una posta')).toBe(false);
  });
  it('dentro: la concesión, su estado, la fuente, la fecha y la salvedad', () => {
    const t = Asistente.responder({ tipo: 'mineria', criterios: [] }, { ...ctxBase, entorno: { mineria: dentro } }).texto;
    expect(t).toMatch(/dentro de 1 concesión minera/);
    expect(t).toMatch(/INGEMMET/);
    expect(t).toMatch(/2026-11-10/);
    expect(t).toMatch(/artículo 9/i);
    expect(t).not.toMatch(PROHIBIDO);
    expect(t).not.toMatch(/cumple/i);
  });
  it('fuera: la más cercana a tantos metros, sin garantizar', () => {
    const t = Asistente.responder({ tipo: 'mineria', criterios: [] }, { ...ctxBase, entorno: { mineria: fuera } }).texto;
    expect(t).toMatch(/no cae dentro de ninguna concesión minera/);
    expect(t).toMatch(/\d+ m/);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('sin punto pide elegir uno; sin dato lo dice', () => {
    expect(Asistente.responder({ tipo: 'mineria', criterios: [] }, {}).texto).toMatch(/punto/);
    expect(Asistente.responder({ tipo: 'mineria', criterios: [] }, { ...ctxBase, entorno: { mineria: Calculos.evaluarMinera(P, [], META) } }).texto).toMatch(/sin dato|no tengo/i);
  });
  it('el resumen del punto trae una línea informativa y «fuentes» menciona el catastro minero', () => {
    const e: any = {
      mineria: dentro,
      salud: { estado: 'NO CUMPLE', nombre: 'H', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS' },
      educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
      transporte: { estado: 'CUMPLE', nombre: 'P', distanciaM: 100, umbralM: 400 },
      areaVerde: { estado: 'CUMPLE', nombre: 'Q', distanciaM: 100, umbralM: 300 },
    };
    expect(Asistente.responder({ tipo: 'ficha', criterios: [] }, { ...ctxBase, entorno: e }).texto).toMatch(/Concesión minera \(informativo\): dentro de 1 concesión/);
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/Catastro Minero/);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: concesión minera es una sección informativa', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD)', metodo: 'Distancia en línea recta.', ...extra });
  const d = (con: boolean) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UM,
    fuentesUmbral: { ...CONFIG.fuentesUmbral },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({}),
      ...(con ? { mineria: Calculos.evaluarMinera(P, [TITULADA], META) } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  const seccion = (datos: object) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => s.titulo.includes('minera'));
  it('trae la concesión, su estado, el código, la fuente y la salvedad', () => {
    const s = seccion(d(true));
    expect(s.titulo).toMatch(/informativo/i);
    for (const t of ['CYM AGREGADOS', '050000001', 'TITULADO', 'INFORMATIVO']) expect(s.cuerpo).toContain(t);
    expect(s.cuerpo).toMatch(/no dice/i);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE|Umbral/);
    expect(s.fuente).toMatch(/INGEMMET/);
  });
  it('sin minería en las variables, el informe no cambia; las limitaciones dicen que es referencial', () => {
    expect(seccion(d(false))).toBeUndefined();
    expect(Reporte.limites(d(true)).join(' ')).toMatch(/concesi[oó]n minera[^.]*referencial|referencial[^.]*concesi[oó]n minera/i);
  });
});

// ------------------------------------------------------------------------------ Archivo real

describe('archivo real de concesiones mineras', () => {
  const fc = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'mineria', 'concesiones_mineras.geojson'), 'utf8'));
  it('trae la procedencia, el aviso del servicio y no trae el nombre del titular', () => {
    const m = fc.metadata;
    expect(m.fuente).toMatch(/INGEMMET/);
    expect(m.url_servicio).toMatch(/SERV_CATASTRO_MINERO\/MapServer\/0$/);
    expect(m.fecha_descarga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.aviso_del_servicio).toMatch(/referencial/);
    expect(JSON.stringify(fc.features[0].properties)).not.toMatch(/tit_conces|titular/i);
    expect(Object.keys(fc.features[0].properties)).not.toContain('TIT_CONCES');
  });
  it('la Plaza de Armas no cae en una concesión minera y hay concesiones tituladas en el archivo', () => {
    expect(Calculos.evaluarMinera({ lat: -16.3989, lon: -71.5369 }, fc.features, META).dentro).toBe(false);
    expect(fc.features.filter((f: any) => f.properties.estado === 'TITULADO').length).toBeGreaterThan(100);
  });
});
