/**
 * Pruebas de public/js/asistente.js: el asistente de chat. Es lógica pura (sin DOM ni red): entiende lo que escribe la
 * persona, responde sobre el punto ya consultado y busca zonas con los mismos datos y umbrales de las 5 variables.
 * El módulo es JavaScript de navegador que también se exporta como CommonJS, así que se carga con require.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');

type Punto = { lat: number; lon: number };
const P: Punto = { lat: -16.409, lon: -71.5375 };
const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number, lat = P.lat) => m / (M_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180));

// Cuadrado de `lado` m con la esquina suroeste en (lat, lon), como anillo GeoJSON [lon, lat].
const cuadrado = (lat: number, lon: number, lado: number) => {
  const a = lat + dLat(lado);
  const o = lon + dLon(lado, lat);
  return [[lon, lat], [o, lat], [o, a], [lon, a], [lon, lat]];
};
const bboxDe = (anillo: number[][]) => {
  const xs = anillo.map((c) => c[0]);
  const ys = anillo.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const zona = (codigo: string, grupo: string, edificable: string, anillo: number[][]) => ({
  codigo,
  color: '#999999',
  bbox: bboxDe(anillo),
  polys: [[anillo]],
  regla: { nombre: `Zona ${codigo}`, grupo, edificable },
});
const punto = (lat: number, lon: number, tags: Record<string, string>, nombre = 'X') => ({
  type: 'Feature',
  properties: { osm: `node/${Math.round(lat * 1e5)}`, nombre, tags },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});
const poligono = (lat: number, lon: number, lado: number, nombre = 'Parque') => ({
  type: 'Feature',
  properties: { osm: 'way/1', nombre, tags: { leisure: 'park' } },
  geometry: { type: 'Polygon', coordinates: [cuadrado(lat, lon, lado)] },
});

const UMBRALES = {
  salud: 1000,
  educacion: { inicial: 500, primaria: 1500, secundaria: 3000 },
  transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 },
  zona: { campina: 500, comercial: 600, historico: 800 },
};

// ------------------------------------------------------------------ interpretar
describe('Asistente.interpretar', () => {
  const ids = (r: { criterios: { id: string }[] }) => r.criterios.map((c) => c.id).sort();

  it('reconoce un saludo', () => {
    expect(Asistente.interpretar('Hola, buenas').tipo).toBe('saludo');
  });

  it('reconoce la petición de ayuda', () => {
    expect(Asistente.interpretar('¿Qué puedes hacer?').tipo).toBe('ayuda');
  });

  it('entiende una búsqueda con varios criterios y no depende de tildes ni mayúsculas', () => {
    const r = Asistente.interpretar('Quiero vivir CERCA de un colegio y de un ÁREA VERDE');
    expect(r.tipo).toBe('buscar');
    expect(ids(r)).toEqual(['areaVerde', 'colegio']);
  });

  it('entiende «posta» como salud, «paradero» como transporte y «campiña» como campiña', () => {
    const r = Asistente.interpretar('busco zonas con posta, paradero y campiña');
    expect(ids(r)).toEqual(['campina', 'salud', 'transporte']);
  });

  it('distingue «jardín de niños» (inicial) de «jardines» (área verde)', () => {
    expect(ids(Asistente.interpretar('busco cerca de un jardín de niños'))).toEqual(['inicial']);
    expect(ids(Asistente.interpretar('busco cerca de jardines'))).toEqual(['areaVerde']);
  });

  it('un nivel explícito reemplaza al «colegio» genérico', () => {
    expect(ids(Asistente.interpretar('busco zona con colegio de primaria'))).toEqual(['primaria']);
  });

  it('un solo radio en el mensaje vale para todos los criterios', () => {
    const r = Asistente.interpretar('busco colegio, posta y parque en un radio de 1 km');
    expect(r.radioGlobalM).toBe(1000);
    expect(r.criterios.every((c: { umbralM: number | null }) => c.umbralM === null)).toBe(true);
  });

  it('varias distancias se asignan a su criterio', () => {
    const r = Asistente.interpretar('busco colegio a 500 m y parque a 300 m');
    const por = Object.fromEntries(r.criterios.map((c: { id: string; umbralM: number }) => [c.id, c.umbralM]));
    expect(por).toEqual({ colegio: 500, areaVerde: 300 });
    expect(r.radioGlobalM).toBeNull();
  });

  it('acepta decimales con coma o punto en kilómetros', () => {
    expect(Asistente.interpretar('busco parque en un radio de 1,5 km').radioGlobalM).toBe(1500);
    expect(Asistente.interpretar('busco parque en un radio de 0.8 km').radioGlobalM).toBe(800);
  });

  it('marca la prioridad cuando la persona dice qué es lo más importante', () => {
    const r = Asistente.interpretar('busco campiña y zona residencial, lo más importante es la campiña');
    const por = Object.fromEntries(r.criterios.map((c: { id: string; prioridad: number }) => [c.id, c.prioridad]));
    expect(por.campina).toBe(2);
    expect(por.residencial).toBe(1);
  });

  it('«tranquilo» y «mall» son aproximaciones y se declaran como tales', () => {
    const r = Asistente.interpretar('quiero un lugar tranquilo cerca de un mall');
    expect(ids(r)).toEqual(['comercial', 'tranquilo']);
    expect(r.aproximados.sort()).toEqual(['comercial', 'tranquilo']);
  });

  it('«barrio tradicional» se aproxima con el centro histórico', () => {
    const r = Asistente.interpretar('busco un barrio tradicional con parque');
    expect(ids(r)).toEqual(['areaVerde', 'historico']);
    expect(r.aproximados).toContain('historico');
  });

  it('un tema sin datos (seguridad, precio) no se inventa: se avisa', () => {
    const solo = Asistente.interpretar('¿es seguro vivir ahí?');
    expect(solo.tipo).toBe('no_soportado');
    expect(solo.temaNoSoportado).toBe('seguridad');
    const mezcla = Asistente.interpretar('busco cerca de un colegio y que sea seguro');
    expect(mezcla.tipo).toBe('buscar');
    expect(mezcla.temaNoSoportado).toBe('seguridad');
    expect(Asistente.interpretar('quiero algo barato cerca de un parque').temaNoSoportado).toBe('precio');
  });

  it('pregunta sobre la zona y sobre cuánto se puede construir, con el área del lote', () => {
    expect(Asistente.interpretar('¿Qué zona es esta?').tipo).toBe('zona');
    const c = Asistente.interpretar('¿cuánto puedo construir en un lote de 200 m²?');
    expect(c.tipo).toBe('construir');
    expect(c.lote).toBe(200);
  });

  it('el área del lote no se confunde con una distancia', () => {
    const c = Asistente.interpretar('lote de 300 m2, ¿cuántos pisos?');
    expect(c.lote).toBe(300);
    expect(c.radioGlobalM).toBeNull();
  });

  it('reconoce preguntas sobre el PDM nuevo y sobre las fuentes', () => {
    expect(Asistente.interpretar('¿va a cambiar la zonificación con el nuevo PDM?').tipo).toBe('pdm');
    expect(Asistente.interpretar('¿de dónde salen los datos?').tipo).toBe('fuentes');
  });

  it('con un punto elegido, «¿hay un colegio cerca de mi punto?» es una pregunta sobre ese punto', () => {
    const r = Asistente.interpretar('¿hay un colegio cerca de mi punto?', { hayPunto: true });
    expect(r.tipo).toBe('servicio');
    expect(ids(r)).toEqual(['colegio']);
  });

  it('pide el resumen del punto', () => {
    expect(Asistente.interpretar('dame un resumen de mi punto', { hayPunto: true }).tipo).toBe('ficha');
  });

  it('ajusta la búsqueda anterior: agregar, quitar y priorizar', () => {
    const ultima = { criterios: [{ id: 'colegio', umbralM: null, prioridad: 1 }, { id: 'areaVerde', umbralM: null, prioridad: 1 }] };
    const a = Asistente.interpretar('agrega transporte', { ultimaBusqueda: ultima });
    expect(a.modo).toBe('agregar');
    expect(ids(a)).toEqual(['transporte']);
    const q = Asistente.interpretar('quita el parque', { ultimaBusqueda: ultima });
    expect(q.modo).toBe('quitar');
    expect(ids(q)).toEqual(['areaVerde']);
    const p = Asistente.interpretar('prioriza el colegio', { ultimaBusqueda: ultima });
    expect(p.modo).toBe('priorizar');
    expect(p.criterios[0].prioridad).toBe(2);
  });

  it('detecta que se quieren incluir zonas condicionadas', () => {
    expect(Asistente.interpretar('busco parque, incluye zonas condicionales').incluirCondicional).toBe(true);
    expect(Asistente.interpretar('busco parque').incluirCondicional).toBe(false);
  });

  it('no inventa: un texto sin sentido es desconocido', () => {
    expect(Asistente.interpretar('asdf qwerty').tipo).toBe('desconocido');
    expect(Asistente.interpretar('').tipo).toBe('desconocido');
  });
});

// ---------------------------------------------------------------- generarCeldas
describe('Asistente.generarCeldas', () => {
  const residencial = zona('RDB', 'residencial', 'si', cuadrado(P.lat, P.lon, 1000));
  const agricola = zona('ZA', 'proteccion', 'no', cuadrado(P.lat, P.lon + dLon(1200), 1000));
  const condicional = zona('E', 'equipamiento', 'condicionado', cuadrado(P.lat + dLat(1200), P.lon, 1000));

  it('solo toma celdas dentro de zonas construibles', () => {
    const celdas = Asistente.generarCeldas([residencial, agricola, condicional], { pasoM: 250 });
    expect(celdas.length).toBeGreaterThan(0);
    expect(celdas.every((c: { zona: string }) => c.zona === 'RDB')).toBe(true);
  });

  it('con incluirCondicional suma las zonas condicionadas, nunca las no construibles', () => {
    const celdas = Asistente.generarCeldas([residencial, agricola, condicional], { pasoM: 250, incluirCondicional: true });
    const zonas = new Set(celdas.map((c: { zona: string }) => c.zona));
    expect(zonas.has('E')).toBe(true);
    expect(zonas.has('ZA')).toBe(false);
  });

  it('limita las celdas a un radio alrededor de un centro', () => {
    const todas = Asistente.generarCeldas([residencial], { pasoM: 250 });
    const cerca = Asistente.generarCeldas([residencial], { pasoM: 250, centro: { lat: P.lat + dLat(500), lon: P.lon + dLon(500) }, radioM: 300 });
    expect(cerca.length).toBeGreaterThan(0);
    expect(cerca.length).toBeLessThan(todas.length);
  });

  it('con zonas superpuestas gana la última, como en el plano', () => {
    const encima = zona('CZ', 'comercial', 'si', cuadrado(P.lat, P.lon, 1000));
    const celdas = Asistente.generarCeldas([residencial, encima], { pasoM: 250 });
    expect(celdas.every((c: { zona: string }) => c.zona === 'CZ')).toBe(true);
  });
});

// ---------------------------------------------------------------- evaluarCelda
describe('Asistente.evaluarCelda', () => {
  const datos = Asistente.prepararDatos(
    {
      salud: [punto(P.lat + dLat(400), P.lon, { amenity: 'hospital' }, 'Hospital Norte')],
      educacion: [
        punto(P.lat, P.lon + dLon(300), { amenity: 'kindergarten' }, 'Jardín Sol'),
        punto(P.lat, P.lon - dLon(1200), { amenity: 'school' }, 'Colegio Lejano'),
      ],
      transporte: [punto(P.lat - dLat(200), P.lon, { highway: 'bus_stop' }, 'Paradero Sur')],
      areasVerdes: [poligono(P.lat, P.lon + dLon(150), 100, 'Parque Grande'), poligono(P.lat, P.lon - dLon(50), 30, 'Parque Chico')],
    },
    [zona('ZA', 'proteccion', 'no', cuadrado(P.lat, P.lon + dLon(300), 400))],
    UMBRALES,
  );
  const celda = { lat: P.lat, lon: P.lon, zona: 'RDB', grupo: 'residencial' };
  const req = (id: string, extra = {}) => ({ id, umbralM: null, prioridad: 1, ...extra });

  it('salud: distancia al más cercano contra el umbral', () => {
    const e = Asistente.evaluarCelda(celda, datos, [req('salud')], UMBRALES);
    expect(e.salud.cumple).toBe(true);
    expect(e.salud.nombre).toBe('Hospital Norte');
    expect(e.salud.distanciaM).toBeGreaterThan(380);
    expect(e.salud.distanciaM).toBeLessThan(420);
    expect(e.salud.umbralM).toBe(1000);
  });

  it('un umbral propio reemplaza al de la variable', () => {
    const e = Asistente.evaluarCelda(celda, datos, [req('salud', { umbralM: 300 })], UMBRALES);
    expect(e.salud.cumple).toBe(false);
    expect(e.salud.umbralM).toBe(300);
  });

  it('colegio genérico cumple si algún nivel cumple su propio umbral', () => {
    const e = Asistente.evaluarCelda(celda, datos, [req('colegio')], UMBRALES);
    expect(e.colegio.cumple).toBe(true); // el jardín está a ~300 m y el umbral inicial es 500 m
  });

  it('«colegio» genérico no cuenta secundaria: con 3 km de umbral casi todo cumpliría y no distinguiría nada', () => {
    const solo = Asistente.prepararDatos(
      { salud: [], educacion: [punto(P.lat + dLat(2000), P.lon, { amenity: 'school' }, 'Colegio a 2 km')], transporte: [], areasVerdes: [] },
      [],
      UMBRALES,
    );
    expect(Asistente.evaluarCelda(celda, solo, [req('colegio')], UMBRALES).colegio.cumple).toBe(false); // primaria: 1,5 km
    expect(Asistente.evaluarCelda(celda, solo, [req('secundaria')], UMBRALES).secundaria.cumple).toBe(true); // 3 km
  });

  it('un nivel concreto usa el umbral de su nivel', () => {
    const e = Asistente.evaluarCelda(celda, datos, [req('primaria')], UMBRALES);
    expect(e.primaria.cumple).toBe(true); // el colegio sin nivel (~1 200 m) es candidato a primaria: umbral 1 500 m
    expect(e.primaria.nombre).toBe('Colegio Lejano');
  });

  it('área verde: solo cuentan las de al menos 5 000 m²', () => {
    const e = Asistente.evaluarCelda(celda, datos, [req('areaVerde')], UMBRALES);
    expect(e.areaVerde.cumple).toBe(true);
    expect(e.areaVerde.nombre).toBe('Parque Grande'); // el parque de 900 m² no califica aunque esté más cerca
  });

  it('transporte', () => {
    const e = Asistente.evaluarCelda(celda, datos, [req('transporte')], UMBRALES);
    expect(e.transporte.cumple).toBe(true);
    expect(e.transporte.nombre).toBe('Paradero Sur');
  });

  it('criterio de zona: campiña a una distancia', () => {
    expect(Asistente.evaluarCelda(celda, datos, [req('campina')], UMBRALES).campina.cumple).toBe(true);
    const lejos = { lat: P.lat + dLat(5000), lon: P.lon, zona: 'RDB', grupo: 'residencial' };
    expect(Asistente.evaluarCelda(lejos, datos, [req('campina')], UMBRALES).campina.cumple).toBe(false);
  });

  it('criterio de zona: «residencial» exige estar en una zona residencial', () => {
    expect(Asistente.evaluarCelda(celda, datos, [req('residencial')], UMBRALES).residencial.cumple).toBe(true);
    const comercial = { ...celda, zona: 'CZ', grupo: 'comercial' };
    expect(Asistente.evaluarCelda(comercial, datos, [req('residencial')], UMBRALES).residencial.cumple).toBe(false);
  });

  it('«tranquilo» solo acepta densidad baja y media 1', () => {
    expect(Asistente.evaluarCelda({ ...celda, zona: 'RDB' }, datos, [req('tranquilo')], UMBRALES).tranquilo.cumple).toBe(true);
    expect(Asistente.evaluarCelda({ ...celda, zona: 'RDA-2' }, datos, [req('tranquilo')], UMBRALES).tranquilo.cumple).toBe(false);
  });

  it('sin datos de una variable no inventa: cumple es false y no hay distancia', () => {
    const vacios = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, [], UMBRALES);
    const e = Asistente.evaluarCelda(celda, vacios, [req('salud')], UMBRALES);
    expect(e.salud.cumple).toBe(false);
    expect(e.salud.distanciaM).toBeNull();
  });
});

// ----------------------------------------------------------------------- buscar
describe('Asistente.buscar', () => {
  const norte = P.lat + dLat(1000);
  const distritoDe = (lat: number) => (lat >= P.lat + dLat(500) ? 'NORTE' : 'SUR');
  const zonas = [zona('RDB', 'residencial', 'si', cuadrado(P.lat, P.lon, 2000))];
  const datos = Asistente.prepararDatos(
    {
      salud: [punto(norte, P.lon + dLon(1000), { amenity: 'hospital' }, 'Hospital Norte')],
      educacion: [],
      transporte: [punto(P.lat + dLat(100), P.lon + dLon(1000), { highway: 'bus_stop' }, 'Paradero Sur')],
      areasVerdes: [],
    },
    zonas,
    UMBRALES,
  );
  const req = (id: string, extra = {}) => ({ id, umbralM: null, prioridad: 1, ...extra });
  const opciones = { zonas, datos, distritoDe, umbrales: UMBRALES, pasoM: 250, minCeldas: 1 };

  it('ordena las áreas por cuánto del suelo habitable cumple lo pedido', () => {
    const r = Asistente.buscar({ ...opciones, criterios: [req('salud')] });
    expect(r.totalCeldas).toBeGreaterThan(0);
    expect(r.areas[0].nombre).toBe('NORTE');
    expect(r.areas[0].pctCumpleTodo).toBeGreaterThan(r.areas[1].pctCumpleTodo);
    expect(r.areas[0].pctCumpleTodo).toBeLessThanOrEqual(100);
  });

  it('la prioridad cambia el orden cuando los criterios se reparten entre áreas', () => {
    const sinPrioridad = Asistente.buscar({ ...opciones, criterios: [req('salud'), req('transporte')] });
    const conSalud = Asistente.buscar({ ...opciones, criterios: [req('salud', { prioridad: 2 }), req('transporte')] });
    const conTransporte = Asistente.buscar({ ...opciones, criterios: [req('salud'), req('transporte', { prioridad: 2 })] });
    expect(sinPrioridad.areas.length).toBe(2);
    expect(conSalud.areas[0].nombre).toBe('NORTE');
    expect(conTransporte.areas[0].nombre).toBe('SUR');
  });

  it('cada área trae su mejor celda para poder mostrarla en el mapa', () => {
    const r = Asistente.buscar({ ...opciones, criterios: [req('salud')] });
    const norteArea = r.areas.find((a: { nombre: string }) => a.nombre === 'NORTE');
    expect(norteArea.mejor.puntajePct).toBe(100);
    expect(norteArea.mejor.lat).toBeGreaterThanOrEqual(P.lat + dLat(500));
    expect(norteArea.mejor.detalle.salud.cumple).toBe(true);
    expect(norteArea.mejor.zona).toBe('RDB');
  });

  it('descarta áreas con muy pocas celdas para no dar una cifra engañosa', () => {
    const r = Asistente.buscar({ ...opciones, minCeldas: 10000, criterios: [req('salud')] });
    expect(r.areas).toEqual([]);
  });

  it('devuelve los mejores puntos, separados entre sí y con el detalle de cada criterio', () => {
    const r = Asistente.buscar({ ...opciones, criterios: [req('salud'), req('transporte')], maxPuntos: 3, separacionM: 600 });
    expect(r.puntos.length).toBeGreaterThan(0);
    expect(r.puntos.length).toBeLessThanOrEqual(3);
    expect(r.puntos[0].detalle.salud).toBeDefined();
    expect(r.puntos[0].puntajePct).toBeGreaterThanOrEqual(r.puntos[r.puntos.length - 1].puntajePct);
    const d = Asistente.distanciaM ? Asistente.distanciaM(r.puntos[0], r.puntos[1] || r.puntos[0]) : 600;
    expect(d).toBeGreaterThanOrEqual(r.puntos.length > 1 ? 600 : 0);
  });

  it('reutiliza las celdas ya calculadas (la cuadrícula no depende de los criterios)', () => {
    const celdas = Asistente.generarCeldas(zonas, { pasoM: 250 });
    const completo = Asistente.buscar({ ...opciones, criterios: [req('salud')] });
    const reuso = Asistente.buscar({ ...opciones, celdas, criterios: [req('salud')] });
    expect(reuso.totalCeldas).toBe(completo.totalCeldas);
    expect(reuso.areas).toEqual(completo.areas);
    const pocas = Asistente.buscar({ ...opciones, celdas: celdas.slice(0, 10), criterios: [req('salud')] });
    expect(pocas.totalCeldas).toBe(10);
  });

  it('aplica el radio alrededor de un punto también sobre celdas ya calculadas', () => {
    const celdas = Asistente.generarCeldas(zonas, { pasoM: 250 });
    const centro = { lat: P.lat + dLat(1000), lon: P.lon + dLon(1000) };
    const cerca = Asistente.buscar({ ...opciones, celdas, centro, radioM: 400, criterios: [req('salud')] });
    expect(cerca.totalCeldas).toBeGreaterThan(0);
    expect(cerca.totalCeldas).toBeLessThan(celdas.length);
  });

  it('sin criterios no busca', () => {
    expect(() => Asistente.buscar({ ...opciones, criterios: [] })).toThrow();
  });

  // Jest es unas 40 veces más lento que el navegador en cálculo numérico (2 M de haversine tardan ~6 s aquí y ~0,1 s en
  // Node), así que este límite solo comprueba que no explota. La medición real, con los datos del proyecto, está en
  // scripts/verificar-datos.mjs.
  it('con muchos datos termina en un tiempo razonable (~4 000 celdas y ~3 000 puntos)', () => {
    const grandes = [zona('RDB', 'residencial', 'si', cuadrado(P.lat, P.lon, 16000))];
    const puntos: ReturnType<typeof punto>[] = [];
    let s = 7;
    const azar = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 1500; i++) puntos.push(punto(P.lat + dLat(azar() * 16000), P.lon + dLon(azar() * 16000), { amenity: 'school' }));
    for (let i = 0; i < 1500; i++) puntos.push(punto(P.lat + dLat(azar() * 16000), P.lon + dLon(azar() * 16000), { highway: 'bus_stop' }));
    const d = Asistente.prepararDatos(
      { salud: puntos.slice(0, 150), educacion: puntos.slice(0, 1500), transporte: puntos.slice(1500), areasVerdes: [] },
      grandes,
      UMBRALES,
    );
    const t0 = Date.now();
    const r = Asistente.buscar({ zonas: grandes, datos: d, distritoDe: () => 'X', umbrales: UMBRALES, pasoM: 250, minCeldas: 1, criterios: [req('salud'), req('colegio'), req('transporte')] });
    expect(r.totalCeldas).toBeGreaterThan(3000);
    expect(Date.now() - t0).toBeLessThan(40000);
  });
});

// ---------------------------------------------------------------------- responder
describe('Asistente.responder', () => {
  const ok = (extra = {}) => ({ estado: 'CUMPLE', nombre: 'Posta Central', distanciaM: 240, umbralM: 1000, fuente: 'OpenStreetMap (ODbL)', fecha: '2026-10-28', ...extra });
  const entorno = {
    salud: ok(),
    educacion: { inicial: ok({ nombre: 'Jardín Sol', distanciaM: 150, umbralM: 500 }), primaria: ok({ nombre: 'Colegio Uno', umbralM: 1500 }), secundaria: ok({ estado: 'NO CUMPLE', nombre: 'Colegio Dos', distanciaM: 3400, umbralM: 3000 }) },
    transporte: ok({ nombre: 'Paradero A', distanciaM: 120, umbralM: 400 }),
    areaVerde: ok({ estado: 'NO CUMPLE', nombre: 'Parque B', distanciaM: 560, umbralM: 300, areaM2: 10132 }),
  };
  const ctx = {
    punto: { lat: P.lat, lon: P.lon },
    distrito: 'Cayma',
    zona: { codigo: 'RDM-1', regla: { nombre: 'Residencial densidad media tipo 1', grupo: 'residencial', edificable: 'si', pisos_base: 3, pisos_max: 4, coef_base: 2.1, coef_max: 2.8, area_libre_pct: '30-35', lote_min_m2: 90, frente_min_m: 8, nota: 'Base = unifamiliar' }, coincidencias: 1 },
    entorno,
    estadoPDM: { texto: 'El nuevo PDM no está aprobado; la zonificación puede cambiar.', fuente: 'Diario Correo', fecha: '2026-10-24', url: null },
    potencial: (regla: { coef_base: number; coef_max: number }, lote: number) => ({ construible: [lote * regla.coef_base, lote * regla.coef_max], ocupable: null, bajoLoteMinimo: false }),
  };

  it('sin punto elegido pide elegir uno antes de responder sobre «mi punto»', () => {
    const r = Asistente.responder({ tipo: 'ficha', criterios: [] }, { ...ctx, punto: null, zona: null, entorno: null });
    expect(r.texto).toMatch(/elige un punto/i);
  });

  it('los umbrales se dicen siempre en metros, igual que en la ficha', () => {
    const r = Asistente.responder({ tipo: 'ficha', criterios: [] }, ctx);
    expect(r.texto).toMatch(/referencia 1000 m/);
    expect(r.texto).toMatch(/referencia 1500 m/);
    expect(r.texto).not.toMatch(/referencia 1 km|referencia 1,5 km/);
    expect(Asistente.responder({ tipo: 'fuentes', criterios: [] }, ctx).texto).toMatch(/1500 m/);
  });

  it('ficha: resume zona y las cuatro variables con sus cifras', () => {
    const r = Asistente.responder({ tipo: 'ficha', criterios: [] }, ctx);
    expect(r.texto).toContain('RDM-1');
    expect(r.texto).toContain('Cayma');
    expect(r.texto).toMatch(/240 m/);
    expect(r.texto).toMatch(/cumple/i);
    expect(r.texto).toMatch(/no cumple/i);
    expect(r.texto).toMatch(/referencial/i);
  });

  it('zona: nombre, si es construible y los parámetros', () => {
    const r = Asistente.responder({ tipo: 'zona', criterios: [] }, ctx);
    expect(r.texto).toContain('Residencial densidad media tipo 1');
    expect(r.texto).toMatch(/pisos/i);
  });

  it('construir: con lote calcula los m² con el mismo cálculo de la ficha', () => {
    const r = Asistente.responder({ tipo: 'construir', criterios: [], lote: 200 }, ctx);
    expect(r.texto).toMatch(/420/); // 200 × 2,1
    expect(r.texto).toMatch(/560/); // 200 × 2,8
  });

  it('construir: sin lote pide el área', () => {
    const r = Asistente.responder({ tipo: 'construir', criterios: [], lote: null }, ctx);
    expect(r.texto).toMatch(/lote/i);
  });

  it('construir en una zona no construible lo dice y no calcula', () => {
    const noConstruible = { ...ctx, zona: { codigo: 'ZA', regla: { nombre: 'Zona agrícola', grupo: 'proteccion', edificable: 'no' }, coincidencias: 1 } };
    const r = Asistente.responder({ tipo: 'construir', criterios: [], lote: 200 }, noConstruible);
    expect(r.texto).toMatch(/no es construible|no se puede construir|no construible/i);
  });

  it('pdm: repite el aviso con su fuente y fecha, y aclara que no hay mapa', () => {
    const r = Asistente.responder({ tipo: 'pdm', criterios: [] }, ctx);
    expect(r.texto).toContain('Diario Correo');
    expect(r.texto).toContain('2026-10-24');
    expect(r.texto).toMatch(/no hay mapa/i);
  });

  it('servicio: contesta solo lo que se preguntó', () => {
    const r = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'transporte', umbralM: null, prioridad: 1 }] }, ctx);
    expect(r.texto).toContain('Paradero A');
    expect(r.texto).not.toContain('Posta Central');
  });

  it('servicio «colegio» cuenta los tres niveles', () => {
    const r = Asistente.responder({ tipo: 'servicio', criterios: [{ id: 'colegio', umbralM: null, prioridad: 1 }] }, ctx);
    expect(r.texto).toMatch(/inicial/i);
    expect(r.texto).toMatch(/secundaria/i);
  });

  it('fuentes: nombra las fuentes y el carácter referencial', () => {
    const r = Asistente.responder({ tipo: 'fuentes', criterios: [] }, ctx);
    expect(r.texto).toMatch(/OpenStreetMap/);
    expect(r.texto).toMatch(/PDM/);
    expect(r.texto).toMatch(/certificado/i);
  });

  it('no soportado: explica por qué no y qué sí se puede', () => {
    const r = Asistente.responder({ tipo: 'no_soportado', temaNoSoportado: 'seguridad', criterios: [] }, ctx);
    expect(r.texto).toMatch(/seguridad/i);
    expect(r.texto).toMatch(/no/i);
  });

  it('desconocido: no inventa y da ejemplos de lo que sí entiende', () => {
    const r = Asistente.responder({ tipo: 'desconocido', criterios: [] }, ctx);
    expect(r.texto).toMatch(/no entend/i);
    expect(r.sugerencias.length).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------- formatearBusqueda
describe('Asistente.formatearBusqueda', () => {
  const resultado = {
    criterios: [{ id: 'colegio', umbralM: null, prioridad: 1, umbralEfectivoM: null }, { id: 'areaVerde', umbralM: null, prioridad: 2, umbralEfectivoM: 300 }],
    totalCeldas: 1200,
    pasoM: 250,
    areas: [
      { nombre: 'CAYMA', celdas: 300, pctCumpleTodo: 62.4, puntajePct: 81.2, porCriterio: { colegio: 90, areaVerde: 70 } },
      { nombre: 'MIRAFLORES', celdas: 120, pctCumpleTodo: 10, puntajePct: 40, porCriterio: { colegio: 50, areaVerde: 30 } },
    ],
    puntos: [{ lat: P.lat, lon: P.lon, distrito: 'CAYMA', zona: 'RDB', puntajePct: 100, detalle: { colegio: { cumple: true, distanciaM: 200, nombre: 'Colegio Uno' }, areaVerde: { cumple: true, distanciaM: 120, nombre: 'Parque A' } } }],
  };

  it('no habla de porcentajes ni de probabilidad: habla de sectores', () => {
    const f = Asistente.formatearBusqueda(resultado, { aproximados: [], temaNoSoportado: null, radioGlobalM: null });
    expect(f.texto).toMatch(/sector/i);
    expect(f.texto).not.toMatch(/%|probabilidad|ponderad/i);
  });

  it('deja claro que es referencial', () => {
    const f = Asistente.formatearBusqueda(resultado, { aproximados: [], temaNoSoportado: null, radioGlobalM: null });
    expect(f.texto).toMatch(/referencial/i);
  });

  it('declara las aproximaciones y los temas sin datos', () => {
    const f = Asistente.formatearBusqueda(resultado, { aproximados: ['tranquilo'], temaNoSoportado: 'seguridad', radioGlobalM: 1000 });
    expect(f.texto).toMatch(/tranquil/i);
    expect(f.texto).toMatch(/aproxim/i);
    expect(f.texto).toMatch(/seguridad/i);
    expect(f.texto).toMatch(/1 km/); // la distancia que dio la persona se repite en palabras llanas
  });

  it('el aviso de aproximación concuerda en número y solo menciona los datos que faltan de lo pedido', () => {
    const uno = Asistente.formatearBusqueda(resultado, { aproximados: ['tranquilo'], temaNoSoportado: null, radioGlobalM: null });
    expect(uno.texto).toMatch(/es una aproximación/);
    expect(uno.texto).toMatch(/ruido/);
    expect(uno.texto).not.toMatch(/centros comerciales/);
    const dos = Asistente.formatearBusqueda(resultado, { aproximados: ['tranquilo', 'comercial'], temaNoSoportado: null, radioGlobalM: null });
    expect(dos.texto).toMatch(/son aproximaciones/);
    expect(dos.texto).toMatch(/ruido/);
    expect(dos.texto).toMatch(/centros comerciales/);
  });

  it('sin áreas lo dice y sugiere aflojar los criterios', () => {
    const f = Asistente.formatearBusqueda({ ...resultado, areas: [], puntos: [] }, { aproximados: [], temaNoSoportado: null, radioGlobalM: null });
    expect(f.texto).toMatch(/ninguna|no encontr/i);
    expect(f.sugerencias.length).toBeGreaterThan(0);
  });
});
