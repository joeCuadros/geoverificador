/**
 * Pruebas de lo que el asistente ofrece para armar una búsqueda sin escribir (menús desplegables y preajustes), del
 * apartado «Por qué, fuente y límites» de cada respuesta y del detalle de una búsqueda. Son funciones puras de
 * public/js/asistente.js. La garantía principal: la consulta armada con menús es la MISMA estructura que produce el
 * intérprete al leer la frase equivalente, así que el motor de decisión es uno solo.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');

type Crit = { id: string; prioridad: number };
const ids = (q: { criterios: Crit[] }) => q.criterios.map((c) => c.id).sort();
const prio = (q: { criterios: Crit[] }) => Object.fromEntries(q.criterios.map((c) => [c.id, c.prioridad]));

describe('Asistente.construirConsulta', () => {
  it('arma la misma estructura que el intérprete: tipo buscar, modo nuevo y criterios con prioridad 1', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud', 'areaVerde'] });
    expect(q).toMatchObject({ tipo: 'buscar', modo: 'nuevo', radioGlobalM: null, incluirCondicional: false, limitarAlPunto: false, temaNoSoportado: null, lote: null });
    expect(q.criterios).toEqual([{ id: 'salud', umbralM: null, prioridad: 1 }, { id: 'areaVerde', umbralM: null, prioridad: 1 }]);
    const hablada = Asistente.interpretar('busco cerca de una posta y un parque');
    expect(Object.keys(q).sort()).toEqual(Object.keys(hablada).sort());
    expect(q.criterios).toEqual(hablada.criterios);
  });

  it('la prioridad pesa el doble, igual que «lo más importante es…»', () => {
    const q = Asistente.construirConsulta({ criterios: ['colegio', 'areaVerde'], prioridades: ['areaVerde'] });
    expect(prio(q)).toEqual({ colegio: 1, areaVerde: 2 });
    const hablada = Asistente.interpretar('busco cerca de un colegio y un parque, lo más importante es el parque');
    expect(prio(q)).toEqual(prio(hablada));
  });

  it('una prioridad que no está entre los criterios elegidos se ignora', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud'], prioridades: ['transporte'] });
    expect(prio(q)).toEqual({ salud: 1 });
  });

  it('el radio vale para todos los criterios, igual que «en un radio de 1 km»', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud', 'transporte'], radioM: 1000 });
    expect(q.radioGlobalM).toBe(1000);
    expect(Asistente.interpretar('posta y paradero en un radio de 1 km').radioGlobalM).toBe(1000);
  });

  it('ignora radios inválidos', () => {
    [0, -5, NaN, 'mucho', null, undefined].forEach((r) => {
      expect(Asistente.construirConsulta({ criterios: ['salud'], radioM: r }).radioGlobalM).toBeNull();
    });
  });

  it('«Colegio» toma el nivel elegido; sin nivel válido es inicial o primaria', () => {
    expect(ids(Asistente.construirConsulta({ criterios: ['colegio'], nivel: 'secundaria' }))).toEqual(['secundaria']);
    expect(ids(Asistente.construirConsulta({ criterios: ['colegio'], nivel: 'inicial' }))).toEqual(['inicial']);
    expect(ids(Asistente.construirConsulta({ criterios: ['colegio'], nivel: 'primaria' }))).toEqual(['primaria']);
    expect(ids(Asistente.construirConsulta({ criterios: ['colegio'], nivel: 'universidad' }))).toEqual(['colegio']);
    expect(ids(Asistente.construirConsulta({ criterios: ['colegio'] }))).toEqual(['colegio']);
  });

  it('la prioridad de «colegio» pasa al nivel elegido', () => {
    const q = Asistente.construirConsulta({ criterios: ['colegio', 'salud'], nivel: 'primaria', prioridades: ['colegio'] });
    expect(prio(q)).toEqual({ primaria: 2, salud: 1 });
  });

  it('marca como aproximados los criterios que no son un dato medido', () => {
    expect(Asistente.construirConsulta({ criterios: ['tranquilo', 'salud'] }).aproximados).toEqual(['tranquilo']);
  });

  it('incluye zonas condicionales solo si se pide', () => {
    expect(Asistente.construirConsulta({ criterios: ['salud'], incluirCondicional: true }).incluirCondicional).toBe(true);
    expect(Asistente.construirConsulta({ criterios: ['salud'] }).incluirCondicional).toBe(false);
  });

  it('descarta criterios desconocidos y repetidos; sin ninguno válido no hay búsqueda', () => {
    expect(ids(Asistente.construirConsulta({ criterios: ['salud', 'salud', 'inventado', 7] }))).toEqual(['salud']);
    expect(Asistente.construirConsulta({ criterios: ['inventado'] }).tipo).toBe('desconocido');
    expect(Asistente.construirConsulta({}).tipo).toBe('desconocido');
    expect(Asistente.construirConsulta(undefined).criterios).toEqual([]);
  });
});

describe('Asistente.textoDeConsulta', () => {
  it('cada criterio escrito en el chat se entiende igual que cuando lo arma el menú', () => {
    Object.keys(Asistente.CRITERIOS).forEach((id) => {
      const q = Asistente.construirConsulta({ criterios: [id] });
      const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
      expect(vuelta.tipo).toBe('buscar');
      expect(ids(vuelta)).toEqual(ids(q));
    });
  });

  it('cada nivel educativo del menú se entiende al escribirlo', () => {
    Asistente.OPCIONES.niveles.forEach((n: { id: string }) => {
      const q = Asistente.construirConsulta({ criterios: ['colegio'], nivel: n.id });
      expect(ids(Asistente.interpretar(Asistente.textoDeConsulta(q)))).toEqual(ids(q));
    });
  });

  it('la frase de una consulta completa se interpreta con los mismos criterios, prioridad, radio y condicionales', () => {
    const q = Asistente.construirConsulta({
      criterios: ['colegio', 'salud', 'areaVerde', 'transporte'], nivel: 'primaria', prioridades: ['areaVerde'], radioM: 1500, incluirCondicional: true,
    });
    const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
    expect(vuelta.tipo).toBe('buscar');
    expect(ids(vuelta)).toEqual(ids(q));
    expect(prio(vuelta)).toEqual(prio(q));
    expect(vuelta.radioGlobalM).toBe(1500);
    expect(vuelta.incluirCondicional).toBe(true);
  });

  it('funciona con cada radio del menú', () => {
    Asistente.OPCIONES.radios.filter((r: number | null) => r !== null).forEach((r: number) => {
      const q = Asistente.construirConsulta({ criterios: ['salud', 'areaVerde'], radioM: r });
      expect(Asistente.interpretar(Asistente.textoDeConsulta(q)).radioGlobalM).toBe(r);
    });
  });

  it('funciona con la prioridad en cada criterio', () => {
    Object.keys(Asistente.CRITERIOS).forEach((id) => {
      const q = Asistente.construirConsulta({ criterios: ['salud', 'transporte', id], prioridades: [id] });
      expect(prio(Asistente.interpretar(Asistente.textoDeConsulta(q)))).toEqual(prio(q));
    });
  });

  it('una consulta vacía no genera texto', () => {
    expect(Asistente.textoDeConsulta(Asistente.construirConsulta({}))).toBe('');
  });
});

describe('Asistente.interpretar: «centro comercial» en singular', () => {
  it('se entiende igual que «centros comerciales» (antes solo reconocía el plural)', () => {
    expect(ids(Asistente.interpretar('busco cerca de un centro comercial'))).toEqual(['comercial']);
    expect(ids(Asistente.interpretar('busco cerca de centros comerciales'))).toEqual(['comercial']);
  });
});

describe('Asistente.OPCIONES y PRESETS', () => {
  it('las opciones del menú son criterios reales y cubren servicios y zonas', () => {
    const todos = [...Asistente.OPCIONES.servicios, ...Asistente.OPCIONES.zonas].map((o: { id: string }) => o.id);
    todos.forEach((id: string) => expect(Asistente.CRITERIOS[id]).toBeDefined());
    expect(todos).toEqual(expect.arrayContaining(['salud', 'colegio', 'transporte', 'areaVerde', 'residencial', 'campina']));
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('los niveles del menú incluyen «inicial o primaria» y los tres niveles', () => {
    expect(Asistente.OPCIONES.niveles.map((n: { id: string }) => n.id)).toEqual(['colegio', 'inicial', 'primaria', 'secundaria']);
  });

  it('cada preajuste arma una consulta válida y se entiende al escribirlo', () => {
    expect(Asistente.PRESETS.length).toBeGreaterThanOrEqual(3);
    Asistente.PRESETS.forEach((p: { id: string; etiqueta: string; consulta: object }) => {
      expect(p.etiqueta.trim()).not.toBe('');
      const q = Asistente.construirConsulta(p.consulta);
      expect(q.tipo).toBe('buscar');
      expect(q.criterios.length).toBeGreaterThan(0);
      expect(ids(Asistente.interpretar(Asistente.textoDeConsulta(q)))).toEqual(ids(q));
    });
  });
});

describe('Asistente.explicar', () => {
  const TIPOS = ['saludo', 'ayuda', 'fuentes', 'pdm', 'zona', 'construir', 'servicio', 'ficha', 'buscar', 'no_soportado', 'desconocido'];

  it('devuelve por qué, fuente y límites (listas de texto) para cada tipo de respuesta', () => {
    TIPOS.forEach((tipo) => {
      const e = Asistente.explicar(tipo);
      ['porque', 'fuente', 'limites'].forEach((k) => {
        expect(Array.isArray(e[k])).toBe(true);
        e[k].forEach((t: string) => expect(typeof t === 'string' && t.trim() !== '').toBe(true));
      });
    });
  });

  it('las respuestas con datos siempre aclaran fuente y límites', () => {
    ['zona', 'construir', 'servicio', 'ficha', 'buscar', 'pdm'].forEach((tipo) => {
      const e = Asistente.explicar(tipo);
      expect(e.fuente.length).toBeGreaterThan(0);
      expect(e.limites.length).toBeGreaterThan(0);
    });
  });

  it('una búsqueda dice que no es una probabilidad y que la distancia es en línea recta', () => {
    const t = JSON.stringify(Asistente.explicar('buscar')).toLowerCase();
    expect(t).toContain('probabilidad');
    expect(t).toContain('línea recta');
    expect(t).toContain('referencial');
  });

  it('una búsqueda incorpora las aproximaciones que se pidieron y la fecha de los datos', () => {
    const t = JSON.stringify(Asistente.explicar('buscar', { aproximados: ['tranquilo'], fecha: '2026-05-01' })).toLowerCase();
    expect(t).toContain('ruido');
    expect(t).toContain('2026-05-01');
    expect(JSON.stringify(Asistente.explicar('buscar', { aproximados: [] })).toLowerCase()).not.toContain('ruido');
  });

  it('un tipo desconocido no inventa nada', () => {
    expect(Asistente.explicar('inventado')).toEqual({ porque: [], fuente: [], limites: [] });
  });
});

describe('Asistente.formatearBusqueda (apartado de detalle)', () => {
  const resultado = {
    criterios: [{ id: 'colegio', umbralM: null, prioridad: 1, umbralEfectivoM: null }, { id: 'areaVerde', umbralM: null, prioridad: 2, umbralEfectivoM: 300 }],
    totalCeldas: 1200,
    pasoM: 250,
    areas: [{ nombre: 'CAYMA', celdas: 300, pctCumpleTodo: 62.4, puntajePct: 81.2, porCriterio: { colegio: 90, areaVerde: 70 } }],
    puntos: [],
  };

  it('separa lo principal del detalle sin perder ninguna línea del texto', () => {
    const f = Asistente.formatearBusqueda(resultado, { aproximados: ['tranquilo'], temaNoSoportado: null, radioGlobalM: 1000 });
    const porTexto = (a: string, b: string) => a.localeCompare(b);
    expect([...f.lineas.principal, ...f.lineas.detalle].sort(porTexto)).toEqual(f.texto.split('\n').sort(porTexto));
    expect(f.lineas.principal[0]).toMatch(/^Busqué zonas con/);
    expect(f.lineas.detalle.join(' ')).toMatch(/1[ ,.]?200 celdas/);
  });

  it('cada fila trae el porcentaje como número para poder resumirlo', () => {
    const f = Asistente.formatearBusqueda(resultado, {});
    expect(f.filas[0].pctCumpleTodo).toBeCloseTo(62.4);
    expect(f.filas[0].puntajePct).toBeCloseTo(81.2);
  });
});
