/**
 * Pruebas de las funciones puras de «Cercanía a quebradas y cauces» (ANA) y del contexto de riesgo (peligros geológicos
 * de INGEMMET y sismos reportados por el IGP), en public/js/calculos.js, y de los umbrales del usuario
 * (public/js/umbrales.js).
 *
 * Regla de fondo que estas pruebas fijan: NO hay umbral normativo para la distancia a una quebrada. Sin un umbral que la
 * persona fije, el estado es INFORMATIVO (se muestra la distancia y el nombre, sin cumple/no cumple). Con su umbral, pasa a
 * CUMPLE o NO CUMPLE y se rotula «según tu umbral».
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Calculos = require('../public/js/calculos.js');
const Umbrales = require('../public/js/umbrales.js');

const M_POR_GRADO_LAT = (Math.PI / 180) * 6371008.8;
const dLat = (m: number) => m / M_POR_GRADO_LAT;
const dLon = (m: number, lat: number) => m / (M_POR_GRADO_LAT * Math.cos((lat * Math.PI) / 180));
const P = { lat: -16.4, lon: -71.53 };

describe('Calculos.distanciaALineaM', () => {
  it('es la distancia perpendicular a un tramo recto (norte-sur)', () => {
    const linea = [[P.lon + dLon(300, P.lat), P.lat - 0.01], [P.lon + dLon(300, P.lat), P.lat + 0.01]];
    expect(Calculos.distanciaALineaM(P.lat, P.lon, linea)).toBeCloseTo(300, 0);
  });

  it('si el pie de la perpendicular cae fuera del tramo, mide hasta el extremo más cercano', () => {
    const linea = [[P.lon, P.lat + dLat(1000)], [P.lon, P.lat + dLat(2000)]];
    expect(Calculos.distanciaALineaM(P.lat, P.lon, linea)).toBeCloseTo(1000, 0);
  });

  it('elige el tramo más cercano de una polilínea con varios tramos', () => {
    const linea = [[P.lon - 0.05, P.lat + 0.05], [P.lon + dLon(120, P.lat), P.lat + 0.001], [P.lon + dLon(120, P.lat), P.lat - 0.05]];
    expect(Calculos.distanciaALineaM(P.lat, P.lon, linea)).toBeCloseTo(120, 0);
  });

  it('es 0 si el punto está sobre la línea', () => {
    expect(Calculos.distanciaALineaM(P.lat, P.lon, [[P.lon - 0.01, P.lat], [P.lon + 0.01, P.lat]])).toBeCloseTo(0, 3);
  });

  it('coincide con el haversine hasta un vértice (error menor al 0,5 % a 10 km)', () => {
    const v = [P.lon + 0.09, P.lat + 0.02];
    const esperado = Calculos.haversine(P.lat, P.lon, v[1], v[0]);
    const medido = Calculos.distanciaALineaM(P.lat, P.lon, [v, [v[0] + 0.01, v[1]]]);
    expect(Math.abs(medido - esperado) / esperado).toBeLessThan(0.005);
  });

  it('una línea vacía o de un solo punto no inventa distancias', () => {
    expect(Calculos.distanciaALineaM(P.lat, P.lon, [])).toBe(Infinity);
    expect(Calculos.distanciaALineaM(P.lat, P.lon, undefined)).toBe(Infinity);
    expect(Calculos.distanciaALineaM(P.lat, P.lon, [[P.lon + dLon(50, P.lat), P.lat]])).toBeCloseTo(50, 0);
  });
});

describe('Calculos.distanciaAGeometriaLineaM', () => {
  const linea = (m: number) => [[P.lon + dLon(m, P.lat), P.lat - 0.01], [P.lon + dLon(m, P.lat), P.lat + 0.01]];

  it('acepta LineString y MultiLineString y toma la parte más cercana', () => {
    expect(Calculos.distanciaAGeometriaLineaM(P.lat, P.lon, { type: 'LineString', coordinates: linea(200) })).toBeCloseTo(200, 0);
    expect(Calculos.distanciaAGeometriaLineaM(P.lat, P.lon, { type: 'MultiLineString', coordinates: [linea(900), linea(250)] })).toBeCloseTo(250, 0);
  });

  it('otras geometrías o ausentes dan Infinity (no se inventa una distancia)', () => {
    expect(Calculos.distanciaAGeometriaLineaM(P.lat, P.lon, { type: 'Point', coordinates: [P.lon, P.lat] })).toBe(Infinity);
    expect(Calculos.distanciaAGeometriaLineaM(P.lat, P.lon, null)).toBe(Infinity);
  });
});

describe('Calculos.clasificarCauce', () => {
  it('sin umbral del usuario es INFORMATIVO, nunca cumple ni no cumple', () => {
    expect(Calculos.clasificarCauce(150, null)).toBe('INFORMATIVO');
    expect(Calculos.clasificarCauce(150, undefined)).toBe('INFORMATIVO');
    expect(Calculos.clasificarCauce(150, 0)).toBe('INFORMATIVO');
    expect(Calculos.clasificarCauce(150, -5)).toBe('INFORMATIVO');
    expect(Calculos.clasificarCauce(150, NaN)).toBe('INFORMATIVO');
  });

  it('con el umbral del usuario cumple si está a esa distancia o más lejos', () => {
    expect(Calculos.clasificarCauce(300, 200)).toBe('CUMPLE');
    expect(Calculos.clasificarCauce(200, 200)).toBe('CUMPLE');
    expect(Calculos.clasificarCauce(199, 200)).toBe('NO CUMPLE');
    expect(Calculos.clasificarCauce(0, 200)).toBe('NO CUMPLE');
  });

  it('sin distancia es SIN DATO, con o sin umbral', () => {
    expect(Calculos.clasificarCauce(null, 200)).toBe('SIN DATO');
    expect(Calculos.clasificarCauce(Infinity, null)).toBe('SIN DATO');
    expect(Calculos.clasificarCauce(undefined, undefined)).toBe('SIN DATO');
  });
});

describe('Calculos.evaluarCauces', () => {
  const cauce = (nombre: string, m: number, extra = {}) => ({
    nombre, tipo: 'Quebrada', categoria: 'Categoría 1A2',
    geometry: { type: 'LineString', coordinates: [[P.lon + dLon(m, P.lat), P.lat - 0.01], [P.lon + dLon(m, P.lat), P.lat + 0.01]] }, ...extra,
  });
  const base = { fuente: 'ANA', fecha: '2026-11-02', metodo: 'Distancia en línea recta a la línea más cercana.' };

  it('devuelve el cauce más cercano con su nombre y su distancia, como INFORMATIVO', () => {
    const r = Calculos.evaluarCauces(P, [cauce('Quebrada Lejana', 900), cauce('Quebrada El Cuico', 250)], base);
    expect(r).toMatchObject({ estado: 'INFORMATIVO', nombre: 'Quebrada El Cuico', tipo: 'Quebrada', umbralM: null, segunUmbralUsuario: false, fuente: 'ANA', fecha: '2026-11-02' });
    expect(r.distanciaM).toBeCloseTo(250, 0);
  });

  it('con el umbral del usuario da CUMPLE o NO CUMPLE y lo rotula como del usuario', () => {
    const cumple = Calculos.evaluarCauces(P, [cauce('A', 250)], { ...base, umbralUsuarioM: 200 });
    expect(cumple).toMatchObject({ estado: 'CUMPLE', umbralM: 200, segunUmbralUsuario: true });
    const no = Calculos.evaluarCauces(P, [cauce('A', 250)], { ...base, umbralUsuarioM: 400 });
    expect(no).toMatchObject({ estado: 'NO CUMPLE', umbralM: 400, segunUmbralUsuario: true });
  });

  it('sin cauces (archivo ausente o vacío) es SIN DATO: la ausencia de datos no es «estás lejos»', () => {
    [[], null, undefined].forEach((lista) => {
      const r = Calculos.evaluarCauces(P, lista, { ...base, umbralUsuarioM: 200 });
      expect(r.estado).toBe('SIN DATO');
      expect(r.distanciaM).toBeNull();
      expect(r.nombre).toBeNull();
    });
  });

  it('ignora cauces sin geometría de línea', () => {
    const r = Calculos.evaluarCauces(P, [{ nombre: 'Raro', geometry: { type: 'Point', coordinates: [P.lon, P.lat] } }, cauce('Real', 500)], base);
    expect(r.nombre).toBe('Real');
  });

  it('un cauce sin nombre se rotula «Sin nombre en la ANA»', () => {
    expect(Calculos.evaluarCauces(P, [cauce('', 500, { nombre: null })], base).nombre).toBe('Sin nombre en la ANA');
  });

  it('cumple si el punto está justo sobre el cauce solo con umbral y distancia 0 → NO CUMPLE', () => {
    expect(Calculos.evaluarCauces(P, [cauce('A', 0)], { ...base, umbralUsuarioM: 50 }).estado).toBe('NO CUMPLE');
  });
});

describe('Calculos.resumirCercanos', () => {
  const en = (m: number, extra = {}) => ({ lat: P.lat + dLat(m), lon: P.lon, ...extra });

  it('cuenta los elementos dentro del radio y da el más cercano de todos', () => {
    const r = Calculos.resumirCercanos(P, [en(100, { id: 1 }), en(400, { id: 2 }), en(900, { id: 3 })], 500);
    expect(r.total).toBe(2);
    expect(r.masCercano.id).toBe(1);
    expect(r.masCercano.distanciaM).toBeCloseTo(100, 0);
  });

  it('el borde del radio cuenta (≤)', () => {
    expect(Calculos.resumirCercanos(P, [en(500)], 500.5).total).toBe(1);
    expect(Calculos.resumirCercanos(P, [en(501)], 500).total).toBe(0);
  });

  it('sin elementos: total 0 y sin más cercano', () => {
    expect(Calculos.resumirCercanos(P, [], 500)).toEqual({ total: 0, masCercano: null });
    expect(Calculos.resumirCercanos(P, undefined, 500)).toEqual({ total: 0, masCercano: null });
  });

  it('descarta elementos sin coordenadas válidas', () => {
    expect(Calculos.resumirCercanos(P, [{ lat: NaN, lon: 1 }, { lat: 'x', lon: 2 }, en(50)], 500).total).toBe(1);
  });
});

describe('Calculos.resumirSismos', () => {
  const en = (m: number, magnitud: number | null, fecha: string) => ({ lat: P.lat + dLat(m), lon: P.lon, magnitud, fecha });

  it('cuenta los sismos en el radio, su magnitud máxima y el más reciente', () => {
    const r = Calculos.resumirSismos(P, [en(20000, 3.1, '2026-03-01'), en(50000, 4.8, '2026-07-15'), en(150000, 6.0, '2026-09-01')], { radioM: 100000 });
    expect(r.total).toBe(2);
    expect(r.magnitudMaxima).toBe(4.8);
    expect(r.masReciente).toBe('2026-07-15');
    expect(r.masCercano.distanciaM).toBeCloseTo(20000, -1);
  });

  it('la magnitud máxima solo cuenta los sismos dentro del radio', () => {
    expect(Calculos.resumirSismos(P, [en(150000, 7.0, '2026-01-01')], { radioM: 100000 })).toMatchObject({ total: 0, magnitudMaxima: null, masReciente: null });
  });

  it('ignora magnitudes ausentes sin romper', () => {
    const r = Calculos.resumirSismos(P, [en(1000, null, '2026-01-01'), en(2000, 3.5, '2026-02-01')], { radioM: 100000 });
    expect(r.total).toBe(2);
    expect(r.magnitudMaxima).toBe(3.5);
  });

  it('sin un radio válido no cuenta nada (no se asume un radio)', () => {
    expect(Calculos.resumirSismos(P, [en(10, 3, '2026-01-01')]).total).toBe(0);
  });

  it('sin sismos devuelve ceros, no inventa magnitudes', () => {
    expect(Calculos.resumirSismos(P, [], { radioM: 100000 })).toEqual({ total: 0, magnitudMaxima: null, masReciente: null, masCercano: null });
  });
});

describe('Umbrales del usuario (localStorage con try/catch)', () => {
  const memoria = () => {
    const d: Record<string, string> = {};
    return { getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; }, removeItem: (k: string) => { delete d[k]; }, d };
  };
  const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } };

  it('por defecto no hay ningún umbral (no se inventa uno)', () => {
    expect(Umbrales.leer(memoria())).toEqual({ quebradaMinM: null });
    expect(Umbrales.leer(null)).toEqual({ quebradaMinM: null });
  });

  it('guarda y lee la distancia mínima a una quebrada', () => {
    const a = memoria();
    expect(Umbrales.guardar(a, { quebradaMinM: 250 })).toEqual({ quebradaMinM: 250 });
    expect(Umbrales.leer(a)).toEqual({ quebradaMinM: 250 });
  });

  it('normaliza: acepta números positivos y descarta lo demás', () => {
    expect(Umbrales.normalizar({ quebradaMinM: '300' })).toEqual({ quebradaMinM: 300 });
    expect(Umbrales.normalizar({ quebradaMinM: 120.4 })).toEqual({ quebradaMinM: 120 });
    ['', 'abc', 0, -10, NaN, null, undefined, Infinity].forEach((v) => {
      expect(Umbrales.normalizar({ quebradaMinM: v })).toEqual({ quebradaMinM: null });
    });
    expect(Umbrales.normalizar(null)).toEqual({ quebradaMinM: null });
    expect(Umbrales.normalizar('texto')).toEqual({ quebradaMinM: null });
  });

  it('pone un tope razonable para evitar valores absurdos', () => {
    expect(Umbrales.normalizar({ quebradaMinM: Umbrales.MAXIMO_M + 1 })).toEqual({ quebradaMinM: null });
    expect(Umbrales.normalizar({ quebradaMinM: Umbrales.MAXIMO_M })).toEqual({ quebradaMinM: Umbrales.MAXIMO_M });
  });

  it('un JSON roto o un almacenamiento que falla no rompe nada', () => {
    const sucio = memoria();
    sucio.setItem(Umbrales.CLAVE, '{no es json');
    expect(Umbrales.leer(sucio)).toEqual({ quebradaMinM: null });
    expect(Umbrales.leer(roto)).toEqual({ quebradaMinM: null });
    expect(() => Umbrales.guardar(roto, { quebradaMinM: 100 })).not.toThrow();
    expect(() => Umbrales.guardar(null, { quebradaMinM: 100 })).not.toThrow();
    expect(Umbrales.guardar(roto, { quebradaMinM: 100 })).toEqual({ quebradaMinM: 100 });
  });

  it('quitar el umbral lo deja sin valor', () => {
    const a = memoria();
    Umbrales.guardar(a, { quebradaMinM: 250 });
    Umbrales.guardar(a, { quebradaMinM: null });
    expect(Umbrales.leer(a)).toEqual({ quebradaMinM: null });
  });
});
