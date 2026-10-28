/**
 * Pruebas de public/js/onboarding.js: la lógica pura de los 3 pasos (ubicar, confirmar, leer el reporte),
 * el desplazamiento del punto con botones (alternativa al arrastre, WCAG 2.2 SC 2.5.7), la caja de Arequipa
 * y la bandera de «consejo visto» que se guarda en localStorage sin romper si el almacenamiento falla.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Onboarding = require('../public/js/onboarding.js');
const Calculos = require('../public/js/calculos.js');

const INICIAL = { paso: 'ubicar', hayPunto: false, moviendo: false };

describe('Onboarding.transicion', () => {
  it('empieza en el paso 1 sin punto', () => {
    expect(Onboarding.ESTADO_INICIAL).toEqual(INICIAL);
  });

  it('elegir un punto en el paso 1 pasa al paso 2', () => {
    expect(Onboarding.transicion(INICIAL, 'elegir-punto')).toEqual({
      paso: 'confirmar',
      hayPunto: true,
      moviendo: false,
    });
  });

  it('elegir otro punto en el paso 2 se queda en el paso 2 y cierra los botones de movimiento', () => {
    const e = { paso: 'confirmar', hayPunto: true, moviendo: true };
    expect(Onboarding.transicion(e, 'elegir-punto')).toEqual({
      paso: 'confirmar',
      hayPunto: true,
      moviendo: false,
    });
  });

  it('«Mover el punto» alterna los botones de movimiento solo en el paso 2', () => {
    const e = { paso: 'confirmar', hayPunto: true, moviendo: false };
    const a = Onboarding.transicion(e, 'mover');
    expect(a.moviendo).toBe(true);
    expect(Onboarding.transicion(a, 'mover').moviendo).toBe(false);
    expect(Onboarding.transicion(INICIAL, 'mover')).toEqual(INICIAL);
  });

  it('«Sí, verificar» pasa al reporte solo desde el paso 2 con punto', () => {
    const e = { paso: 'confirmar', hayPunto: true, moviendo: true };
    expect(Onboarding.transicion(e, 'confirmar')).toEqual({
      paso: 'reporte',
      hayPunto: true,
      moviendo: false,
    });
    expect(Onboarding.transicion(INICIAL, 'confirmar')).toEqual(INICIAL);
  });

  it('en el reporte, tocar el mapa no cambia nada (el punto se cambia con «Cambiar»)', () => {
    const e = { paso: 'reporte', hayPunto: true, moviendo: false };
    expect(Onboarding.transicion(e, 'elegir-punto')).toEqual(e);
  });

  it('«Cambiar» vuelve al paso 1 y conserva el punto', () => {
    const e = { paso: 'reporte', hayPunto: true, moviendo: false };
    expect(Onboarding.transicion(e, 'cambiar')).toEqual({
      paso: 'ubicar',
      hayPunto: true,
      moviendo: false,
    });
  });

  it('«Nueva consulta» vuelve al paso 1 sin punto desde cualquier paso', () => {
    ['ubicar', 'confirmar', 'reporte'].forEach((paso) => {
      expect(
        Onboarding.transicion({ paso, hayPunto: true, moviendo: true }, 'nueva'),
      ).toEqual(INICIAL);
    });
  });

  it('un evento desconocido no cambia el estado', () => {
    expect(Onboarding.transicion(INICIAL, 'volar')).toEqual(INICIAL);
  });

  it('no modifica el estado recibido', () => {
    const e = Object.freeze({ paso: 'ubicar', hayPunto: false, moviendo: false });
    expect(() => Onboarding.transicion(e, 'elegir-punto')).not.toThrow();
  });

  it('numeroDePaso da 1, 2 o 3', () => {
    expect(Onboarding.numeroDePaso('ubicar')).toBe(1);
    expect(Onboarding.numeroDePaso('confirmar')).toBe(2);
    expect(Onboarding.numeroDePaso('reporte')).toBe(3);
  });
});

describe('Onboarding.desplazar', () => {
  const P = { lat: -16.3989, lon: -71.5369 }; // Plaza de Armas de Arequipa

  it('al norte sube la latitud y deja la longitud', () => {
    const q = Onboarding.desplazar(P, 'N', 10);
    expect(q.lat).toBeGreaterThan(P.lat);
    expect(q.lon).toBe(P.lon);
  });

  it('al sur baja la latitud', () => {
    expect(Onboarding.desplazar(P, 'S', 10).lat).toBeLessThan(P.lat);
  });

  it('al este sube la longitud y al oeste baja', () => {
    expect(Onboarding.desplazar(P, 'E', 10).lon).toBeGreaterThan(P.lon);
    expect(Onboarding.desplazar(P, 'O', 10).lon).toBeLessThan(P.lon);
  });

  it('el desplazamiento mide los metros pedidos en línea recta', () => {
    ['N', 'S', 'E', 'O'].forEach((dir) => {
      const q = Onboarding.desplazar(P, dir, 50);
      const d = Calculos.haversine(P.lat, P.lon, q.lat, q.lon);
      expect(d).toBeCloseTo(50, 0);
    });
  });

  it('una dirección desconocida devuelve el mismo punto', () => {
    expect(Onboarding.desplazar(P, 'X', 10)).toEqual(P);
  });

  it('metros inválidos devuelven el mismo punto', () => {
    expect(Onboarding.desplazar(P, 'N', -5)).toEqual(P);
    expect(Onboarding.desplazar(P, 'N', Number.NaN)).toEqual(P);
  });
});

describe('Onboarding.dentroDeCaja', () => {
  const VIEWBOX = '-71.75,-16.20,-71.35,-16.60'; // oeste, norte, este, sur (CONFIG.viewbox)

  it('la Plaza de Armas está dentro', () => {
    expect(Onboarding.dentroDeCaja(-16.3989, -71.5369, VIEWBOX)).toBe(true);
  });

  it('Lima está fuera', () => {
    expect(Onboarding.dentroDeCaja(-12.0464, -77.0428, VIEWBOX)).toBe(false);
  });

  it('una caja mal escrita no deja pasar nada', () => {
    expect(Onboarding.dentroDeCaja(-16.4, -71.5, 'x,y')).toBe(false);
  });
});

describe('Onboarding: consejo visto (localStorage)', () => {
  const memoria = () => {
    const d: Record<string, string> = {};
    return {
      getItem: (k: string) => (k in d ? d[k] : null),
      setItem: (k: string, v: string) => {
        d[k] = v;
      },
    };
  };
  const roto = {
    getItem: () => {
      throw new Error('bloqueado');
    },
    setItem: () => {
      throw new Error('bloqueado');
    },
  };

  it('al inicio el consejo no se ha visto', () => {
    expect(Onboarding.consejoVisto(memoria())).toBe(false);
  });

  it('después de marcarlo, queda visto', () => {
    const s = memoria();
    Onboarding.marcarConsejoVisto(s);
    expect(Onboarding.consejoVisto(s)).toBe(true);
  });

  it('si el almacenamiento falla, no lanza y el consejo se considera no visto', () => {
    expect(() => Onboarding.marcarConsejoVisto(roto)).not.toThrow();
    expect(Onboarding.consejoVisto(roto)).toBe(false);
  });

  it('sin almacenamiento (null) tampoco lanza', () => {
    expect(Onboarding.consejoVisto(null)).toBe(false);
    expect(() => Onboarding.marcarConsejoVisto(null)).not.toThrow();
  });
});
