/**
 * Pruebas del asistente con quebradas, sismos y peligros: preguntas sobre el punto (siempre con fuente y límites, nunca como
 * evaluación de peligro) y el criterio de búsqueda «lejos de quebradas y ríos» con la distancia mínima que fija la persona.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number, lat: number) => m / (M_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180));
const P = { lat: -16.409, lon: -71.5375 };
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
const UMBRALES = {
  salud: 1000, educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, zona: { campina: 500, comercial: 600, historico: 800 },
};

type Crit = { id: string; umbralM: number | null; prioridad: number };
const por = (r: { criterios: Crit[] }) => Object.fromEntries(r.criterios.map((c) => [c.id, c]));

describe('Asistente.interpretar: quebradas, sismos y peligros', () => {
  it('«¿hay una quebrada cerca?» es una pregunta sobre el punto, no una búsqueda', () => {
    ['¿hay una quebrada cerca de mi punto?', 'hay torrenteras por aquí', 'a cuánto está el río', '¿pasa un cauce cerca?', 'hay riesgo de huaico'].forEach((f) => {
      expect(Asistente.interpretar(f, { hayPunto: true }).tipo).toBe('quebrada');
    });
  });

  it('«sismos» y «temblores» preguntan por la actividad sísmica', () => {
    ['¿cuántos sismos hubo cerca?', 'temblores en la zona', 'sismicidad del punto'].forEach((f) => expect(Asistente.interpretar(f).tipo).toBe('sismos'));
  });

  it('«peligros» y «deslizamientos» preguntan por el inventario geológico', () => {
    ['¿hay peligros cerca de mi punto?', 'derrumbes registrados', 'peligros geológicos'].forEach((f) => expect(Asistente.interpretar(f).tipo).toBe('peligros'));
  });

  it('«peligroso» y «seguro» siguen siendo seguridad ciudadana (sin datos), no peligros geológicos', () => {
    const r = Asistente.interpretar('¿es peligroso este barrio?');
    expect(r.tipo).toBe('no_soportado');
    expect(r.temaNoSoportado).toBe('seguridad');
  });

  it('«lejos de quebradas a más de 200 m» es una búsqueda con su distancia mínima propia', () => {
    const r = Asistente.interpretar('busco una zona lejos de quebradas a más de 200 m');
    expect(r.tipo).toBe('buscar');
    expect(por(r).lejosQuebrada).toMatchObject({ umbralM: 200, prioridad: 1 });
    expect(r.radioGlobalM).toBeNull();
  });

  it('esa distancia no se confunde con el radio de los demás criterios', () => {
    const r = Asistente.interpretar('busco cerca de un colegio y lejos de las quebradas a más de 300 m');
    expect(por(r).lejosQuebrada.umbralM).toBe(300);
    expect(por(r).colegio.umbralM).toBeNull();
    expect(r.radioGlobalM).toBeNull();
  });

  it('con otra distancia para otro criterio, cada una va a su criterio', () => {
    const r = Asistente.interpretar('busco colegio a 500 m y lejos de quebradas a más de 200 m');
    expect(por(r).lejosQuebrada.umbralM).toBe(200);
    expect(r.radioGlobalM).toBe(500);
  });

  it('sin distancia queda sin umbral: no se inventa uno, se pide', () => {
    const r = Asistente.interpretar('busco una zona lejos de quebradas');
    expect(por(r).lejosQuebrada.umbralM).toBeNull();
    expect(Asistente.criteriosSinUmbral(r.criterios)).toEqual(['lejosQuebrada']);
  });

  it('criteriosSinUmbral ignora los criterios que sí tienen distancia o no la necesitan', () => {
    expect(Asistente.criteriosSinUmbral([{ id: 'salud', umbralM: null }, { id: 'lejosQuebrada', umbralM: 100 }])).toEqual([]);
    expect(Asistente.criteriosSinUmbral([{ id: 'lejosQuebrada', umbralM: 0 }])).toEqual(['lejosQuebrada']);
    expect(Asistente.criteriosSinUmbral(undefined)).toEqual([]);
  });

  it('«¿estoy lejos de una quebrada?» sobre mi punto es una pregunta', () => {
    expect(Asistente.interpretar('¿estoy lejos de una quebrada en mi punto?', { hayPunto: true }).tipo).toBe('quebrada');
  });
});

describe('Asistente.construirConsulta con «lejos de quebradas»', () => {
  const por2 = (q: { criterios: Crit[] }) => por(q);

  it('la distancia del menú agrega el criterio con su umbral, igual que escribirlo', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud'], lejosQuebradaM: 200 });
    expect(por2(q).lejosQuebrada).toEqual({ id: 'lejosQuebrada', umbralM: 200, prioridad: 1 });
    const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
    expect(por(vuelta).lejosQuebrada.umbralM).toBe(200);
    expect(por(vuelta).salud).toBeDefined();
    expect(vuelta.radioGlobalM).toBeNull();
  });

  it('se puede priorizar y se entiende de ida y vuelta', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud', 'areaVerde'], lejosQuebradaM: 300, prioridades: ['lejosQuebrada'], radioM: 1000 });
    const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
    expect(por(vuelta).lejosQuebrada).toMatchObject({ umbralM: 300, prioridad: 2 });
    expect(vuelta.radioGlobalM).toBe(1000);
  });

  it('cada distancia del menú se entiende al escribirla', () => {
    Asistente.OPCIONES.cauces.filter((m: number | null) => m !== null).forEach((m: number) => {
      const q = Asistente.construirConsulta({ criterios: ['salud'], lejosQuebradaM: m });
      expect(por(Asistente.interpretar(Asistente.textoDeConsulta(q))).lejosQuebrada.umbralM).toBe(m);
    });
  });

  it('una distancia inválida no agrega el criterio', () => {
    [0, -1, NaN, 'x', null].forEach((m) => {
      expect(Asistente.construirConsulta({ criterios: ['salud'], lejosQuebradaM: m as never }).criterios.map((c: Crit) => c.id)).toEqual(['salud']);
    });
  });

  it('solo con la distancia (sin otros criterios) ya es una búsqueda válida', () => {
    expect(Asistente.construirConsulta({ lejosQuebradaM: 200 }).tipo).toBe('buscar');
  });
});

describe('Asistente.buscar con «lejos de quebradas»', () => {
  // Zona de 2 km con un cauce vertical a 500 m al este del suroeste: las celdas cercanas al cauce no cumplen.
  const zonas = [{ codigo: 'RDB', color: '#999', bbox: bboxDe(cuadrado(P.lat, P.lon, 2000)), polys: [[cuadrado(P.lat, P.lon, 2000)]], regla: { nombre: 'Z', grupo: 'residencial', edificable: 'si' } }];
  const cauce = { nombre: 'Quebrada Prueba', geometry: { type: 'LineString', coordinates: [[P.lon + dLon(500, P.lat), P.lat - 0.02], [P.lon + dLon(500, P.lat), P.lat + 0.05]] } };
  const datos = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [], cauces: [cauce] }, zonas, UMBRALES);
  const base = { zonas, datos, umbrales: UMBRALES, distritoDe: () => 'D', pasoM: 250, minCeldas: 1 };
  const req = (m: number | null) => ({ id: 'lejosQuebrada', umbralM: m, prioridad: 1 });

  it('una celda cumple solo si el cauce está a esa distancia mínima o más lejos', () => {
    const lejos = Asistente.evaluarCelda({ lat: P.lat + 0.005, lon: P.lon, zona: 'RDB', grupo: 'residencial' }, datos, [req(300)], UMBRALES);
    expect(lejos.lejosQuebrada).toMatchObject({ cumple: true, umbralM: 300 });
    const cerca = Asistente.evaluarCelda({ lat: P.lat + 0.005, lon: P.lon + dLon(400, P.lat), zona: 'RDB', grupo: 'residencial' }, datos, [req(300)], UMBRALES);
    expect(cerca.lejosQuebrada.cumple).toBe(false);
    expect(cerca.lejosQuebrada.distanciaM).toBeCloseTo(100, 0);
    expect(cerca.lejosQuebrada.nombre).toBe('Quebrada Prueba');
  });

  it('el radio global de la búsqueda no cambia la distancia mínima', () => {
    const ev = Asistente.evaluarCelda({ lat: P.lat + 0.005, lon: P.lon, zona: 'RDB', grupo: 'residencial' }, datos, [req(300)], UMBRALES, 1000);
    expect(ev.lejosQuebrada.umbralM).toBe(300);
  });

  it('sin cauces cargados no cumple y lo marca como sin dato (la ausencia de datos no es «estás lejos»)', () => {
    const vacio = Asistente.prepararDatos({ salud: [], educacion: [], transporte: [], areasVerdes: [] }, zonas, UMBRALES);
    const ev = Asistente.evaluarCelda({ lat: P.lat, lon: P.lon, zona: 'RDB', grupo: 'residencial' }, vacio, [req(300)], UMBRALES);
    expect(ev.lejosQuebrada).toMatchObject({ cumple: false, distanciaM: null, sinDato: true });
  });

  it('la búsqueda calcula el porcentaje que cumple y es menor al 100 % con un cauce dentro de la zona', () => {
    const r = Asistente.buscar({ ...base, criterios: [req(300)] });
    expect(r.areas[0].pctCumpleTodo).toBeGreaterThan(0);
    expect(r.areas[0].pctCumpleTodo).toBeLessThan(100);
    expect(r.criterios[0].umbralEfectivoM).toBe(300);
  });

  it('una distancia mayor deja menos suelo que cumple', () => {
    const a = Asistente.buscar({ ...base, criterios: [req(200)] }).areas[0].pctCumpleTodo;
    const b = Asistente.buscar({ ...base, criterios: [req(800)] }).areas[0].pctCumpleTodo;
    expect(b).toBeLessThan(a);
  });

  it('el mejor punto está lejos del cauce y cumple', () => {
    const r = Asistente.buscar({ ...base, criterios: [req(300)] });
    expect(r.areas[0].mejor.detalle.lejosQuebrada.cumple).toBe(true);
    expect(r.puntos[0].detalle.lejosQuebrada.cumple).toBe(true);
  });

  it('sin la distancia mínima falla con un mensaje que la pide (no usa un valor por defecto)', () => {
    expect(() => Asistente.buscar({ ...base, criterios: [req(null)] })).toThrow(/distancia mínima/);
  });

  it('el texto del resultado dice «a más de» y advierte los límites de los cauces', () => {
    const r = Asistente.buscar({ ...base, criterios: [req(300)] });
    const f = Asistente.formatearBusqueda(r, { aproximados: [], temaNoSoportado: null, radioGlobalM: null });
    expect(f.texto).toContain('a más de 300 m de una quebrada o río');
    expect(f.texto).not.toMatch(/a 300 m o menos/);
    expect(f.texto).toMatch(/no incluyen todas las quebradas urbanas/);
    expect(f.texto).toMatch(/no son un mapa de peligro/);
    expect(f.texto).toMatch(/faja marginal/);
  });

  it('describirCriterio dice «a más de»', () => {
    expect(Asistente.describirCriterio(req(200), UMBRALES, null)).toBe('Lejos de quebradas y ríos a más de 200 m');
  });
});

describe('Asistente.responder: quebradas, sismos y peligros del punto', () => {
  const punto = { lat: P.lat, lon: P.lon };
  const cauce = (extra = {}) => ({
    estado: 'INFORMATIVO', nombre: 'Quebrada El Cuico', tipo: 'Quebrada', distanciaM: 180, umbralM: null, segunUmbralUsuario: false,
    fuenteId: 'IGP', fuenteCorta: 'IGP', alias: [], fuentes: [{ id: 'ANA', registros: 14 }, { id: 'IGP', registros: 231 }, { id: 'OSM', registros: 20 }],
    ausentes: [{ nombre: 'Cabreria', registros: 10 }, { nombre: 'Pajonal', registros: 4 }], ...extra,
  });
  const sismos = (extra = {}) => ({ estado: 'INFORMATIVO', total: 12, radioM: 100000, magnitudMaxima: 4.8, desde: '2026-01-01', hasta: '2026-11-02', ...extra });
  const peligros = (extra = {}) => ({ estado: 'INFORMATIVO', total: 3, radioM: 500, distanciaM: 120, masCercano: { tipo: 'Flujos', subtipo: 'Flujo de detritos' }, ...extra });

  it('sin punto pide elegirlo', () => {
    expect(Asistente.responder({ tipo: 'quebrada', criterios: [] }, {}).texto).toMatch(/elige un punto/i);
    expect(Asistente.responder({ tipo: 'sismos', criterios: [] }, {}).texto).toMatch(/elige un punto/i);
  });

  it('quebrada: dice el cauce y la distancia en línea recta, que no hay distancia normativa y los límites', () => {
    const r = Asistente.responder({ tipo: 'quebrada', criterios: [] }, { punto, cauce: cauce() });
    expect(r.texto).toContain('Quebrada El Cuico');
    expect(r.texto).toContain('180 m en línea recta');
    expect(r.texto).toMatch(/No existe una distancia normativa/);
    expect(r.texto).toMatch(/ninguna fuente es completa/);
    expect(r.texto).toMatch(/mapa de peligro/);
    expect(r.texto).toMatch(/Mis umbrales/);
    expect(r.texto).not.toMatch(/\bcumple\b/i);
  });

  it('quebrada nombra la fuente del cauce, las fuentes del archivo y lo que todavía no figura', () => {
    const r = Asistente.responder({ tipo: 'quebrada', criterios: [] }, { punto, cauce: cauce() });
    expect(r.texto).toContain('(fuente: IGP)');
    expect(r.texto).toContain('ANA (14 tramos), IGP (231 tramos) y OpenStreetMap (20 tramos)');
    expect(r.texto).toContain('todavía no figuran Cabreria (10 registros de INGEMMET), Pajonal (4 registros de INGEMMET)');
  });

  it('quebrada dice cómo más figura el cauce cuando otra fuente lo llama distinto', () => {
    const r = Asistente.responder({ tipo: 'quebrada', criterios: [] }, { punto, cauce: cauce({ nombre: 'Quebrada Estanquillo', alias: [{ nombre: 'Quebrada Añashuayco', fuente: 'OSM' }] }) });
    expect(r.texto).toContain('También figura como Quebrada Añashuayco.');
  });

  it('quebrada con el umbral del usuario dice «según tu umbral»', () => {
    const r = Asistente.responder({ tipo: 'quebrada', criterios: [] }, { punto, cauce: cauce({ estado: 'NO CUMPLE', umbralM: 250, segunUmbralUsuario: true }) });
    expect(r.texto).toMatch(/Según tu umbral \(al menos 250 m de un cauce\): no cumple/);
    expect(r.texto).not.toMatch(/No existe una distancia normativa/);
  });

  it('quebrada sin dato no inventa nada', () => {
    const r = Asistente.responder({ tipo: 'quebrada', criterios: [] }, { punto, cauce: cauce({ estado: 'SIN DATO', distanciaM: null, nombre: null, error: 'archivo ausente' }) });
    expect(r.texto).toMatch(/No tengo el dato de quebradas/);
    expect(r.texto).not.toMatch(/180/);
  });

  it('sismos: cuántos, magnitud máxima, el periodo y que no es predicción', () => {
    const r = Asistente.responder({ tipo: 'sismos', criterios: [] }, { punto, sismos: sismos() });
    expect(r.texto).toContain('12 sismos');
    expect(r.texto).toContain('100 km');
    expect(r.texto).toContain('2026-01-01');
    expect(r.texto).toContain('2026-11-02');
    expect(r.texto).toContain('4,8');
    expect(r.texto).toMatch(/no predice/);
    expect(r.texto).toMatch(/E\.030/);
  });

  it('sismos con cero registros dice «0 sismos», no que no hay dato', () => {
    const r = Asistente.responder({ tipo: 'sismos', criterios: [] }, { punto, sismos: sismos({ total: 0, magnitudMaxima: null }) });
    expect(r.texto).toContain('0 sismos');
    expect(r.texto).not.toMatch(/No tengo/);
  });

  it('peligros: cuántos, el más cercano y que un inventario vacío no significa seguridad', () => {
    const r = Asistente.responder({ tipo: 'peligros', criterios: [] }, { punto, peligros: peligros() });
    expect(r.texto).toContain('3 peligros geológicos registrados a 500 m');
    expect(r.texto).toContain('120 m en línea recta');
    expect(r.texto).toMatch(/flujo de detritos/);
    expect(r.texto).toMatch(/no significa que el lugar sea seguro/);
    expect(r.texto).toMatch(/no una evaluación de peligro/);
  });

  it('peligros sin dato no afirma nada', () => {
    const r = Asistente.responder({ tipo: 'peligros', criterios: [] }, { punto, peligros: peligros({ estado: 'SIN DATO', total: null, error: 'x' }) });
    expect(r.texto).toMatch(/No tengo el inventario/);
  });

  it('mientras calcula, lo dice en vez de responder a medias', () => {
    ['quebrada', 'sismos', 'peligros'].forEach((tipo) => {
      expect(Asistente.responder({ tipo, criterios: [] }, { punto }).texto).toMatch(/Todavía estoy calculando/);
    });
  });
});

describe('Asistente.explicar: quebradas, sismos y peligros', () => {
  it('traen por qué, fuente y límites', () => {
    ['quebrada', 'sismos', 'peligros'].forEach((tipo) => {
      const e = Asistente.explicar(tipo);
      expect(e.porque.length).toBeGreaterThan(0);
      expect(e.fuente.length).toBeGreaterThan(0);
      expect(e.limites.length).toBeGreaterThan(0);
    });
  });

  it('quebrada: cita la ANA y aclara que no hay distancia normativa ni faja marginal', () => {
    const t = JSON.stringify(Asistente.explicar('quebrada')).toLowerCase();
    expect(t).toContain('autoridad nacional del agua');
    expect(t).toContain('no existe una distancia normativa');
    expect(t).toContain('faja marginal');
  });

  it('sismos: cita el IGP y aclara que no es predicción', () => {
    const t = JSON.stringify(Asistente.explicar('sismos')).toLowerCase();
    expect(t).toContain('instituto geofísico');
    expect(t).toContain('no una predicción');
  });

  it('una búsqueda con quebradas suma el límite de los cauces', () => {
    expect(JSON.stringify(Asistente.explicar('buscar', { cauce: true }))).toContain('faltan quebradas urbanas');
    expect(JSON.stringify(Asistente.explicar('buscar', {}))).not.toContain('quebradas urbanas');
  });
});
