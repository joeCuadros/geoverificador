/**
 * Pruebas de public/js/disposicion.js: cuánto mide el chat, cómo se mueve el divisor con el teclado, qué se recuerda entre
 * visitas y cómo se alterna entre dividir la pantalla, ampliar el chat y (en el móvil) ver el mapa. Lógica pura, sin DOM.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Disposicion = require('../public/js/disposicion.js');

const almacenFalso = (inicial: Record<string, string> = {}) => {
  const datos = { ...inicial };
  return { getItem: (k: string) => (k in datos ? datos[k] : null), setItem: (k: string, v: string) => { datos[k] = v; }, datos };
};
const almacenRoto = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };

const maximo = (contenedor: number) => contenedor - Disposicion.MIN_MAPA_PX - Disposicion.DIVISOR_PX;

describe('Disposicion.limitarAncho', () => {
  it('respeta el mínimo del chat (360 px) y deja lugar al mapa', () => {
    expect(Disposicion.MIN_CHAT_PX).toBe(360);
    expect(Disposicion.limitarAncho(100, 1400)).toBe(360);
    expect(Disposicion.limitarAncho(5000, 1400)).toBe(maximo(1400));
    expect(Disposicion.limitarAncho(700, 1400)).toBe(700);
  });
  it('en el contenedor más angosto que admite dos paneles (640 px) el chat mide exactamente su mínimo', () => {
    expect(maximo(640)).toBe(360);
    expect(Disposicion.limitarAncho(500, 640)).toBe(360);
    expect(Disposicion.limitarAncho(360, 640)).toBe(360);
  });
  it('un valor que no es número cae al ancho inicial', () => {
    expect(Disposicion.limitarAncho(NaN, 1400)).toBe(Disposicion.anchoInicial(1400));
    expect(Disposicion.limitarAncho(undefined, 1400)).toBe(Disposicion.anchoInicial(1400));
  });
});

describe('Disposicion.anchoInicial', () => {
  it('es cerca del 45 % del contenedor', () => {
    expect(Disposicion.anchoInicial(1400)).toBe(630);
    expect(Disposicion.anchoInicial(2000)).toBe(900);
  });
  it('nunca baja de 360 px', () => {
    expect(Disposicion.anchoInicial(700)).toBe(360);
    expect(Disposicion.anchoInicial(640)).toBe(360);
  });
});

describe('Disposicion.mover (teclado del divisor)', () => {
  const W = 1400;
  it('las flechas mueven 24 px y Mayús o Página 96 px', () => {
    expect(Disposicion.mover(600, 'ArrowRight', W)).toBe(624);
    expect(Disposicion.mover(600, 'ArrowLeft', W)).toBe(576);
    expect(Disposicion.mover(600, 'PageUp', W)).toBe(696);
    expect(Disposicion.mover(600, 'PageDown', W)).toBe(504);
    expect(Disposicion.mover(600, 'ArrowRight', W, { grande: true })).toBe(696);
  });
  it('Inicio y Fin llevan el chat a su mínimo y a su máximo', () => {
    expect(Disposicion.mover(600, 'Home', W)).toBe(360);
    expect(Disposicion.mover(600, 'End', W)).toBe(maximo(W));
  });
  it('no se sale de los límites', () => {
    expect(Disposicion.mover(360, 'ArrowLeft', W)).toBe(360);
    expect(Disposicion.mover(maximo(W), 'ArrowRight', W)).toBe(maximo(W));
  });
  it('otra tecla no mueve nada', () => {
    expect(Disposicion.mover(600, 'a', W)).toBe(600);
    expect(Disposicion.esTeclaDeDivisor('ArrowLeft')).toBe(true);
    expect(Disposicion.esTeclaDeDivisor('Tab')).toBe(false);
  });
});

describe('Disposicion.valoresAria y textoValor', () => {
  it('expresa el ancho como porcentaje del contenedor para role="separator"', () => {
    const v = Disposicion.valoresAria(630, 1400);
    expect(v.now).toBe(45);
    expect(v.min).toBe(Math.round((360 / 1400) * 100));
    expect(v.max).toBe(Math.round((maximo(1400) / 1400) * 100));
    expect(v.min).toBeLessThanOrEqual(v.now);
    expect(v.now).toBeLessThanOrEqual(v.max);
  });
  it('el texto dice cuánto ocupa el chat', () => {
    expect(Disposicion.textoValor(630, 1400)).toBe('El chat ocupa el 45 % del ancho');
  });
});

describe('Disposicion: lo que se recuerda', () => {
  it('guarda la fracción del ancho y la devuelve', () => {
    const a = almacenFalso();
    Disposicion.guardarFraccion(a, 0.5);
    expect(a.datos[Disposicion.CLAVE_ANCHO]).toBe('0.5');
    expect(Disposicion.leerFraccion(a)).toBe(0.5);
  });
  it('guardarAncho convierte píxeles a fracción del contenedor', () => {
    const a = almacenFalso();
    Disposicion.guardarAncho(a, 700, 1400);
    expect(Disposicion.leerFraccion(a)).toBe(0.5);
  });
  it('anchoGuardado reaplica la fracción a otro contenedor y la limita', () => {
    const a = almacenFalso();
    Disposicion.guardarFraccion(a, 0.6);
    expect(Disposicion.anchoGuardado(a, 1000)).toBe(600);
    expect(Disposicion.anchoGuardado(a, 700)).toBe(maximo(700)); // 420 px de 0,6 pero el mapa pide su mínimo
  });
  it('sin dato guardado usa el ancho inicial', () => {
    expect(Disposicion.anchoGuardado(almacenFalso(), 1400)).toBe(630);
  });
  it('ignora valores inválidos o fuera de rango', () => {
    expect(Disposicion.leerFraccion(almacenFalso({ [Disposicion.CLAVE_ANCHO]: 'abc' }))).toBeNull();
    expect(Disposicion.leerFraccion(almacenFalso({ [Disposicion.CLAVE_ANCHO]: '7' }))).toBeNull();
    expect(Disposicion.leerFraccion(almacenFalso({ [Disposicion.CLAVE_ANCHO]: '-1' }))).toBeNull();
    expect(Disposicion.leerFraccion(null)).toBeNull();
  });
  it('si el almacenamiento falla, nada lanza', () => {
    expect(() => Disposicion.guardarFraccion(almacenRoto, 0.5)).not.toThrow();
    expect(Disposicion.leerFraccion(almacenRoto)).toBeNull();
    expect(Disposicion.anchoGuardado(almacenRoto, 1400)).toBe(630);
  });
});

describe('Disposicion: dividir, ampliar y ver el mapa', () => {
  it('el punto de corte del móvil es 640 px (hasta 639,98 px es móvil)', () => {
    expect(Disposicion.esMovil(639.98)).toBe(true);
    expect(Disposicion.esMovil(640)).toBe(false);
    expect(Disposicion.esMovil(320)).toBe(true);
  });
  it('ampliar y volver a dividir alternan el modo', () => {
    expect(Disposicion.alternarAmpliar('dividido')).toBe('chat');
    expect(Disposicion.alternarAmpliar('chat')).toBe('dividido');
    expect(Disposicion.alternarAmpliar('otro')).toBe('chat');
  });
  it('el botón de ampliar dice qué hará, no solo en qué estado está', () => {
    expect(Disposicion.etiquetaAmpliar('dividido')).toEqual({ texto: 'Ampliar el chat', pulsado: false });
    expect(Disposicion.etiquetaAmpliar('chat')).toEqual({ texto: 'Volver a ver el mapa', pulsado: true });
  });
  it('en el móvil el botón de abajo alterna entre chat y mapa', () => {
    expect(Disposicion.alternarMovil('chat')).toBe('mapa');
    expect(Disposicion.alternarMovil('mapa')).toBe('chat');
    expect(Disposicion.etiquetaMovil('chat')).toBe('Ver mapa');
    expect(Disposicion.etiquetaMovil('mapa')).toBe('Ver chat');
  });
  it('qué se ve: chat y mapa en escritorio dividido; solo uno al ampliar o en el móvil', () => {
    expect(Disposicion.visibles({ movil: false, modo: 'dividido', panelMovil: 'chat' })).toEqual({ chat: true, mapa: true });
    expect(Disposicion.visibles({ movil: false, modo: 'chat', panelMovil: 'mapa' })).toEqual({ chat: true, mapa: false });
    expect(Disposicion.visibles({ movil: true, modo: 'dividido', panelMovil: 'chat' })).toEqual({ chat: true, mapa: false });
    expect(Disposicion.visibles({ movil: true, modo: 'chat', panelMovil: 'mapa' })).toEqual({ chat: false, mapa: true });
  });
});
