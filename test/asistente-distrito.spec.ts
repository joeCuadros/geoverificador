/**
 * Pruebas del chat con distritos: contar lo que hay en un distrito, el perfil de un distrito, «la mejor zona» sin distrito y
 * los resultados de búsqueda en lenguaje de personas (sectores), sin porcentajes de suelo ni cuadrícula a la vista.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Entidades = require('../public/js/entidades.js');
const Sectores = require('../public/js/sectores.js');

const UMBRALES = {
  salud: 1000,
  educacion: { inicial: 500, primaria: 1500, secundaria: 3000 },
  transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 },
  zona: { campina: 500, comercial: 600, historico: 800 },
};
const ids = (r: { criterios: { id: string }[] }) => r.criterios.map((c) => c.id).sort();

// ------------------------------------------------------------------ interpretar
describe('Asistente.interpretar con distritos', () => {
  it('«¿cuántos colegios hay en Paucarpata?» es contar en ese distrito', () => {
    const r = Asistente.interpretar('¿Cuántos colegios hay en Paucarpata?');
    expect(r.tipo).toBe('contar');
    expect(r.distrito).toBe('PAUCARPATA');
    expect(ids(r)).toEqual(['colegio']);
  });

  it('la frase de la transcripción: «quiero vivir en pauccarpata cuantos colegios hay ahi» cuenta colegios, no pide un punto', () => {
    const r = Asistente.interpretar('quiero vivir en pauccarpata cuantos colegios hay ahi', { hayPunto: false });
    expect(r.tipo).toBe('contar');
    expect(r.distrito).toBe('PAUCARPATA');
  });

  it('cuenta también salud, paraderos y parques', () => {
    expect(ids(Asistente.interpretar('cuántos parques y postas hay en Cayma'))).toEqual(['areaVerde', 'salud']);
    expect(Asistente.interpretar('cuántos paraderos hay en cerro colorado').distrito).toBe('CERRO COLORADO');
    expect(Asistente.interpretar('colegios en Yanahuara').tipo).toBe('contar');
    expect(Asistente.interpretar('¿hay hospitales en Sachaca?').tipo).toBe('contar');
  });

  it('«quiero vivir en Paucarpata» y «la mejor zona para vivir en Paucarpata» piden el perfil de ese distrito', () => {
    ['quiero vivir en Paucarpata', 'yo quiero que me busques la mejor zona para vivir en paucartara', 'háblame de Paucarpata', '¿cómo es Cayma?', 'qué hay en Yanahuara'].forEach((f) => {
      const r = Asistente.interpretar(f);
      expect(r.tipo).toBe('perfil');
      expect(r.distrito).toBeTruthy();
    });
    expect(Asistente.interpretar('yo quiero que me busques la mejor zona para vivir en paucartara').distrito).toBe('PAUCARPATA');
  });

  it('«la mejor zona para vivir» sin distrito explica que depende de lo que importe y pregunta qué importa', () => {
    ['la mejor zona para vivir', 'quiero vivir en Arequipa', 'dónde es mejor vivir', '¿qué zona me recomiendas?', 'busco la mejor zona'].forEach((f) => {
      expect(Asistente.interpretar(f).tipo).toBe('mejor_zona');
    });
  });

  it('una búsqueda con criterios en un distrito sigue siendo búsqueda, limitada a ese distrito', () => {
    const r = Asistente.interpretar('busco en Paucarpata un colegio y un parque cerca');
    expect(r.tipo).toBe('buscar');
    expect(r.distrito).toBe('PAUCARPATA');
    expect(ids(r)).toEqual(['areaVerde', 'colegio']);
  });

  it('un distrito de la provincia que no está en los datos se reconoce y se marca', () => {
    const r = Asistente.interpretar('cuántos colegios hay en Vítor');
    expect(r.tipo).toBe('contar');
    expect(r.distrito).toBe('VITOR');
    expect(r.distritoFuera).toBe(true);
  });

  it('no cambia lo que ya entendía sin distrito', () => {
    expect(Asistente.interpretar('busco cerca de un colegio y un parque').tipo).toBe('buscar');
    expect(Asistente.interpretar('busco cerca de un colegio y un parque').distrito).toBeNull();
    expect(Asistente.interpretar('¿es seguro vivir ahí?').tipo).toBe('no_soportado');
    expect(Asistente.interpretar('asdf qwerty').tipo).toBe('desconocido');
    expect(Asistente.interpretar('hola').tipo).toBe('saludo');
  });
});

// ------------------------------------------------------------------ responder
describe('Asistente.responder: contar', () => {
  const conteo = {
    colegios: { total: 235, inicial: 134, primaria: 90, secundaria: 55, sinNivel: 20, lista: [] },
    salud: { total: 18, lista: [] },
    paraderos: { total: 43, lista: [] },
    parques: { total: 145, grandes: 8, areaTotalM2: 400000, lista: [] },
  };
  const ctx = { distritoTitulo: 'Paucarpata', conteo, fecha: '2026-10-28' };
  const intencion = (f: string) => Asistente.interpretar(f);

  it('responde con el formato pedido y cita la fuente y la fecha', () => {
    const r = Asistente.responder(intencion('¿cuántos colegios hay en Paucarpata?'), ctx);
    expect(r.texto).toContain('En Paucarpata hay 235 colegios: 134 inicial, 90 primaria, 55 secundaria (OpenStreetMap, 2026-10-28; puede faltar alguno).');
  });

  it('explica por qué los niveles suman más que el total', () => {
    const r = Asistente.responder(intencion('¿cuántos colegios hay en Paucarpata?'), ctx);
    expect(r.texto).toMatch(/varios niveles/);
  });

  it('pide dibujar esos colegios en el mapa, encuadrando el distrito', () => {
    const r = Asistente.responder(intencion('¿cuántos colegios hay en Paucarpata?'), ctx);
    expect(r.mapa).toEqual({ distrito: 'PAUCARPATA', capas: ['colegio'] });
  });

  it('con varios tipos junta las cifras en una frase', () => {
    const r = Asistente.responder(intencion('cuántos parques y postas hay en Paucarpata'), ctx);
    expect(r.texto).toContain('18 establecimientos de salud');
    expect(r.texto).toContain('8 parques de al menos media hectárea (145 áreas verdes en total)');
    expect(r.mapa.capas.sort()).toEqual(['areaVerde', 'salud']);
  });

  it('si no hay ninguno, no inventa: dice que no lo encontró en OpenStreetMap', () => {
    const vacio = { ...conteo, salud: { total: 0, lista: [] } };
    const r = Asistente.responder(intencion('cuántas postas hay en Paucarpata'), { ...ctx, conteo: vacio });
    expect(r.texto).toMatch(/no encontré/i);
    expect(r.texto).toContain('puede que existan sin estar mapeados');
  });

  it('un distrito fuera de los datos lo dice y no da cifras', () => {
    const r = Asistente.responder(intencion('cuántos colegios hay en Vítor'), { distritoTitulo: 'Vítor', conteo: null });
    expect(r.texto).toContain('Vítor');
    expect(r.texto).toMatch(/no está en los datos/);
    expect(r.texto).not.toMatch(/\d{2,} colegios/);
  });
});

describe('Asistente.responder: perfil de un distrito', () => {
  const perfil = {
    conteo: {
      colegios: { total: 235, inicial: 134, primaria: 90, secundaria: 55, sinNivel: 0, lista: [] },
      salud: { total: 18, lista: [] },
      paraderos: { total: 43, lista: [] },
      parques: { total: 145, grandes: 8, areaTotalM2: 400000, lista: [] },
    },
    zonas: { conPlano: true, partes: [{ id: 'residencial', etiqueta: 'residencial', pct: 61.6 }, { id: 'campina', etiqueta: 'campiña', pct: 13.8 }, { id: 'comercial', etiqueta: 'comercial', pct: 5.9 }, { id: 'industrial', etiqueta: 'industrial', pct: 1 }] },
    cauces: { nombres: ['Río Chili'], total: 2 },
  };
  const ctx = { distritoTitulo: 'Paucarpata', perfil, fecha: '2026-10-28' };
  const r = Asistente.responder(Asistente.interpretar('quiero vivir en Paucarpata'), ctx);

  it('resume ese distrito: zonificación, servicios y quebradas', () => {
    expect(r.texto).toContain('Paucarpata');
    expect(r.texto).toMatch(/residencial \(62 %\)/);
    expect(r.texto).toMatch(/campiña \(14 %\)/);
    expect(r.texto).not.toMatch(/industrial/); // solo los tipos principales
    expect(r.texto).toContain('235 colegios');
    expect(r.texto).toContain('18 establecimientos de salud');
    expect(r.texto).toContain('43 paraderos');
    expect(r.texto).toContain('8 parques');
    expect(r.texto).toContain('Río Chili');
    expect(r.texto).toContain('OpenStreetMap, 2026-10-28');
  });

  it('termina con una pregunta sobre lo primero para la persona y ofrece botones que buscan dentro de ese distrito', () => {
    expect(r.texto).toMatch(/¿Qué es lo primero para ti: colegio cerca, parque, transporte, tranquilidad…\?$/);
    const frases = r.sugerencias.map((s: { texto?: string } | string) => (typeof s === 'string' ? s : s.texto));
    expect(r.sugerencias.length).toBeGreaterThanOrEqual(4);
    frases.forEach((f: string) => {
      const q = Asistente.interpretar(f);
      expect(q.tipo).toBe('buscar');
      expect(q.distrito).toBe('PAUCARPATA');
    });
  });

  it('no usa el lenguaje de «suelo que cumple» ni «coincidencia»', () => {
    expect(r.texto).not.toMatch(/suelo|coincidencia|cumple todo/i);
  });

  it('sin quebradas en la red de la ANA lo dice con sus límites', () => {
    const sin = Asistente.responder(Asistente.interpretar('quiero vivir en Paucarpata'), { ...ctx, perfil: { ...perfil, cauces: { nombres: [], total: 0 } } });
    expect(sin.texto).toMatch(/no registra (cauces|quebradas)/);
  });

  it('un distrito sin plano de zonificación lo dice en vez de inventar una mezcla', () => {
    const sin = Asistente.responder(Asistente.interpretar('háblame de Paucarpata'), { ...ctx, perfil: { ...perfil, zonas: { conPlano: false, partes: [] } } });
    expect(sin.texto).toMatch(/no tengo zonificación/i);
  });
});

describe('Asistente.responder: mejor_zona sin distrito', () => {
  const r = Asistente.responder(Asistente.interpretar('la mejor zona para vivir'), {});
  it('explica que no elige una «mejor» porque depende de lo que importe, y pregunta qué importa', () => {
    expect(r.texto).toMatch(/no (elijo|digo) una «mejor zona»/i);
    expect(r.texto).toMatch(/depende de lo que/);
    expect(r.texto).toMatch(/¿Qué es lo primero para ti/);
  });
  it('ofrece botones que son búsquedas', () => {
    const frases = r.sugerencias.map((s: { texto?: string } | string) => (typeof s === 'string' ? s : s.texto));
    expect(frases.length).toBeGreaterThanOrEqual(4);
    expect(frases.filter((f: string) => Asistente.interpretar(f).tipo === 'buscar').length).toBeGreaterThanOrEqual(4);
  });
});

// ------------------------------------------------------------------ búsqueda
const M = (Math.PI / 180) * 6371008.8;
const LAT0 = -16.4;
const LON0 = -71.55;
const anillo = (lat: number, lon: number, ladoM: number) => {
  const a = lat + ladoM / M;
  const o = lon + ladoM / (M * Math.cos((lat * Math.PI) / 180));
  return [[lon, lat], [o, lat], [o, a], [lon, a], [lon, lat]];
};
const zonas = [
  { codigo: 'RDM-1', bbox: [LON0, LAT0, LON0 + 0.03, LAT0 + 0.03], polys: [[anillo(LAT0, LON0, 3000)]], regla: { nombre: 'Residencial', grupo: 'residencial', edificable: 'si' } },
];
const punto = (osm: string, lat: number, lon: number, tags: Record<string, string>, nombre: string | null) => ({
  type: 'Feature', properties: { osm, nombre, tags }, geometry: { type: 'Point', coordinates: [lon, lat] },
});
const parque = (lat: number, lon: number, lado: number, nombre: string) => ({
  type: 'Feature', properties: { osm: 'way/1', nombre, tags: { leisure: 'park' } }, geometry: { type: 'Polygon', coordinates: [anillo(lat, lon, lado)] },
});
// Un colegio y un parque en el rincón suroeste: allí (y solo allí) se cumplen ambos a la vez.
const datos = Asistente.prepararDatos(
  {
    educacion: [punto('node/1', LAT0 + 400 / M, LON0 + 0.005, { amenity: 'school', 'isced:level': '0' }, 'Jardín Los Pinos')],
    areasVerdes: [parque(LAT0 + 300 / M, LON0 + 0.003, 120, 'Parque Los Pinos')],
    salud: [],
    transporte: [],
  },
  zonas,
  UMBRALES,
);
const buscarEn = (criterios: object[], extra: object = {}) => Asistente.buscar({
  criterios, zonas, datos, umbrales: UMBRALES, distritoDe: () => 'PAUCARPATA', pasoM: 250, minCeldas: 1, ...extra,
});
const criterios = [{ id: 'inicial', umbralM: null, prioridad: 1 }, { id: 'areaVerde', umbralM: null, prioridad: 1 }];

describe('Asistente.buscar: sectores donde se cumple todo', () => {
  const r = buscarEn(criterios);

  it('devuelve las celdas que cumplen todo (andamio interno) con su distrito', () => {
    expect(r.cumplen.length).toBeGreaterThan(0);
    expect(r.cumplen.every((c: { distrito: string }) => c.distrito === 'PAUCARPATA')).toBe(true);
    expect(r.cumplen.every((c: { detalle: { inicial: { cumple: boolean } } }) => c.detalle.inicial.cumple)).toBe(true);
  });

  it('cuenta en cuántas celdas se cumple cada criterio por separado', () => {
    expect(r.cumplenPor.inicial).toBeGreaterThanOrEqual(r.cumplen.length);
    expect(r.cumplenPor.areaVerde).toBeGreaterThanOrEqual(r.cumplen.length);
  });

  it('limitada a un distrito, descarta las celdas de otros distritos', () => {
    const otro = buscarEn(criterios, { distrito: 'CAYMA' });
    expect(otro.totalCeldas).toBe(0);
    expect(otro.cumplen).toEqual([]);
    const mismo = buscarEn(criterios, { distrito: 'PAUCARPATA' });
    expect(mismo.cumplen.length).toBe(r.cumplen.length);
  });
});

describe('Asistente.formatearBusqueda: en lenguaje de personas', () => {
  const r = buscarEn(criterios, { distrito: 'PAUCARPATA' });
  const f = Asistente.formatearBusqueda(r, { datos, distrito: 'Paucarpata', fecha: '2026-10-28' });

  it('cuenta sectores y dice qué se cumple a la vez, con las distancias en llano', () => {
    expect(f.texto).toMatch(/Encontré \d+ sector(es)? de Paucarpata/);
    expect(f.texto).toContain('tienes a la vez un colegio inicial a menos de 500 m y un parque a menos de 300 m');
  });

  it('nunca expone porcentajes de suelo, coincidencia ponderada ni celdas', () => {
    expect(f.texto).not.toMatch(/suelo|coincidencia|ponderad|celda|cuadr[ií]cula|cumple todo/i);
    f.filas.forEach((fila: { titulo: string; detalle: string; nota: string }) => {
      expect(`${fila.titulo} ${fila.detalle} ${fila.nota}`).not.toMatch(/suelo|coincidencia|ponderad|celda|%/i);
    });
  });

  it('cada sector se nombra con el elemento con nombre más cercano y trae el punto para el mapa', () => {
    expect(f.filas.length).toBeGreaterThan(0);
    const [fila] = f.filas;
    expect(fila.titulo).toMatch(/^Sector 1/);
    expect(fila.titulo).toMatch(/Parque Los Pinos|Jardín Los Pinos/);
    expect(Number.isFinite(fila.mejor.lat) && Number.isFinite(fila.mejor.lon)).toBe(true);
    expect(fila.nota).toMatch(/colegio inicial a \d+ m/);
    expect(fila.nota).toMatch(/parque a \d+ m/);
  });

  it('dice que los números solo sirven para ubicar los sectores, no son un orden de calidad', () => {
    expect(f.texto).toMatch(/solo para ubicarlos/);
  });

  it('entrega los sectores con su contorno para dibujarlos en el mapa', () => {
    expect(f.sectores.length).toBe(f.filas.length);
    expect(f.sectores[0].contorno.length).toBeGreaterThan(0);
  });

  it('sin sectores explica qué criterio limita más y sugiere quitarlo', () => {
    const imposible = buscarEn([{ id: 'inicial', umbralM: 20, prioridad: 1 }, { id: 'areaVerde', umbralM: 20, prioridad: 1 }], { distrito: 'PAUCARPATA' });
    const g = Asistente.formatearBusqueda(imposible, { datos, distrito: 'Paucarpata' });
    expect(g.texto).toMatch(/No encontré ningún sector de Paucarpata donde tengas a la vez/);
    expect(g.texto).toMatch(/Lo que más limita/);
    expect(g.sugerencias.some((s: string) => s.startsWith('Quita '))).toBe(true);
    expect(g.filas).toEqual([]);
  });

  it('solo ordena por cercanía si la persona marcó una prioridad', () => {
    const conPrioridad = buscarEn([{ id: 'inicial', umbralM: null, prioridad: 2 }, { id: 'areaVerde', umbralM: null, prioridad: 1 }], { distrito: 'PAUCARPATA' });
    const g = Asistente.formatearBusqueda(conPrioridad, { datos, distrito: 'Paucarpata' });
    expect(g.texto).toMatch(/ordené por cercanía/i);
    expect(f.texto).not.toMatch(/por cercanía/i);
  });
});

describe('Sectores sobre el resultado de buscar', () => {
  it('agrupa las celdas que cumplen en menos sectores que celdas', () => {
    const r = buscarEn(criterios);
    const sectores = Sectores.agrupar(r.cumplen, { pasoM: 250 });
    expect(sectores.length).toBeGreaterThan(0);
    expect(sectores.length).toBeLessThanOrEqual(r.cumplen.length);
  });
  it('los conteos del distrito y los de los sectores usan los mismos datos', () => {
    expect(Entidades.contar(datos, [[anillo(LAT0, LON0, 3000)]]).colegios.total).toBe(1);
  });
});

describe('Los sectores traen los centros de sus celdas para el mapa', () => {
  it('cada sector entrega los puntos que lo componen', () => {
    const f = Asistente.formatearBusqueda(buscarEn(criterios, { distrito: 'PAUCARPATA' }), { datos, distrito: 'Paucarpata' });
    expect(f.sectores[0].centros.length).toBeGreaterThanOrEqual(2);
    expect(f.sectores[0].centros[0]).toHaveLength(2);
  });
});
