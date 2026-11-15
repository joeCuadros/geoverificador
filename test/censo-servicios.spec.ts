/**
 * Servicios de la manzana según el censo (alumbrado, agua y desagüe por red pública; viviendas y personas): INFORMATIVOS. Cifras del Censo 2017 (INEI) de la
 * manzana, no de un predio ni de hoy; el censo de 2025 aún no está abierto por manzana. Aquí: el cálculo (Calculos), la carga por distrito (Equipamiento),
 * el mapa (Capas), el chat (Asistente), el informe (Reporte) y los archivos reales. Sin red: `fetch` devuelve los archivos de prueba.
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
const OPC = { anio: 2017, fuente: 'INEI, Censos Nacionales 2017', fecha: '2026-11-10', metodo: 'm' };
// Una manzana de 100 m con el punto adentro: 60 viviendas ocupadas, 57 con luz, 45 + 6 con agua de red, 40 + 8 con desagüe de red.
const M1 = cuadrado(-50, -50, 100, { id: '04010100100010', v: 70, h: 72, p: 250, o: 60, l: 57, ad: 45, af: 6, sd: 40, sf: 8 });
const M_POCAS = cuadrado(200, -50, 100, { id: '04010100100011', v: 4, h: 4, p: 11, o: 3, l: 3, ad: 1, af: 0, sd: 0, sf: 0 });
const M_VACIA = cuadrado(400, -50, 100, { id: '04010100100012' }); // el INEI la dibuja pero el censo no contó viviendas
const M_LEJOS = cuadrado(5000, 5000, 100, { id: '04010100100013', v: 10, h: 10, p: 30, o: 10, l: 10, ad: 10, af: 0, sd: 10, sf: 0 });
const PROHIBIDO = /\b(tu predio|tu lote|tu terreno|tu casa|esta casa) (tiene|cuenta con|dispone de)\b|\b(tienes|tiene) (luz|agua|desag)/i;

// ------------------------------------------------------------------------------ Cálculo

describe('Calculos.evaluarManzana', () => {
  it('dentro de una manzana con cifras: la manzana, el año y los porcentajes sobre las viviendas ocupadas; INFORMATIVO, sin umbral', () => {
    const r = Calculos.evaluarManzana(P, [M_LEJOS, M1], OPC);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', modo: 'dentro', distanciaM: 0, manzana: '04010100100010', anio: 2017, umbralM: null, tieneCifras: true, viviendas: 70, hogares: 72, personas: 250, ocupadas: 60, pocas: false });
    expect(r.luz).toEqual({ n: 57, pct: 95 });
    expect(r.agua).toEqual({ dentro: 45, fuera: 6, n: 51, pct: 85, pctDentro: 75 });
    expect(r.desague).toEqual({ dentro: 40, fuera: 8, n: 48, pct: 80, pctDentro: 66.7 });
    expect(r).toMatchObject({ fuente: OPC.fuente, fecha: '2026-11-10' });
  });
  it('en la calle: la manzana más cercana si su borde queda a 30 m o menos (con la distancia); más lejos, SIN DATO', () => {
    const cerca = Calculos.evaluarManzana({ lat: P.lat - 70 / M_POR_GRADO_LAT, lon: P.lon }, [M1], OPC); // 20 m al sur del borde sur (a -50 m)
    expect(cerca).toMatchObject({ estado: 'INFORMATIVO', modo: 'cercana', manzana: '04010100100010' });
    expect(cerca.distanciaM).toBeGreaterThan(18);
    expect(cerca.distanciaM).toBeLessThan(22);
    const lejos = Calculos.evaluarManzana({ lat: P.lat - 100 / M_POR_GRADO_LAT, lon: P.lon }, [M1], OPC); // 50 m
    expect(lejos).toMatchObject({ estado: 'SIN DATO', motivo: 'fuera_de_manzanas', manzana: null, distanciaM: null });
  });
  it('si dos manzanas están cerca gana la que contiene el punto, o la más cercana', () => {
    expect(Calculos.evaluarManzana(P, [M_POCAS, M1], OPC).manzana).toBe('04010100100010');
  });
  it('con menos de 5 viviendas ocupadas no da el porcentaje (señalaría a una vivienda), pero sí cuántas contó', () => {
    const r = Calculos.evaluarManzana({ lat: P.lat + 250 / M_POR_GRADO_LAT, lon: P.lon }, [M_POCAS], OPC);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', pocas: true, ocupadas: 3 });
    expect(r.luz.pct).toBeNull();
    expect(r.agua.pct).toBeNull();
    expect(r.desague.pct).toBeNull();
    expect(Calculos.evaluarManzana({ lat: P.lat + 250 / M_POR_GRADO_LAT, lon: P.lon }, [M_POCAS], { ...OPC, minViviendas: 2 }).luz.pct).toBe(100);
  });
  it('una manzana que el censo no contó es SIN DATO («manzana_sin_cifras»), no ceros', () => {
    const r = Calculos.evaluarManzana({ lat: P.lat + 450 / M_POR_GRADO_LAT, lon: P.lon }, [M_VACIA], OPC);
    expect(r).toMatchObject({ estado: 'SIN DATO', motivo: 'manzana_sin_cifras', manzana: '04010100100012', tieneCifras: false });
    expect(r.luz).toBeNull();
  });
  it('sin polígonos es SIN DATO con el motivo que se le da', () => {
    expect(Calculos.evaluarManzana(P, [], OPC)).toMatchObject({ estado: 'SIN DATO', motivo: 'sin_archivo' });
    expect(Calculos.evaluarManzana(P, null, { ...OPC, motivoVacio: 'fuera_de_manzanas' })).toMatchObject({ motivo: 'fuera_de_manzanas' });
  });
});

describe('Calculos.textoCenso: cifras de la manzana y del año, nunca «tu predio tiene»', () => {
  const r = Calculos.evaluarManzana(P, [M1], OPC);
  it('dice la manzana, el año, las viviendas y los tres porcentajes, y que no son de tu predio ni de hoy', () => {
    const t = Calculos.textoCenso(r);
    expect(t).toMatch(/En la manzana de tu punto/);
    expect(t).toMatch(/2017/);
    expect(t).toContain('60 viviendas ocupadas');
    expect(t).toContain('95 %');
    expect(t).toContain('85 %');
    expect(t).toContain('80 %');
    expect(t).toMatch(/no de tu predio ni de hoy/);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('en la calle dice que es la manzana más cercana y a cuántos metros', () => {
    const c = Calculos.evaluarManzana({ lat: P.lat - 70 / M_POR_GRADO_LAT, lon: P.lon }, [M1], OPC);
    expect(Calculos.textoCenso(c)).toMatch(/manzana más cercana a tu punto \(a 20 m/);
  });
  it('pocas viviendas, manzana sin cifras, fuera y sin archivo se dicen sin inventar', () => {
    const pocas = Calculos.evaluarManzana({ lat: P.lat + 250 / M_POR_GRADO_LAT, lon: P.lon }, [M_POCAS], OPC);
    expect(Calculos.textoCenso(pocas)).toMatch(/solo 3 viviendas ocupadas/);
    expect(Calculos.textoCenso(pocas)).not.toMatch(/\d+ %/);
    expect(Calculos.textoCenso(Calculos.evaluarManzana({ lat: P.lat + 450 / M_POR_GRADO_LAT, lon: P.lon }, [M_VACIA], OPC))).toMatch(/no contó viviendas/);
    expect(Calculos.textoCenso(Calculos.evaluarManzana({ lat: 0, lon: 0 }, [M1], OPC))).toMatch(/no cae en una manzana/);
    expect(Calculos.textoCenso(Calculos.evaluarManzana(P, [], OPC))).toMatch(/sin dato/);
  });
  it('la nota dice que son cifras de 2017 de la manzana y que el censo 2025 todavía no está abierto por manzana', () => {
    expect(Calculos.NOTA_CENSO).toMatch(/2017/);
    expect(Calculos.NOTA_CENSO).toMatch(/2025/);
    expect(Calculos.NOTA_CENSO).toMatch(/manzana/);
    expect(Calculos.NOTA_CENSO).not.toMatch(PROHIBIDO);
  });
});

describe('CONFIG.censo', () => {
  it('rutas de los archivos, año, distancia a la manzana más cercana, mínimo de viviendas y el departamento según el censo 2025 con su fuente', () => {
    expect(CONFIG.censo).toMatchObject({ indiceUrl: 'data/censo/index.json', carpetaUrl: 'data/censo/', anio: 2017, manzanaCercanaM: 30, minViviendasPct: 5 });
    expect(CONFIG.censo.departamento2025).toMatchObject({ anio: 2025, aguaDentro: 71.8, higienicoDentro: 69.6, alumbrado: 92.6 });
    expect(CONFIG.censo.departamento2025.url).toMatch(/^https:\/\/www\.gob\.pe\/institucion\/inei\/noticias\//);
    expect(CONFIG.umbrales.censo).toBeNull();
  });
});

// ------------------------------------------------------------------------------ Ficha (Equipamiento)

const ARCHIVOS: Record<string, any> = {};
(globalThis as any).fetch = async (url: string) => {
  const datos = ARCHIVOS[url];
  return datos ? { ok: true, status: 200, json: async () => datos } : { ok: false, status: 404, json: async () => ({}) };
};
const indice = (distritos: object[]) => ({ anio_censo: 2017, fuente: 'INEI, Censos Nacionales 2017 (REDATAM)', fecha_descarga: '2026-11-10', distritos });
const tile = (features: object[]) => ({ type: 'FeatureCollection', metadata: { ubigeo: '040101', anio: 2017 }, features });
const cargarEquipamiento = (archivos: Record<string, object>) => {
  for (const k of Object.keys(ARCHIVOS)) delete ARCHIVOS[k];
  const vacio = { type: 'FeatureCollection', metadata: { fecha_extraccion: '2026-10-28' }, features: [] };
  for (const c of ['salud', 'educacion', 'transporte', 'areasVerdes']) ARCHIVOS[CONFIG.equipamiento.archivos[c]] = vacio;
  Object.assign(ARCHIVOS, archivos);
  jest.resetModules();
  Object.assign(globalThis, { CONFIG, Calculos: require('../public/js/calculos.js'), Services: {}, Rutas: {} });
  return require('../public/js/equipamiento.js');
};
const caja = (m: number): number[] => [P.lon - dLon(m), P.lat - m / M_POR_GRADO_LAT, P.lon + dLon(m), P.lat + m / M_POR_GRADO_LAT];
const DIST = { ubigeo: '040101', distrito: 'AREQUIPA', archivo: 'manzanas/040101.json', caja: caja(1000) };
const DIST_LEJOS = { ubigeo: '040104', distrito: 'CERRO COLORADO', archivo: 'manzanas/040104.json', caja: [-71.9, -16.2, -71.8, -16.1] };
const ev = (archivos: Record<string, object>) => cargarEquipamiento(archivos).evaluar(P.lat, P.lon);

describe('Equipamiento.evaluar: censo por manzana', () => {
  const buenos = { 'data/censo/index.json': indice([DIST, DIST_LEJOS]), 'data/censo/manzanas/040101.json': tile([M1, M_POCAS]) };
  it('lee el índice, carga solo la pieza del distrito que contiene el punto y da las cifras de la manzana con el año del censo', async () => {
    const e = await ev(buenos);
    expect(e.censo).toMatchObject({ estado: 'INFORMATIVO', modo: 'dentro', manzana: '04010100100010', anio: 2017, umbralM: null, fecha: '2026-11-10', fuente: 'INEI, Censos Nacionales 2017 (REDATAM)' });
    expect(e.censo.luz.pct).toBe(95);
    expect(e.censo.metodo).toMatch(/sin umbral/i);
    expect(e.censo.metodo).toMatch(/no dice|no son de/i);
  });
  it('un punto fuera de todas las cajas es SIN DATO («fuera_de_manzanas»), no un error', async () => {
    const e = await ev({ 'data/censo/index.json': indice([DIST_LEJOS]) });
    expect(e.censo).toMatchObject({ estado: 'SIN DATO', motivo: 'fuera_de_manzanas' });
  });
  it('sin el índice o sin la pieza dice SIN DATO («sin_archivo») y no afecta a lo demás', async () => {
    expect((await ev({})).censo).toMatchObject({ estado: 'SIN DATO', motivo: 'sin_archivo', umbralM: null });
    const e = await ev({ 'data/censo/index.json': indice([DIST]) });
    expect(e.censo).toMatchObject({ estado: 'SIN DATO', motivo: 'sin_archivo' });
    expect(e.salud.estado).toBe('SIN DATO');
  });
});

// ------------------------------------------------------------------------------ Sin efecto en la búsqueda ni el puntaje

describe('el censo por manzana no es un criterio de búsqueda ni suma al puntaje', () => {
  it('«un parque con agua» busca solo por el parque', () => {
    expect(Asistente.CRITERIOS.censo).toBeUndefined();
    expect(Asistente.CRITERIOS.agua).toBeUndefined();
    expect(Asistente.interpretar('quiero un parque con agua').criterios.map((c: { id: string }) => c.id)).toEqual(['areaVerde']);
  });
});

// ------------------------------------------------------------------------------ Mapa

describe('Capas: capas coropléticas del censo por manzana', () => {
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 } });
  const UM = { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 } };
  const base = { datos, zonas: [], cauces: [], sismos: [], umbrales: UM, area: null };
  const MZ = [M1, M_POCAS, M_VACIA, cuadrado(600, -50, 100, { id: 'x', v: 40, h: 40, p: 100, o: 40, l: 10, ad: 5, af: 5, sd: 0, sf: 0 })];
  it('están entre las capas con su etiqueta y el año', () => {
    for (const [id, etiqueta] of [['censo_luz', 'Alumbrado eléctrico por red pública (censo 2017)'], ['censo_agua', 'Agua por red pública (censo 2017)'], ['censo_desague', 'Desagüe por red pública (censo 2017)']]) {
      expect(Capas.CAPAS.find((c: { id: string }) => c.id === id)).toMatchObject({ etiqueta });
    }
  });
  it('dibuja cada manzana con cifras entera, con su porcentaje, su clase y el año; las pocas viviendas aparte; las sin cifras no se dibujan', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'censo_luz' }], censo: MZ });
    const luz = c.poligonos.filter((p: { capa: string }) => p.capa === 'censo_luz');
    expect(luz).toHaveLength(3);
    const m1 = luz.find((p: { nombre: string }) => p.nombre === '04010100100010');
    expect(m1).toMatchObject({ valor: 95, clase: 3 });
    expect(m1.detalle).toMatch(/95 %/);
    expect(m1.detalle).toMatch(/2017/);
    expect(m1.geometry).toBe(M1.geometry);
    expect(luz.find((p: { nombre: string }) => p.nombre === 'x')).toMatchObject({ valor: 25, clase: 0 });
    expect(luz.find((p: { nombre: string }) => p.nombre === '04010100100011')).toMatchObject({ valor: null, clase: null });
    expect(c.puntos).toEqual([]);
    const t = c.leyenda.map((l: { texto: string }) => l.texto).join(' | ');
    expect(t).toMatch(/Menos de 50 %: 1/);
    expect(t).toMatch(/95 % o más: 1/);
    expect(t).toMatch(/Pocas viviendas.*: 1/);
  });
  it('agua es red pública dentro o fuera de la vivienda dentro de la edificación; desagüe, lo mismo', () => {
    const a = Capas.construir({ ...base, capas: [{ id: 'censo_agua' }], censo: MZ }).poligonos.find((p: { nombre: string }) => p.nombre === '04010100100010');
    expect(a).toMatchObject({ valor: 85, clase: 2 });
    const s = Capas.construir({ ...base, capas: [{ id: 'censo_desague' }], censo: MZ }).poligonos.find((p: { nombre: string }) => p.nombre === '04010100100010');
    expect(s).toMatchObject({ valor: 80, clase: 2 });
  });
  it('sin el archivo (o con el mapa muy alejado) lo dice y no dibuja nada', () => {
    const c = Capas.construir({ ...base, capas: [{ id: 'censo_luz' }], censo: null });
    expect(c.poligonos).toEqual([]);
    expect(c.sinDatos).toContain('censo');
  });
});

// ------------------------------------------------------------------------------ Chat

describe('chat: «con agua», «con luz» y «desagüe» se responden con el censo de la manzana y la salvedad', () => {
  const ctxBase = { punto: { lat: P.lat, lon: P.lon }, zona: null, estadoPDM: null };
  const censo = Calculos.evaluarManzana(P, [M1], OPC);
  const concesion = Calculos.evaluarConcesion(P, [cuadrado(-1000, -1000, 2000, { nombre_zona: 'DISTRIBUCION AREQUIPA', concesionaria: 'SEAL', empresa: 'SEAL S.A.', expediente: '15008293-00-00', situacion: 'DERECHO VIGENTE' })], { fuente: 'MINEM', fecha: '2026-11-10' });
  const entorno = { censo, electricidad: concesion };
  const resp = (tipo: string, e: object = entorno) => Asistente.responder({ tipo, criterios: [] }, { ...ctxBase, entorno: e }).texto;

  it('agua, desagüe y alcantarillado son una intención propia, no un criterio de búsqueda', () => {
    for (const t of ['¿hay agua en mi punto?', '¿tiene desagüe esta zona?', '¿hay agua potable aquí?', 'servicio de agua y desagüe', '¿hay alcantarillado cerca?']) {
      expect(Asistente.interpretar(t, { hayPunto: true })).toMatchObject({ tipo: 'agua', criterios: [] });
    }
  });
  it('buscar zonas «con agua» no se puede y lo dice', () => {
    expect(Asistente.interpretar('busco una zona con agua y desagüe')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'agua_busqueda' });
  });
  it('mencionaAgua detecta las palabras (para no mandar la frase al modelo)', () => {
    for (const t of ['¿hay agua?', 'desagüe', 'alcantarillado', 'agua potable']) expect(Asistente.mencionaAgua(t)).toBe(true);
    expect(Asistente.mencionaAgua('busco una posta')).toBe(false);
    expect(Asistente.mencionaAgua('río Chili')).toBe(false);
  });
  it('agua: el porcentaje de la manzana en 2017, la nota y la fuente; sin «tu predio tiene»', () => {
    const t = resp('agua');
    expect(t).toMatch(/85 %/);
    expect(t).toMatch(/80 %/);
    expect(t).toMatch(/2017/);
    expect(t).toMatch(/manzana/);
    expect(t).toMatch(/INEI/);
    expect(t).toMatch(/no de tu predio ni de hoy/);
    expect(t).toMatch(/2025/);
    expect(t).not.toMatch(PROHIBIDO);
    expect(t).not.toMatch(/cumple/i);
  });
  it('luz: la concesión de SEAL Y el alumbrado de la manzana en 2017, cada uno con su salvedad', () => {
    const t = resp('electricidad');
    expect(t).toMatch(/dentro del área de concesión de distribución eléctrica de SEAL/);
    expect(t).toMatch(/95 %/);
    expect(t).toMatch(/alumbrado eléctrico por red pública/);
    expect(t).toMatch(/2017/);
    expect(t).not.toMatch(PROHIBIDO);
  });
  it('sin dato del censo lo dice sin inventar; sin punto pide elegir uno', () => {
    expect(resp('agua', { censo: Calculos.evaluarManzana(P, [], OPC) })).toMatch(/sin dato|no pude leer/i);
    expect(Asistente.responder({ tipo: 'agua', criterios: [] }, {}).texto).toMatch(/punto/);
  });
  it('el resumen del punto trae una línea informativa de los servicios de la manzana, con el año', () => {
    const e: any = {
      ...entorno,
      salud: { estado: 'NO CUMPLE', nombre: 'H', distanciaM: 2500, umbralM: 1000, fuenteElemento: 'RENIPRESS' },
      educacion: { inicial: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 500 }, primaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 1500 }, secundaria: { estado: 'SIN DATO', nombre: null, distanciaM: null, umbralM: 3000 } },
      transporte: { estado: 'CUMPLE', nombre: 'P', distanciaM: 100, umbralM: 400 },
      areaVerde: { estado: 'CUMPLE', nombre: 'Q', distanciaM: 100, umbralM: 300 },
    };
    const t = Asistente.responder({ tipo: 'ficha', criterios: [] }, { ...ctxBase, entorno: e }).texto;
    expect(t).toMatch(/Servicios de la manzana \(censo 2017, informativo\): alumbrado 95 %, agua 85 %, desagüe 80 %/);
  });
  it('«fuentes» menciona el censo por manzana', () => {
    const f = Asistente.explicar('fuentes');
    expect([...f.fuente, ...f.limites].join(' ')).toMatch(/REDATAM|Censos Nacionales 2017/);
  });
});

// ------------------------------------------------------------------------------ Informe

describe('Reporte: servicios de la manzana es una sección informativa', () => {
  const servicio = (extra: object) => ({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'POSTA X', fecha: '2026-10-30', fuente: 'RENIPRESS (SUSALUD)', metodo: 'Distancia en línea recta.', ...extra });
  const d = (conCenso: boolean) => ({
    punto: { lat: -16.4, lon: -71.5, etiqueta: 'Punto' }, zona: null, modulos: {}, avisoPDM: null, verificaciones: {}, umbrales: { salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400, areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 } },
    fuentesUmbral: { ...CONFIG.fuentesUmbral },
    fuentes: { zonificacion: 'Plano', peligros: 'p', distritos: 'd', delitos: 'e' },
    variables: {
      salud: servicio({}),
      ...(conCenso ? { censo: Calculos.evaluarManzana(P, [M1], OPC) } : {}),
      educacion: { inicial: servicio({}), primaria: servicio({}), secundaria: servicio({}) },
      transporte: servicio({ nombre: 'Paradero' }), areaVerde: servicio({ nombre: 'Parque' }),
    },
  });
  const seccion = (datos: object) => Reporte.construirSecciones(datos).find((s: { titulo: string }) => s.titulo.includes('Servicios de la manzana'));
  it('hay una sección con el año, la manzana, las viviendas, los tres porcentajes, la fuente y la salvedad', () => {
    const s = seccion(d(true));
    expect(s.titulo).toMatch(/censo 2017/);
    expect(s.titulo).toMatch(/informativo/i);
    for (const t of ['04010100100010', '60', '95 %', '85 %', '80 %', 'INFORMATIVO']) expect(s.cuerpo).toContain(t);
    expect(s.cuerpo).toMatch(/no de tu predio ni de hoy/);
    expect(s.cuerpo).not.toMatch(/NO CUMPLE|Umbral/);
    expect(s.fuente).toMatch(/INEI/);
  });
  it('sin censo en las variables, el informe no cambia', () => {
    expect(seccion(d(false))).toBeUndefined();
  });
  it('las limitaciones dicen que son cifras de 2017 de la manzana, no del predio', () => {
    expect(Reporte.limites(d(true)).join(' ')).toMatch(/censo[^.]*2017[^.]*manzana|manzana[^.]*2017/i);
  });
});

// ------------------------------------------------------------------------------ Archivos reales

describe('archivos reales del censo por manzana', () => {
  const dir = join(__dirname, '..', 'public', 'data', 'censo');
  const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const leerTile = (ubigeo: string) => JSON.parse(readFileSync(join(dir, 'manzanas', `${ubigeo}.json`), 'utf8'));

  it('el índice trae la procedencia: año, fuente, enlaces, fecha de descarga, universo y lo que no dice', () => {
    expect(idx.anio_censo).toBe(2017);
    expect(idx.fuente).toMatch(/INEI/);
    expect(idx.url_redatam).toMatch(/^https:\/\/censos2017\.inei\.gob\.pe\//);
    expect(idx.url_poligonos).toMatch(/geoespacial\.inei\.gob\.pe/);
    expect(idx.fecha_descarga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(idx.universo).toMatch(/ocupadas con personas presentes/);
    expect(idx.no_dice).toMatch(/2025/);
    expect(idx.distritos.length).toBeGreaterThanOrEqual(20);
  });
  it('la Plaza de Armas cae en una manzana del Cercado con cifras coherentes (alumbrado + sin alumbrado = ocupadas)', () => {
    const r = Calculos.evaluarManzana({ lat: -16.3989, lon: -71.5369 }, leerTile('040101').features, { anio: 2017, cercanaM: 30, minViviendas: 5 });
    expect(r.modo === 'dentro' || r.modo === 'cercana').toBe(true);
    if (r.tieneCifras) {
      expect(r.luz.n).toBeLessThanOrEqual(r.ocupadas);
      expect(r.agua.n).toBeLessThanOrEqual(r.ocupadas);
      expect(r.desague.n).toBeLessThanOrEqual(r.ocupadas);
    }
  });
});
