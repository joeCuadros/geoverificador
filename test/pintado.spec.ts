/**
 * Pruebas de public/js/pintado.js: pintar el mapa según el criterio que eligió la persona. Es lógica pura: clasifica cada
 * celda de la cuadrícula en cumple / no cumple / sin dato con los MISMOS cálculos del asistente, combina varios criterios
 * como intersección («cumple todos»), cuenta cuántas celdas cumplen y arma la leyenda con su umbral y su fuente.
 * Nunca hay un puntaje global ni una «mejor zona».
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Pintado = require('../public/js/pintado.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const BASE = { lat: -16.409, lon: -71.5375 };

const UMBRALES = {
  salud: 1000,
  educacion: { inicial: 500, primaria: 1500, secundaria: 3000 },
  transporte: 400,
  areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 },
  zona: { campina: 500, comercial: 600, historico: 800 },
};
const CONFIG_FALSO = {
  umbrales: UMBRALES,
  fuentesUmbral: {
    salud: 'Convención del proyecto',
    educacion: 'MEF/MINEDU, Instructivo FTE, Cuadro N.° 1 (RVM 104-2019-MINEDU y 208-2019-MINEDU)',
    transporte: 'Convención del proyecto',
    areaVerde: 'Indicador básico de la OMS Europa (2016): un espacio verde de al menos 0,5 ha a 300 m en línea recta',
  },
  asistente: { umbralesZona: { campina: 500, comercial: 600, historico: 800 } },
};

const punto = (lat: number, lon: number, tags: Record<string, string>) => ({
  type: 'Feature',
  properties: { osm: `node/${Math.round(lat * 1e5)}`, nombre: 'X', tags },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});
// Una celda al norte de la base a `m` metros
const celdaA = (m: number) => ({ lat: BASE.lat + dLat(m), lon: BASE.lon, zona: 'RDM-1', grupo: 'residencial' });

describe('Pintado.chips', () => {
  it('lista los criterios del asistente en un orden estable: servicios y luego zonas', () => {
    const ids = Pintado.chips({}).map((c: any) => c.id);
    expect(ids).toEqual(['salud', 'inicial', 'primaria', 'secundaria', 'colegio', 'transporte', 'areaVerde', 'residencial', 'tranquilo', 'campina', 'comercial', 'historico']);
  });
  it('cada chip es un criterio que el asistente ya entiende', () => {
    Pintado.chips({ distanciaQuebradaM: 200 }).forEach((c: any) => expect(Asistente.CRITERIOS[c.id]).toBeDefined());
  });
  it('«lejos de quebradas» solo aparece si la persona dio una distancia', () => {
    expect(Pintado.chips({}).some((c: any) => c.id === 'lejosQuebrada')).toBe(false);
    expect(Pintado.chips({ distanciaQuebradaM: null }).some((c: any) => c.id === 'lejosQuebrada')).toBe(false);
    expect(Pintado.chips({ distanciaQuebradaM: 0 }).some((c: any) => c.id === 'lejosQuebrada')).toBe(false);
    const con = Pintado.chips({ distanciaQuebradaM: 200 });
    expect(con[con.length - 1].id).toBe('lejosQuebrada');
    expect(con[con.length - 1].etiqueta).toContain('200 m');
  });
  it('las etiquetas son cortas y no repiten el paréntesis largo del asistente', () => {
    const e = Object.fromEntries(Pintado.chips({}).map((c: any) => [c.id, c.etiqueta]));
    expect(e.colegio).toBe('Colegio');
    expect(e.tranquilo).toBe('Zona tranquila');
    expect(e.areaVerde).toBe('Área verde');
    expect(e.campina).toBe('Campiña');
  });
  it('separa los grupos servicio y zona', () => {
    const g = Object.fromEntries(Pintado.chips({ distanciaQuebradaM: 100 }).map((c: any) => [c.id, c.grupo]));
    expect(g.salud).toBe('servicio');
    expect(g.residencial).toBe('zona');
    expect(g.lejosQuebrada).toBe('cauce');
  });
});

describe('Pintado.clasificar', () => {
  it('cumple y no cumple vienen del cálculo del asistente', () => {
    expect(Pintado.clasificar({ cumple: true, distanciaM: 100 })).toBe('cumple');
    expect(Pintado.clasificar({ cumple: false, distanciaM: 5000 })).toBe('nocumple');
  });
  it('sin dato es un estado propio: nunca es «cumple» ni cero', () => {
    expect(Pintado.clasificar({ cumple: false, distanciaM: null, sinDato: true })).toBe('sindato');
    expect(Pintado.clasificar({ cumple: false, distanciaM: null }, false)).toBe('sindato');
    // aunque el cálculo dijera cumple, sin datos de base no se afirma nada
    expect(Pintado.clasificar({ cumple: true, distanciaM: 0 }, false)).toBe('sindato');
  });
  it('un elemento ausente con datos disponibles es «no cumple», no «sin dato»', () => {
    expect(Pintado.clasificar({ cumple: false, distanciaM: null }, true)).toBe('nocumple');
  });
});

describe('Pintado.combinar (intersección)', () => {
  it('cumple solo si todos cumplen', () => {
    expect(Pintado.combinar(['cumple', 'cumple'])).toBe('cumple');
  });
  it('si alguno no cumple, no cumple, aunque otro sea sin dato', () => {
    expect(Pintado.combinar(['cumple', 'nocumple'])).toBe('nocumple');
    expect(Pintado.combinar(['sindato', 'nocumple'])).toBe('nocumple');
  });
  it('si ninguno falla pero alguno es sin dato, no se puede afirmar: sin dato', () => {
    expect(Pintado.combinar(['cumple', 'sindato'])).toBe('sindato');
  });
  it('una lista vacía no afirma nada', () => {
    expect(Pintado.combinar([])).toBe('sindato');
  });
});

describe('Pintado.hayDatos', () => {
  const datos = Asistente.prepararDatos(
    { salud: [punto(BASE.lat, BASE.lon, { amenity: 'clinic' })], educacion: [punto(BASE.lat, BASE.lon, { amenity: 'kindergarten' })], transporte: [], areasVerdes: [], cauces: [] },
    [],
    UMBRALES,
  );
  it('sabe qué base tiene cada criterio', () => {
    expect(Pintado.hayDatos('salud', datos)).toBe(true);
    expect(Pintado.hayDatos('inicial', datos)).toBe(true);
    expect(Pintado.hayDatos('colegio', datos)).toBe(true); // inicial o primaria
    expect(Pintado.hayDatos('primaria', datos)).toBe(false);
    expect(Pintado.hayDatos('transporte', datos)).toBe(false);
    expect(Pintado.hayDatos('areaVerde', datos)).toBe(false);
    expect(Pintado.hayDatos('lejosQuebrada', datos)).toBe(false);
  });
  it('las zonas salen del plano: siempre hay base', () => {
    expect(Pintado.hayDatos('residencial', datos)).toBe(true);
    expect(Pintado.hayDatos('campina', datos)).toBe(true);
  });
});

describe('Pintado.evaluar', () => {
  const datos = Asistente.prepararDatos(
    { salud: [punto(BASE.lat + dLat(300), BASE.lon, { amenity: 'clinic' })], educacion: [], transporte: [], areasVerdes: [], cauces: [] },
    [],
    UMBRALES,
  );
  const celdas = [celdaA(0), celdaA(900), celdaA(3000)]; // a 300 m, 600 m y 2700 m de la clínica

  it('un criterio: cumple dentro del umbral de la ficha y no cumple fuera', () => {
    const r = Pintado.evaluar({ celdas, datos, criterios: [{ id: 'salud', umbralM: null, prioridad: 1 }], umbrales: UMBRALES, radioGlobalM: null });
    expect(r.estados).toEqual(['cumple', 'cumple', 'nocumple']);
    expect(r.resumen).toEqual({ total: 3, cumple: 2, nocumple: 1, sindato: 0 });
  });
  it('una distancia elegida por la persona reemplaza el umbral de la ficha', () => {
    const r = Pintado.evaluar({ celdas, datos, criterios: [{ id: 'salud', umbralM: null, prioridad: 1 }], umbrales: UMBRALES, radioGlobalM: 400 });
    expect(r.estados).toEqual(['cumple', 'nocumple', 'nocumple']);
  });
  it('sin datos de un servicio, toda celda es «sin dato» (no «no cumple»)', () => {
    const r = Pintado.evaluar({ celdas, datos, criterios: [{ id: 'transporte', umbralM: null, prioridad: 1 }], umbrales: UMBRALES, radioGlobalM: null });
    expect(r.estados).toEqual(['sindato', 'sindato', 'sindato']);
    expect(r.resumen.cumple).toBe(0);
    expect(r.resumen.sindato).toBe(3);
  });
  it('varios criterios: intersección, con el conteo propio de cada uno', () => {
    const r = Pintado.evaluar({
      celdas, datos,
      criterios: [{ id: 'salud', umbralM: null, prioridad: 1 }, { id: 'residencial', umbralM: null, prioridad: 1 }],
      umbrales: UMBRALES, radioGlobalM: null,
    });
    expect(r.estados).toEqual(['cumple', 'cumple', 'nocumple']);
    expect(r.porCriterio.salud).toEqual({ total: 3, cumple: 2, nocumple: 1, sindato: 0 });
    expect(r.porCriterio.residencial).toEqual({ total: 3, cumple: 3, nocumple: 0, sindato: 0 });
  });
  it('la prioridad no cambia nada: pintar no pondera ni da puntaje', () => {
    const a = Pintado.evaluar({ celdas, datos, criterios: [{ id: 'salud', umbralM: null, prioridad: 2 }, { id: 'residencial', umbralM: null, prioridad: 1 }], umbrales: UMBRALES, radioGlobalM: null });
    const b = Pintado.evaluar({ celdas, datos, criterios: [{ id: 'salud', umbralM: null, prioridad: 1 }, { id: 'residencial', umbralM: null, prioridad: 1 }], umbrales: UMBRALES, radioGlobalM: null });
    expect(a.estados).toEqual(b.estados);
    expect(JSON.stringify(a)).not.toMatch(/puntaje|mejor/i);
  });
  it('«lejos de quebradas» sin cauces cargados es sin dato, nunca «estás lejos»', () => {
    const r = Pintado.evaluar({ celdas, datos, criterios: [{ id: 'lejosQuebrada', umbralM: 200, prioridad: 1 }], umbrales: UMBRALES, radioGlobalM: null });
    expect(r.estados).toEqual(['sindato', 'sindato', 'sindato']);
  });
  it('sin criterios no hay nada que pintar', () => {
    const r = Pintado.evaluar({ celdas, datos, criterios: [], umbrales: UMBRALES, radioGlobalM: null });
    expect(r.estados).toEqual([]);
    expect(r.resumen.total).toBe(0);
  });
});

describe('Pintado.criteriosDe', () => {
  it('arma criterios con prioridad neutra y conserva la distancia propia de los que ya estaban', () => {
    const previos = [{ id: 'salud', umbralM: 700, prioridad: 2 }];
    const c = Pintado.criteriosDe(['salud', 'transporte'], { previos });
    expect(c).toEqual([{ id: 'salud', umbralM: 700, prioridad: 1 }, { id: 'transporte', umbralM: null, prioridad: 1 }]);
  });
  it('«lejos de quebradas» lleva la distancia de la persona y se descarta si no hay', () => {
    expect(Pintado.criteriosDe(['lejosQuebrada'], { distanciaQuebradaM: 300 })).toEqual([{ id: 'lejosQuebrada', umbralM: 300, prioridad: 1 }]);
    expect(Pintado.criteriosDe(['lejosQuebrada', 'salud'], {})).toEqual([{ id: 'salud', umbralM: null, prioridad: 1 }]);
  });
  it('ignora ids que el asistente no conoce y repetidos', () => {
    expect(Pintado.criteriosDe(['inventado', 'salud', 'salud'], {}).map((c: any) => c.id)).toEqual(['salud']);
  });
});

describe('Pintado.fmtMiles y textoResumen', () => {
  it('separa los miles con un espacio que no se parte', () => {
    expect(Pintado.fmtMiles(2358)).toBe('2 358');
    expect(Pintado.fmtMiles(950)).toBe('950');
    expect(Pintado.fmtMiles(16780)).toBe('16 780');
  });
  it('dice «N de T celdas cumplen» con un criterio', () => {
    const t = Pintado.textoResumen({ total: 2358, cumple: 1200, nocumple: 1100, sindato: 58 }, [{ id: 'salud' }]);
    expect(t).toBe('1 200 de 2 358 celdas cumplen Salud.');
  });
  it('con varios criterios dice que cumplen todos y los nombra', () => {
    const t = Pintado.textoResumen({ total: 2358, cumple: 410, nocumple: 1900, sindato: 48 }, [{ id: 'salud' }, { id: 'areaVerde' }]);
    expect(t).toBe('410 de 2 358 celdas cumplen todos: Salud y Área verde.');
  });
  it('nunca habla de la mejor zona ni de puntaje', () => {
    const t = Pintado.textoResumen({ total: 10, cumple: 0, nocumple: 10, sindato: 0 }, [{ id: 'salud' }]);
    expect(t).not.toMatch(/mejor|puntaje|recomend/i);
    expect(t).toBe('0 de 10 celdas cumplen Salud.');
  });
});

describe('Pintado.leyenda', () => {
  const leyenda = (criterios: any[], extra: any = {}) => Pintado.leyenda({ criterios, umbrales: UMBRALES, radioGlobalM: null, config: CONFIG_FALSO, ...extra });

  it('los tres estados llevan icono, texto y un patrón distinto: no dependen solo del color', () => {
    const l = leyenda([{ id: 'salud', umbralM: null, prioridad: 1 }]);
    expect(l.estados.map((e: any) => e.id)).toEqual(['cumple', 'nocumple', 'sindato']);
    expect(l.estados.map((e: any) => e.texto)).toEqual(['Cumple', 'No cumple', 'Sin dato']);
    expect(l.estados.map((e: any) => e.icono)).toEqual(['cumple', 'nocumple', 'sindato']);
    expect(new Set(l.estados.map((e: any) => e.patron)).size).toBe(3);
  });
  it('sin dato se explica: no significa que no exista', () => {
    const l = leyenda([{ id: 'salud', umbralM: null, prioridad: 1 }]);
    expect(l.estados[2].explicacion).toMatch(/no significa que no exista/i);
  });
  it('colegios: 500, 1500 y 3000 m del MINEDU', () => {
    const f = leyenda([{ id: 'inicial' }, { id: 'primaria' }, { id: 'secundaria' }].map((c) => ({ ...c, umbralM: null, prioridad: 1 }))).filas;
    expect(f[0].descripcion).toContain('500 m');
    expect(f[1].descripcion).toContain('1500 m');
    expect(f[2].descripcion).toContain('3000 m');
    f.forEach((x: any) => expect(x.fuente).toMatch(/MINEDU/));
  });
  it('área verde: 300 m con la fuente OMS', () => {
    const f = leyenda([{ id: 'areaVerde', umbralM: null, prioridad: 1 }]).filas[0];
    expect(f.descripcion).toContain('300 m');
    expect(f.fuente).toMatch(/OMS/);
  });
  it('salud y transporte son convención del proyecto, dicho tal cual', () => {
    const f = leyenda([{ id: 'salud', umbralM: null, prioridad: 1 }, { id: 'transporte', umbralM: null, prioridad: 1 }]).filas;
    expect(f[0].descripcion).toContain('1000 m');
    expect(f[0].fuente).toMatch(/convención del proyecto/i);
    expect(f[1].descripcion).toContain('400 m');
    expect(f[1].fuente).toMatch(/convención del proyecto/i);
  });
  it('si la persona fijó la distancia, la fuente es ella, no una norma', () => {
    const f = leyenda([{ id: 'salud', umbralM: null, prioridad: 1 }], { radioGlobalM: 800 }).filas[0];
    expect(f.descripcion).toContain('800 m');
    expect(f.fuente).toMatch(/elegiste/i);
    const g = leyenda([{ id: 'transporte', umbralM: 250, prioridad: 1 }]).filas[0];
    expect(g.descripcion).toContain('250 m');
    expect(g.fuente).toMatch(/elegiste/i);
  });
  it('las zonas citan el plano del PDM y marcan lo aproximado', () => {
    const f = leyenda([{ id: 'residencial' }, { id: 'tranquilo' }, { id: 'campina' }].map((c) => ({ ...c, umbralM: null, prioridad: 1 }))).filas;
    expect(f[0].fuente).toMatch(/PDM 2016-2025/);
    expect(f[0].aproximado).toBe(false);
    expect(f[1].aproximado).toBe(true);
    expect(f[2].descripcion).toContain('500 m');
    expect(f[2].fuente).toMatch(/convención del proyecto/i);
  });
  it('lejos de quebradas: la distancia es de la persona y la red es de la ANA, con su límite', () => {
    const f = leyenda([{ id: 'lejosQuebrada', umbralM: 200, prioridad: 1 }]).filas[0];
    expect(f.descripcion).toContain('200 m');
    expect(f.fuente).toMatch(/elegiste/i);
    expect(f.fuente).toMatch(/ANA/);
  });
  it('marca la intersección solo con más de un criterio', () => {
    expect(leyenda([{ id: 'salud', umbralM: null, prioridad: 1 }]).interseccion).toBe(false);
    expect(leyenda([{ id: 'salud', umbralM: null, prioridad: 1 }, { id: 'areaVerde', umbralM: null, prioridad: 1 }]).interseccion).toBe(true);
  });
});

describe('Pintado.rectDeCelda', () => {
  it('es un cuadrado de pasoM metros centrado en la celda', () => {
    const c = { lat: BASE.lat, lon: BASE.lon };
    const r = Pintado.rectDeCelda(c, 250);
    expect(r.norte).toBeGreaterThan(c.lat);
    expect(r.sur).toBeLessThan(c.lat);
    expect(r.este).toBeGreaterThan(c.lon);
    expect(r.oeste).toBeLessThan(c.lon);
    expect(Asistente.distanciaM({ lat: r.sur, lon: c.lon }, { lat: r.norte, lon: c.lon })).toBeCloseTo(250, 0);
    expect(Asistente.distanciaM({ lat: c.lat, lon: r.oeste }, { lat: c.lat, lon: r.este })).toBeCloseTo(250, 0);
  });
});
