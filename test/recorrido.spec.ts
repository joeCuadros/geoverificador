/**
 * Pruebas de public/js/recorrido.js: el primer momento de la visita (Inicio → guía → chat). Es lógica pura: decide qué vista
 * se abre, cuándo se recuerda que la persona ya pasó por la guía y cómo vuelve a abrirse el Inicio o la guía. El
 * almacenamiento del navegador puede faltar o lanzar y nunca debe romper la página.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Recorrido = require('../public/js/recorrido.js');

const almacenFalso = (inicial: Record<string, string> = {}) => {
  const datos = { ...inicial };
  return {
    getItem: (k: string) => (k in datos ? datos[k] : null),
    setItem: (k: string, v: string) => { datos[k] = v; },
    datos,
  };
};
const almacenRoto = {
  getItem: () => { throw new Error('bloqueado'); },
  setItem: () => { throw new Error('bloqueado'); },
};

describe('Recorrido: recordar que ya se hizo', () => {
  it('sin marca, la visita es nueva', () => {
    expect(Recorrido.visto(almacenFalso())).toBe(false);
    expect(Recorrido.visto(null)).toBe(false);
  });
  it('marcarVisto guarda "1" y visto lo lee', () => {
    const a = almacenFalso();
    Recorrido.marcarVisto(a);
    expect(a.datos[Recorrido.CLAVE_VISTO]).toBe('1');
    expect(Recorrido.visto(a)).toBe(true);
  });
  it('si el almacenamiento falla, no lanza y se trata como visita nueva', () => {
    expect(() => Recorrido.marcarVisto(almacenRoto)).not.toThrow();
    expect(Recorrido.visto(almacenRoto)).toBe(false);
    expect(() => Recorrido.marcarVisto(null)).not.toThrow();
  });
  it('no confunde la marca del recorrido anterior (tourVisto) con haber visto el Inicio', () => {
    const a = almacenFalso({ 'geoverificador.tourVisto': '1' });
    expect(Recorrido.visto(a)).toBe(false);
  });
});

describe('Recorrido.vistaInicial', () => {
  it('visita nueva: abre el Inicio', () => {
    expect(Recorrido.vistaInicial({ visto: false, busqueda: '' })).toBe('inicio');
  });
  it('visita de regreso: abre directo el chat', () => {
    expect(Recorrido.vistaInicial({ visto: true, busqueda: '' })).toBe('espacio');
  });
  it('?tour=no o ?inicio=no saltan el Inicio aunque sea la primera visita', () => {
    expect(Recorrido.vistaInicial({ visto: false, busqueda: '?tour=no' })).toBe('espacio');
    expect(Recorrido.vistaInicial({ visto: false, busqueda: '?x=1&inicio=no' })).toBe('espacio');
  });
  it('?inicio=1 fuerza el Inicio aunque ya se haya visto', () => {
    expect(Recorrido.vistaInicial({ visto: true, busqueda: '?inicio=1' })).toBe('inicio');
  });
  it('una búsqueda ausente o rara no rompe', () => {
    expect(Recorrido.vistaInicial({ visto: false })).toBe('inicio');
    expect(Recorrido.vistaInicial({ visto: true, busqueda: undefined })).toBe('espacio');
  });
});

describe('Recorrido.transicion', () => {
  const nuevo = Recorrido.estadoInicial('inicio');

  it('el estado inicial no tiene guía abierta', () => {
    expect(nuevo).toEqual({ vista: 'inicio', guia: false, enRecorrido: false });
    expect(Recorrido.estadoInicial('espacio')).toEqual({ vista: 'espacio', guia: false, enRecorrido: false });
  });

  it('«Comenzar recorrido» abre la guía sin recordar nada todavía', () => {
    const r = Recorrido.transicion(nuevo, 'comenzar');
    expect(r.estado).toEqual({ vista: 'inicio', guia: true, enRecorrido: true });
    expect(r.marcarVisto).toBe(false);
  });

  it('terminar u omitir la guía del recorrido lleva al chat y recuerda la visita', () => {
    const guia = Recorrido.transicion(nuevo, 'comenzar').estado;
    const r = Recorrido.transicion(guia, 'cerrar-guia');
    expect(r.estado).toEqual({ vista: 'espacio', guia: false, enRecorrido: false });
    expect(r.marcarVisto).toBe(true);
  });

  it('«Ya lo conozco: ir al chat» salta la guía y recuerda la visita', () => {
    const r = Recorrido.transicion(nuevo, 'saltar');
    expect(r.estado).toEqual({ vista: 'espacio', guia: false, enRecorrido: false });
    expect(r.marcarVisto).toBe(true);
  });

  it('«¿Cómo funciona?» abre la guía encima del chat y al cerrarla vuelve al chat sin cambiar de vista', () => {
    const abierta = Recorrido.transicion(Recorrido.estadoInicial('espacio'), 'abrir-guia');
    expect(abierta.estado).toEqual({ vista: 'espacio', guia: true, enRecorrido: false });
    expect(abierta.marcarVisto).toBe(false);
    const cerrada = Recorrido.transicion(abierta.estado, 'cerrar-guia');
    expect(cerrada.estado).toEqual({ vista: 'espacio', guia: false, enRecorrido: false });
    expect(cerrada.marcarVisto).toBe(false);
  });

  it('el enlace del encabezado reabre el Inicio desde el chat y cierra cualquier guía', () => {
    const r = Recorrido.transicion({ vista: 'espacio', guia: true, enRecorrido: false }, 'abrir-inicio');
    expect(r.estado).toEqual({ vista: 'inicio', guia: false, enRecorrido: false });
    expect(r.marcarVisto).toBe(false);
  });

  it('un evento desconocido no cambia nada y no recuerda nada', () => {
    const r = Recorrido.transicion(nuevo, 'volar');
    expect(r.estado).toEqual(nuevo);
    expect(r.marcarVisto).toBe(false);
  });

  it('no muta el estado recibido', () => {
    const copia = { ...nuevo };
    Recorrido.transicion(nuevo, 'saltar');
    expect(nuevo).toEqual(copia);
  });
});
