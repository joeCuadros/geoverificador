/**
 * Agua en el punto: el punto de acopio de agua potable más cercano (directorio de SEDAPAR publicado en 2024 con datos de 2017), las interrupciones del servicio de agua de
 * SEDAPAR en el distrito (SUNASS, 2019-2024) y la lista de lo que debe pedir quien compra. Todo INFORMATIVO (sin umbral). Aquí: el cálculo (Calculos), la ficha
 * (Equipamiento), el mapa (Capas), el chat (Asistente), el informe (Reporte) y los archivos reales. Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { existsSync, readFileSync } from 'node:fs';
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
const alNorte = (m: number) => [P.lon, P.lat + m / M_POR_GRADO_LAT];
const acopio = (m: number, direccion: string, distrito = 'CAYMA', extra: object = {}) => ({
  type: 'Feature', properties: { distrito, codigo: null, pagina_pdf: 4, direccion, utm_norte: 8186000, utm_este: 230000, ...extra }, geometry: { type: 'Point', coordinates: alNorte(m) },
});
const A1 = acopio(120, 'AVENIDA 1 DE MAYO, FRENTE A PARQUE.');
const A2 = acopio(800, 'CALLE LOS ARCES, FRENTE A MZ.A');
const A3 = acopio(2500, 'PLAZA PRINCIPAL', 'SABANDIA');
const META = { fuente: 'SEDAPAR con la Municipalidad Provincial de Arequipa', fecha: '2024-02-16', fechaDatos: 'abril a junio de 2017', metodo: 'm' };
const PROHIBIDO = /\b(tu predio|tu lote|tu terreno) (tiene|no tiene|cuenta|está conectado|no está conectado)\b|hay agua en tu|tienes agua|no tienes agua|garantiza que (hay|tendr)|seguro|inseguro|recomend\w+|mejor zona/i;

const INT = {
  metadata: {
    fuente: 'SUNASS, Registro de interrupciones', fecha_descarga: '2026-11-11', licencia: 'ODC-By', periodo: { desde: '2019-10-03', hasta: '2024-04-26' },
    anios_completos: [2020, 2021, 2022, 2023], anios_parciales: [2019, 2024],
  },
  distritos: {
    'CERRO COLORADO': {
      total: { n: 731, horas: 3302.08, horas_mediana: 3, imprevistas: 660, programadas: 71 },
      por_anio: { 2019: { n: 40, horas: 260.5 }, 2020: { n: 169, horas: 473.67 }, 2021: { n: 174, horas: 805.5 }, 2022: { n: 149, horas: 635.33 }, 2023: { n: 157, horas: 833 }, 2024: { n: 42, horas: 294.08 } },
    },
  },
};

// ------------------------------------------------------------------------------ Configuración

describe('CONFIG: el acopio y las interrupciones no tienen umbral', () => {
  it('umbral null, fuente de umbral y archivo de datos', () => {
    for (const k of ['acopio', 'interrupciones']) {
      expect(CONFIG.umbrales[k]).toBeNull();
      expect(CONFIG.fuentesUmbral[k]).toMatch(/sin umbral/i);
    }
    expect(CONFIG.equipamiento.archivos.acopio).toBe('data/agua/puntos_acopio.geojson');
    expect(CONFIG.equipamiento.archivos.interrupciones).toBe('data/agua/interrupciones_sedapar.json');
  });
});

// ------------------------------------------------------------------------------ Acopio

describe('Calculos.evaluarAcopio: el punto de acopio más cercano', () => {
  const r = Calculos.evaluarAcopio(P, [A3, A2, A1], META);
  it('el más cercano, su distancia en línea recta, cuántos hay a 500 m y a 1 km, y la fecha de publicación y la de los datos; INFORMATIVO, sin umbral', () => {
    expect(r).toMatchObject({ estado: 'INFORMATIVO', direccion: 'AVENIDA 1 DE MAYO, FRENTE A PARQUE.', distrito: 'CAYMA', umbralM: null, a500m: 1, a1000m: 2, total: 3, fecha: '2024-02-16', fechaDatos: 'abril a junio de 2017' });
    expect(r.distanciaM).toBeGreaterThan(115);
    expect(r.distanciaM).toBeLessThan(125);
    expect(r.lat).toBeCloseTo(alNorte(120)[1], 6);
  });
  it('sin puntos válidos es SIN DATO y no inventa una distancia', () => {
    for (const l of [[], null, [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }]]) {
      expect(Calculos.evaluarAcopio(P, l, META)).toMatchObject({ estado: 'SIN DATO', distanciaM: null, direccion: null, total: 0 });
    }
  });
  it('el texto dice que es un lugar de reparto con camiones cisterna ante un desabastecimiento, que el directorio se publicó en 2024 con datos de 2017 y qué NO es', () => {
    const t = Calculos.textoAcopio(r);
    expect(t).toMatch(/AVENIDA 1 DE MAYO/);
    expect(t).toMatch(/1\d\d m/);
    expect(t).toMatch(/camiones cisterna/);
    expect(t).toMatch(/16 de febrero de 2024/);
    expect(t).toMatch(/abril a junio de 2017/);
    expect(t).toMatch(/no es (una|la) (conexión|red)|no dice/i);
    expect(t).not.toMatch(PROHIBIDO);
    expect(Calculos.textoAcopio(Calculos.evaluarAcopio(P, [], META))).toMatch(/sin dato/i);
  });
  it('la nota informa del origen, de la edad de los datos y de lo que no dice', () => {
    expect(Calculos.NOTA_ACOPIO).toMatch(/2017/);
    expect(Calculos.NOTA_ACOPIO).toMatch(/no dice/i);
    expect(Calculos.NOTA_ACOPIO).toMatch(/informativo/i);
    expect(Calculos.NOTA_ACOPIO).not.toMatch(PROHIBIDO);
  });
});

// ------------------------------------------------------------------------------ Interrupciones

describe('Calculos.resumirInterrupciones: las interrupciones de agua de SEDAPAR en el distrito', () => {
  it('promedio por año completo (2020-2023), total del periodo y los años parciales aparte; INFORMATIVO', () => {
    const r = Calculos.resumirInterrupciones('Cerro Colorado', INT);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', distrito: 'CERRO COLORADO', registros: true, promedioN: 162, promedioHoras: 687, aniosCompletos: [2020, 2021, 2022, 2023], umbralM: null });
    expect(r.total).toMatchObject({ n: 731, horas: 3302.08 });
    expect(r.periodo).toEqual({ desde: '2019-10-03', hasta: '2024-04-26' });
    expect(r.parciales.map((p: any) => p.anio)).toEqual([2019, 2024]);
    expect(r.porAnio[2020]).toEqual({ n: 169, horas: 473.67 });
  });
  it('el distrito se busca sin importar tildes ni mayúsculas', () => {
    expect(Calculos.resumirInterrupciones('cerro colorado', INT).registros).toBe(true);
    expect(Calculos.resumirInterrupciones('  CERRO COLORADO ', INT).registros).toBe(true);
  });
  it('un distrito que no figura en el archivo no es «cero interrupciones»: se dice que no hay registros', () => {
    const r = Calculos.resumirInterrupciones('Sabandía', INT);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', registros: false, promedioN: null });
    expect(Calculos.textoInterrupciones(r)).toMatch(/no hay (registros|interrupciones)/i);
    expect(Calculos.textoInterrupciones(r)).toMatch(/no (garantiza|significa)/i);
  });
  it('sin archivo o sin distrito es SIN DATO', () => {
    expect(Calculos.resumirInterrupciones('Cayma', null)).toMatchObject({ estado: 'SIN DATO', registros: null });
    expect(Calculos.resumirInterrupciones(null, INT)).toMatchObject({ estado: 'SIN DATO', registros: null });
    expect(Calculos.textoInterrupciones(Calculos.resumirInterrupciones('Cayma', null))).toMatch(/sin dato/i);
  });
  it('el texto da el promedio y las horas por año completo, el periodo, el total y lo que no dice, sin comparar distritos ni decir que el predio tuvo cortes', () => {
    const t = Calculos.textoInterrupciones(Calculos.resumirInterrupciones('Cerro Colorado', INT));
    expect(t).toMatch(/CERRO COLORADO|Cerro Colorado/);
    expect(t).toMatch(/162/);
    expect(t).toMatch(/687 horas/);
    expect(t).toMatch(/2020 a 2023/);
    expect(t).toMatch(/octubre de 2019/);
    expect(t).toMatch(/abril de 2024/);
    expect(t).toMatch(/731/);
    expect(t).toMatch(/reportad/i);
    expect(t).toMatch(/no dice/i);
    expect(t).not.toMatch(PROHIBIDO);
    expect(t).not.toMatch(/peor|mejor|más seguro|ranking/i);
  });
  it('la nota explica cómo se cuentan las horas', () => {
    expect(Calculos.NOTA_INTERRUPCIONES).toMatch(/una vez/i);
    expect(Calculos.NOTA_INTERRUPCIONES).toMatch(/no se multiplican|sin multiplicar/i);
    expect(Calculos.NOTA_INTERRUPCIONES).toMatch(/informativo/i);
  });
});

// ------------------------------------------------------------------------------ Lista para quien compra

describe('Calculos.LISTA_COMPRADOR: qué pedir y qué no se sabe', () => {
  const lista = Calculos.LISTA_COMPRADOR as { id: string; texto: string }[];
  const todo = lista.map((x) => x.texto).join('\n');
  it('pide el último recibo de SEDAPAR y de SEAL con el número de suministro', () => {
    expect(todo).toMatch(/último recibo de agua de SEDAPAR/);
    expect(todo).toMatch(/de luz de SEAL/);
    expect(todo).toMatch(/número de suministro/);
  });
  it('para un terreno sin conexión nombra el trámite verificado en gob.pe de SEDAPAR, con su enlace, y dice que no otorga la propiedad ni la zonificación', () => {
    expect(todo).toMatch(/Solicitar certificado de factibilidad para servicio de agua potable y alcantarillado/);
    expect(todo).toContain('https://www.gob.pe/institucion/sedapar/pages/65539-servicio-de-agua-potable-y-alcantarillado-de-arequipa-solicitar-certificado-de-factibilidad-para-servicio-de-agua-potable-y-alcantarillado');
    expect(todo).toMatch(/no otorga/i);
  });
  it('dice que los datos de conexión de un predio no son públicos y cita la ley con su número y su título', () => {
    expect(todo).toMatch(/no están publicados/i);
    expect(todo).toMatch(/Ley N\.° 29733, Ley de Protección de Datos Personales/);
  });
  it('no promete ni afirma nada sobre el predio', () => {
    expect(todo).not.toMatch(PROHIBIDO);
    expect(lista.length).toBe(3);
    expect(new Set(lista.map((x) => x.id)).size).toBe(3);
  });
});

// ------------------------------------------------------------------------------ Ficha

const archivoAcopio = { type: 'FeatureCollection', metadata: { fuente: META.fuente, fecha_publicacion: '2024-02-16', periodo_de_los_datos: 'abril a junio de 2017' }, features: [A1, A2, A3] };
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

describe('Equipamiento: acopio e interrupciones', () => {
  it('evaluar da el punto de acopio más cercano con la fuente, la fecha de publicación y la de los datos', async () => {
    const e = await cargarEquipamiento({ acopio: archivoAcopio }).evaluar(P.lat, P.lon);
    expect(e.acopio).toMatchObject({ estado: 'INFORMATIVO', direccion: 'AVENIDA 1 DE MAYO, FRENTE A PARQUE.', umbralM: null, fecha: '2024-02-16', total: 3 });
    expect(e.acopio.fechaDatos).toMatch(/2017/);
    expect(e.acopio.metodo).toMatch(/sin umbral/i);
  });
  it('sin el archivo el acopio dice SIN DATO y no afecta a lo demás', async () => {
    const e = await cargarEquipamiento({}).evaluar(P.lat, P.lon);
    expect(e.acopio).toMatchObject({ estado: 'SIN DATO', distanciaM: null });
    expect(e.salud.estado).toBe('SIN DATO');
  });
  it('interrupcionesDe lee el archivo una vez y resume el distrito; sin archivo, SIN DATO', async () => {
    const Eq = cargarEquipamiento({ interrupciones: INT });
    expect(await Eq.interrupcionesDe('Cerro Colorado')).toMatchObject({ estado: 'INFORMATIVO', promedioN: 162 });
    const Sin = cargarEquipamiento({});
    expect(await Sin.interrupcionesDe('Cerro Colorado')).toMatchObject({ estado: 'SIN DATO', registros: null });
  });
});

// ------------------------------------------------------------------------------ Mapa

describe('Capas: puntos de acopio de agua como capa informativa', () => {
  const UM = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UM);
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UM, area: null };
  it('tiene su etiqueta con la edad de los datos; cada punto con su dirección; sin círculo', () => {
    expect(Capas.CAPAS.find((c: { id: string }) => c.id === 'acopio_agua')).toMatchObject({ etiqueta: expect.stringMatching(/Puntos de acopio de agua.*2017/) });
    const c = Capas.construir({ ...base, capas: [{ id: 'acopio_agua' }], acopio: [A1, A2, A3] });
    expect(c.puntos).toHaveLength(3);
    const p = c.puntos.find((x: { titulo: string }) => /1 DE MAYO/.test(x.titulo));
    expect(p).toMatchObject({ capa: 'acopio_agua', tipo: 'acopio' });
    expect(p.detalle).toMatch(/CAYMA/);
    expect(p.detalle).toMatch(/2017/);
    expect(p.circulo).toBeUndefined();
    expect(c.leyenda.map((l: { texto: string }) => l.texto)).toEqual(['Puntos de acopio de agua (SEDAPAR, datos de 2017): 3']);
  });
  it('sin el archivo lo dice y no dibuja nada', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'acopio_agua' }], acopio: null });
    expect(c.puntos).toEqual([]);
    expect(c.sinDatos).toContain('acopio_agua');
  });
  it('no es un criterio de búsqueda', () => {
    expect(Asistente.CRITERIOS.acopio).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: agua, acopio, interrupciones y qué pedir al comprar', () => {
  const caso = (t: string) => expect(Asistente.interpretar(t, { hayPunto: true })).toMatchObject({ tipo: 'agua', criterios: [] });
  it('las preguntas por el punto de acopio, los cortes y la compra son la intención «agua»', () => {
    caso('¿dónde está el punto de acopio de agua más cercano?');
    caso('¿hay un camión cisterna que reparta agua cerca?');
    caso('¿se corta mucho el agua en mi distrito?');
    caso('¿cuántas interrupciones del servicio de agua hubo?');
    caso('¿qué debo pedir al vendedor para saber si el terreno tiene agua y luz?');
    caso('¿cómo pido la factibilidad de agua para un terreno?');
  });
  it('pedir zonas «con agua» o «sin cortes» sigue sin poderse', () => {
    expect(Asistente.interpretar('busco zonas donde no se corte el agua')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'agua_busqueda' });
  });
  it('mencionaAgua detecta las palabras nuevas', () => {
    for (const t of ['punto de acopio', 'camión cisterna', 'factibilidad de agua', 'cortes de agua', 'interrupciones del servicio de agua']) expect(Asistente.mencionaAgua(t)).toBe(true);
  });

  const acop = Calculos.evaluarAcopio(P, [A1, A2, A3], META);
  const ints = Calculos.resumirInterrupciones('Cerro Colorado', INT);
  const censo = { estado: 'INFORMATIVO', tieneCifras: false, anio: 2017, motivo: 'fuera_de_manzanas' };
  const ctx = { punto: { lat: P.lat, lon: P.lon }, zona: null, estadoPDM: null, entorno: { censo, acopio: acop }, interrupciones: ints, distrito: 'CERRO COLORADO' };
  it('responde con el punto de acopio (y la edad de sus datos), las interrupciones del distrito y la lista de lo que hay que pedir, sin afirmar nada del predio', () => {
    const t = Asistente.responder({ tipo: 'agua', criterios: [] }, ctx).texto;
    expect(t).toMatch(/AVENIDA 1 DE MAYO/);
    expect(t).toMatch(/2017/);
    expect(t).toMatch(/162/);
    expect(t).toMatch(/último recibo de agua de SEDAPAR/);
    expect(t).toMatch(/Ley N\.° 29733/);
    expect(t).not.toMatch(PROHIBIDO);
    expect(t).not.toMatch(/cumple/i);
  });
  it('pide marcar en el mapa los puntos de acopio', () => {
    expect(Asistente.responder({ tipo: 'agua', criterios: [] }, ctx).mapa.capas).toContain('acopio_agua');
  });
  it('sin el dato de acopio ni de interrupciones lo dice, pero igual da la lista', () => {
    const t = Asistente.responder({ tipo: 'agua', criterios: [] }, { ...ctx, entorno: { censo, acopio: Calculos.evaluarAcopio(P, [], META) }, interrupciones: Calculos.resumirInterrupciones('Cayma', null) }).texto;
    expect(t).toMatch(/sin dato/i);
    expect(t).toMatch(/último recibo de agua de SEDAPAR/);
  });
  it('sin punto pide elegir uno pero da la lista, que no depende del punto', () => {
    const t = Asistente.responder({ tipo: 'agua', criterios: [] }, {}).texto;
    expect(t).toMatch(/punto/);
    expect(t).toMatch(/último recibo de agua de SEDAPAR/);
  });
  it('el resumen del punto trae la línea del acopio y «fuentes» menciona SEDAPAR y la SUNASS', () => {
    const e: any = {
      acopio: acop, censo,
      salud: { estado: 'NO CUMPLE', nombre: 'H', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS' },
      educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
      transporte: { estado: 'CUMPLE', nombre: 'P', distanciaM: 100, umbralM: 400 },
      areaVerde: { estado: 'CUMPLE', nombre: 'Q', distanciaM: 100, umbralM: 300 },
    };
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, { ...ctx, entorno: e }).texto;
    expect(t).toMatch(/Agua \(informativo\): punto de acopio más cercano, a \d+ m/);
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/SEDAPAR/);
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/SUNASS/);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: agua es una sección informativa', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD)', metodo: 'Distancia en línea recta.', ...extra });
  const d = (con: boolean) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: UM_REPORTE(), fuentesUmbral: { ...CONFIG.fuentesUmbral },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({}),
      ...(con ? { acopio: Calculos.evaluarAcopio(P, [A1, A2, A3], META), interrupciones: Calculos.resumirInterrupciones('Cerro Colorado', INT) } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  function UM_REPORTE() { return { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } }; }
  const seccion = (datos: object) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => /Agua/.test(s.titulo));
  it('trae el punto de acopio, la edad de sus datos, las interrupciones, la fuente y la lista de lo que hay que pedir', () => {
    const s = seccion(d(true));
    expect(s.titulo).toMatch(/informativo/i);
    for (const t of ['AVENIDA 1 DE MAYO', '2017', '162', 'INFORMATIVO', 'último recibo de agua de SEDAPAR']) expect(s.cuerpo).toContain(t);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE|Umbral/);
    expect(s.fuente).toMatch(/SEDAPAR/);
    expect(s.fuente).toMatch(/SUNASS/);
  });
  it('sin acopio ni interrupciones el informe no cambia; las limitaciones dicen que los datos son de 2017 y reportados', () => {
    expect(seccion(d(false))).toBeUndefined();
    const l = Reporte.limites(d(true)).join(' ');
    expect(l).toMatch(/puntos de acopio.{0,200}2017/i);
    expect(l).toMatch(/reportad/i);
  });
});

// ------------------------------------------------------------------------------ Archivos reales

const rutaAcopio = join(__dirname, '..', 'public', 'data', 'agua', 'puntos_acopio.geojson');
const rutaInt = join(__dirname, '..', 'public', 'data', 'agua', 'interrupciones_sedapar.json');
(existsSync(rutaAcopio) && existsSync(rutaInt) ? describe : describe.skip)('archivos reales de agua', () => {
  const ac = existsSync(rutaAcopio) ? JSON.parse(readFileSync(rutaAcopio, 'utf8')) : { features: [] };
  const it2 = existsSync(rutaInt) ? JSON.parse(readFileSync(rutaInt, 'utf8')) : { metadata: {}, distritos: {} };
  it('desde la Plaza de Armas hay un punto de acopio a menos de 1 km, y el texto lo dice con su edad', () => {
    const r = Calculos.evaluarAcopio({ lat: -16.3989, lon: -71.5369 }, ac.features, { ...META });
    expect(r.estado).toBe('INFORMATIVO');
    expect(r.distanciaM).toBeLessThan(1000);
    expect(Calculos.textoAcopio(r)).toMatch(/2017/);
  });
  it('el resumen de Cerro Colorado sale del archivo real: años completos 2020-2023 y más de 100 interrupciones al año', () => {
    const r = Calculos.resumirInterrupciones('Cerro Colorado', it2);
    expect(r.aniosCompletos).toEqual([2020, 2021, 2022, 2023]);
    expect(r.promedioN).toBeGreaterThan(100);
    expect(r.periodo.desde).toBe('2019-10-03');
  });
});
