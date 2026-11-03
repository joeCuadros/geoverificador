/**
 * Pruebas de public/js/comparar.js: la lógica pura de «Comparar puntos». Hasta 3 candidatos, tabla lado a lado de las 5
 * variables, prioridades que marca la persona (sin pesos inventados ni puntaje global) y almacenamiento que no rompe.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Comparar = require('../public/js/comparar.js');

type Estado = 'CUMPLE' | 'NO CUMPLE' | 'SIN DATO';
const serv = (estado: Estado, distanciaM: number | null, umbralM: number, nombre: string | null = 'Lugar') => ({
  estado, distanciaM, umbralM, nombre, fecha: '2026-05-01',
});
const entorno = (o: Partial<Record<string, any>> = {}) => ({
  salud: serv('CUMPLE', 300, 1000),
  educacion: { inicial: serv('CUMPLE', 200, 500), primaria: serv('CUMPLE', 900, 1500), secundaria: serv('CUMPLE', 2000, 3000) },
  transporte: serv('CUMPLE', 100, 400),
  areaVerde: serv('CUMPLE', 120, 300),
  ...o,
});
const zonaSi = { codigo: 'RDM', regla: { nombre: 'Residencial de densidad media', edificable: 'si' }, borde: { alerta: false } };

let n = 0;
const crear = (o: Record<string, any> = {}) => {
  n += 1;
  return Comparar.crearCandidato({ lat: -16.4 - n * 0.01, lon: -71.53, etiqueta: `Punto ${n}`, distrito: 'Cercado', zona: zonaSi, entorno: entorno(), ...o });
};

describe('Comparar.crearCandidato', () => {
  it('resume las variables con estado, distancia y umbral (5 de la ficha y quebradas)', () => {
    const c = crear();
    expect(Object.keys(c.variables)).toEqual(['zonificacion', 'salud', 'educacion', 'transporte', 'areaVerde', 'quebradas']);
    expect(c.variables.salud).toEqual({ estado: 'CUMPLE', distanciaM: 300, umbralM: 1000, nombre: 'Lugar' });
    expect(c.variables.zonificacion).toMatchObject({ estado: 'CUMPLE', codigo: 'RDM', texto: 'Construible' });
    expect(c.fechaDatos).toBe('2026-05-01');
  });

  it('devuelve null si falta el entorno o las coordenadas (no guarda un punto a medias)', () => {
    expect(Comparar.crearCandidato({ lat: -16.4, lon: -71.5, entorno: null })).toBeNull();
    expect(Comparar.crearCandidato({ lat: NaN, lon: -71.5, entorno: entorno() })).toBeNull();
    expect(Comparar.crearCandidato(undefined)).toBeNull();
  });

  it('traduce la edificabilidad del plano: condicionado es PARCIAL, no construible es NO CUMPLE, fuera del plano es SIN DATO', () => {
    const z = (edificable: string) => ({ codigo: 'X', regla: { nombre: 'N', edificable }, borde: { alerta: false } });
    expect(crear({ zona: z('condicionado') }).variables.zonificacion).toMatchObject({ estado: 'PARCIAL', texto: 'Requiere consulta' });
    expect(crear({ zona: z('no') }).variables.zonificacion).toMatchObject({ estado: 'NO CUMPLE', texto: 'No construible' });
    expect(crear({ zona: null }).variables.zonificacion).toMatchObject({ estado: 'SIN DATO' });
    expect(crear({ zona: { codigo: 'Q', regla: null } }).variables.zonificacion).toMatchObject({ estado: 'SIN DATO', texto: 'Sin reglas en la tabla' });
  });

  it('conserva el aviso de borde de zona solo si hay alerta', () => {
    const conBorde = crear({ zona: { ...zonaSi, borde: { alerta: true, distanciaM: 12, codigo: 'I1' } } });
    expect(conBorde.variables.zonificacion.bordeM).toBe(12);
    expect(crear().variables.zonificacion.bordeM).toBeNull();
  });

  it('usa la misma regla de la ficha para el estado de Colegio', () => {
    const edu = (i: Estado, p: Estado, s: Estado) => ({ inicial: serv(i, 1, 500), primaria: serv(p, 1, 1500), secundaria: serv(s, 1, 3000) });
    expect(Comparar.estadoEducacion(edu('CUMPLE', 'CUMPLE', 'CUMPLE'))).toBe('CUMPLE');
    expect(Comparar.estadoEducacion(edu('CUMPLE', 'NO CUMPLE', 'CUMPLE'))).toBe('PARCIAL');
    expect(Comparar.estadoEducacion(edu('NO CUMPLE', 'NO CUMPLE', 'SIN DATO'))).toBe('NO CUMPLE');
    expect(Comparar.estadoEducacion(edu('SIN DATO', 'SIN DATO', 'SIN DATO'))).toBe('SIN DATO');
  });

  it('no arrastra campos pesados (la forma del área verde no se guarda)', () => {
    const c = crear({ entorno: entorno({ areaVerde: { ...serv('CUMPLE', 0, 300), forma: { type: 'Polygon', coordinates: [] } } }) });
    expect(c.variables.areaVerde).not.toHaveProperty('forma');
  });
});

describe('Comparar.agregar / quitar', () => {
  it('agrega hasta 3 puntos y rechaza el cuarto sin modificar la lista', () => {
    let lista: any[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = Comparar.agregar(lista, crear());
      expect(r.ok).toBe(true);
      lista = r.lista;
    }
    expect(lista).toHaveLength(Comparar.MAX_CANDIDATOS);
    const cuarto = Comparar.agregar(lista, crear());
    expect(cuarto).toMatchObject({ ok: false, motivo: 'lleno' });
    expect(cuarto.lista).toBe(lista);
  });

  it('no repite el mismo punto, ni uno a menos de 5 m', () => {
    const a = crear();
    const una = Comparar.agregar([], a);
    expect(Comparar.agregar(una.lista, a)).toMatchObject({ ok: false, motivo: 'repetido' });
    const casiIgual = Comparar.crearCandidato({ lat: a.lat + 0.00002, lon: a.lon, etiqueta: 'Casi igual', zona: zonaSi, entorno: entorno() }); // ≈ 2 m
    expect(Comparar.agregar(una.lista, casiIgual)).toMatchObject({ ok: false, motivo: 'repetido' });
  });

  it('un candidato incompleto no se agrega', () => {
    expect(Comparar.agregar([], null)).toMatchObject({ ok: false, motivo: 'incompleto' });
  });

  it('no modifica la lista original al agregar o quitar', () => {
    const a = crear();
    const b = crear();
    const original = [a];
    const r = Comparar.agregar(original, b);
    expect(original).toEqual([a]);
    expect(r.lista).toEqual([a, b]);
    expect(Comparar.quitar(r.lista, a.id)).toEqual([b]);
    expect(r.lista).toHaveLength(2);
  });

  it('estaGuardado reconoce un punto ya guardado', () => {
    const a = crear();
    expect(Comparar.estaGuardado([a], a.lat, a.lon)).toBe(true);
    expect(Comparar.estaGuardado([a], a.lat + 0.01, a.lon)).toBe(false);
    expect(Comparar.estaGuardado(undefined, 0, 0)).toBe(false);
  });
});

describe('Comparar prioridades', () => {
  it('normaliza: solo variables conocidas, sin repetir y en el orden de la tabla', () => {
    expect(Comparar.normalizarPrioridades(['areaVerde', 'salud', 'salud', 'puntaje', 7, null])).toEqual(['salud', 'areaVerde']);
    expect(Comparar.normalizarPrioridades('salud')).toEqual([]);
    expect(Comparar.normalizarPrioridades(undefined)).toEqual([]);
  });

  it('alterna una prioridad y ignora ids desconocidos', () => {
    expect(Comparar.alternar([], 'salud')).toEqual(['salud']);
    expect(Comparar.alternar(['salud', 'transporte'], 'salud')).toEqual(['transporte']);
    expect(Comparar.alternar(['salud'], 'inventada')).toEqual(['salud']);
  });

  it('sin prioridades no hay resultado ni resaltado', () => {
    const c = crear();
    expect(Comparar.evaluarPrioridades(c, []).resultado).toBe('sin-prioridades');
    expect(Comparar.quienesCumplen([c], [])).toEqual([]);
  });

  it('cumple cuando todas las variables marcadas cumplen (las no marcadas no importan)', () => {
    const c = crear({ entorno: entorno({ transporte: serv('NO CUMPLE', 900, 400) }) });
    const r = Comparar.evaluarPrioridades(c, ['salud', 'areaVerde']);
    expect(r).toMatchObject({ resultado: 'cumple', total: 2, cumplen: ['salud', 'areaVerde'], noCumplen: [], sinDato: [] });
  });

  it('no cumple si alguna marcada no cumple, y dice cuál', () => {
    const c = crear({ entorno: entorno({ transporte: serv('NO CUMPLE', 900, 400) }) });
    const r = Comparar.evaluarPrioridades(c, ['salud', 'transporte']);
    expect(r.resultado).toBe('no-cumple');
    expect(r.noCumplen).toEqual(['transporte']);
    expect(r.cumplen).toEqual(['salud']);
  });

  it('un cumplimiento parcial (Colegio con un nivel fuera, o zona condicionada) no cuenta como cumple', () => {
    const c = crear({ entorno: entorno({ educacion: { inicial: serv('CUMPLE', 1, 500), primaria: serv('NO CUMPLE', 3000, 1500), secundaria: serv('CUMPLE', 1, 3000) } }) });
    expect(Comparar.evaluarPrioridades(c, ['educacion']).resultado).toBe('no-cumple');
    const cond = crear({ zona: { codigo: 'ZRE', regla: { nombre: 'N', edificable: 'condicionado' }, borde: {} } });
    expect(Comparar.evaluarPrioridades(cond, ['zonificacion']).resultado).toBe('no-cumple');
  });

  it('con SIN DATO y sin incumplimientos queda incompleto: no se puede confirmar', () => {
    const c = crear({ entorno: entorno({ salud: serv('SIN DATO', null, 1000, null) }) });
    const r = Comparar.evaluarPrioridades(c, ['salud', 'transporte']);
    expect(r.resultado).toBe('incompleto');
    expect(r.sinDato).toEqual(['salud']);
  });

  it('un incumplimiento pesa más que un dato faltante', () => {
    const c = crear({ entorno: entorno({ salud: serv('SIN DATO', null, 1000, null), transporte: serv('NO CUMPLE', 900, 400) }) });
    expect(Comparar.evaluarPrioridades(c, ['salud', 'transporte']).resultado).toBe('no-cumple');
  });

  it('quienesCumplen devuelve solo los candidatos que cumplen todas las prioridades', () => {
    const bueno = crear();
    const malo = crear({ entorno: entorno({ areaVerde: serv('NO CUMPLE', 800, 300) }) });
    expect(Comparar.quienesCumplen([bueno, malo], ['salud', 'areaVerde'])).toEqual([bueno.id]);
    expect(Comparar.quienesCumplen([malo], ['areaVerde'])).toEqual([]);
  });

  it('no hay puntaje global: el resultado no trae ninguna suma ni peso', () => {
    const r = Comparar.evaluarPrioridades(crear(), ['salud', 'transporte']);
    expect(Object.keys(r).sort()).toEqual(['cumplen', 'informativas', 'noCumplen', 'resultado', 'sinDato', 'total']);
  });
});

describe('Comparar.celda: toda distancia dice «en línea recta»', () => {
  it('ninguna celda con una distancia omite el rótulo', () => {
    const c = crear({ zona: { ...zonaSi, borde: { alerta: true, distanciaM: 9, codigo: 'I1' } } });
    Comparar.VARIABLES.forEach((v: { id: string }) => {
      Comparar.celda(c, v.id).partes.forEach((p: { texto: string }) => {
        if (/d+(,d+)? (m|km)/.test(p.texto.replace(/ref. d+ m/g, ''))) expect(p.texto).toContain('en línea recta');
      });
    });
  });
});

describe('Comparar.dominancias (relación entre dos puntos, no un ganador)', () => {
  const sin = (...ids: string[]) => {
    const roto: Record<string, any> = {
      salud: serv('NO CUMPLE', 3000, 1000), transporte: serv('NO CUMPLE', 3000, 400), areaVerde: serv('NO CUMPLE', 3000, 300),
    };
    const o: Record<string, any> = {};
    ids.forEach((id) => { o[id] = roto[id]; });
    return crear({ entorno: entorno(o) });
  };

  it('A domina a B si cumple todo lo que cumple B y algo más, y dice qué más', () => {
    const a = sin('areaVerde'); // cumple salud y transporte
    const b = sin('transporte', 'areaVerde'); // cumple solo salud
    const d = Comparar.dominancias([a, b], ['salud', 'transporte']);
    expect(d).toEqual([{ mayor: a.id, menor: b.id, extra: ['transporte'] }]);
  });

  it('no hay dominancia si cada punto cumple una prioridad que el otro no', () => {
    const a = sin('transporte');
    const b = sin('salud');
    expect(Comparar.dominancias([a, b], ['salud', 'transporte'])).toEqual([]);
  });

  it('no hay dominancia si cumplen lo mismo', () => {
    expect(Comparar.dominancias([sin('areaVerde'), sin('areaVerde')], ['salud', 'transporte'])).toEqual([]);
  });

  it('sin prioridades no hay dominancia', () => {
    expect(Comparar.dominancias([sin(), sin('salud')], [])).toEqual([]);
  });

  it('con tres puntos informa cada par dominado', () => {
    const todo3 = sin();
    const dos = sin('areaVerde');
    const uno = sin('transporte', 'areaVerde');
    const d = Comparar.dominancias([uno, dos, todo3], ['salud', 'transporte', 'areaVerde']);
    expect(d.map((x: any) => [x.mayor, x.menor])).toEqual(expect.arrayContaining([[dos.id, uno.id], [todo3.id, uno.id], [todo3.id, dos.id]]));
    expect(d).toHaveLength(3);
  });

  it('el resultado nunca declara un ganador ni un puntaje', () => {
    const d = Comparar.dominancias([sin(), sin('salud')], ['salud']);
    d.forEach((x: any) => expect(Object.keys(x).sort()).toEqual(['extra', 'mayor', 'menor']));
  });
});

describe('Comparar.celda', () => {
  it('muestra distancia y umbral de un servicio', () => {
    expect(Comparar.celda(crear(), 'salud')).toEqual({ estado: 'CUMPLE', partes: [{ texto: '300 m en línea recta · ref. 1000 m' }] });
  });

  it('formatea los kilómetros con coma decimal', () => {
    const c = crear({ entorno: entorno({ salud: serv('NO CUMPLE', 1840, 1000) }) });
    expect(Comparar.celda(c, 'salud').partes[0].texto).toBe('1,84 km en línea recta · ref. 1000 m');
  });

  it('dice «Sin dato» cuando no hay distancia', () => {
    const c = crear({ entorno: entorno({ transporte: serv('SIN DATO', null, 400, null) }) });
    expect(Comparar.celda(c, 'transporte')).toEqual({ estado: 'SIN DATO', partes: [{ texto: 'Sin dato' }] });
  });

  it('Colegio trae una línea por nivel con su propio estado', () => {
    const celda = Comparar.celda(crear(), 'educacion');
    expect(celda.partes.map((p: any) => p.etiqueta)).toEqual(['Inicial', 'Primaria', 'Secundaria']);
    expect(celda.partes[0]).toEqual({ etiqueta: 'Inicial', estado: 'CUMPLE', texto: '200 m en línea recta · ref. 500 m' });
  });

  it('la zonificación muestra código, estado del plano y el aviso de borde', () => {
    const c = crear({ zona: { ...zonaSi, borde: { alerta: true, distanciaM: 14, codigo: 'I1' } } });
    expect(Comparar.celda(c, 'zonificacion')).toEqual({
      estado: 'CUMPLE',
      partes: [{ texto: 'RDM · Construible' }, { texto: 'Otra zona a 14 m en línea recta' }],
    });
  });
});

describe('Comparar almacenamiento', () => {
  const memoria = () => {
    const d: Record<string, string> = {};
    return { getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; }, d };
  };
  const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };

  it('guarda y lee las prioridades normalizadas', () => {
    const a = memoria();
    Comparar.guardarPrioridades(a, ['areaVerde', 'salud', 'basura']);
    expect(a.d[Comparar.CLAVE_PRIORIDADES]).toBe('["salud","areaVerde"]');
    expect(Comparar.leerPrioridades(a)).toEqual(['salud', 'areaVerde']);
  });

  it('lee [] si no hay nada, si el JSON está roto o si el almacenamiento lanza', () => {
    expect(Comparar.leerPrioridades(memoria())).toEqual([]);
    const sucio = memoria();
    sucio.setItem(Comparar.CLAVE_PRIORIDADES, '{no es json');
    expect(Comparar.leerPrioridades(sucio)).toEqual([]);
    expect(Comparar.leerPrioridades(roto)).toEqual([]);
    expect(Comparar.leerPrioridades(null)).toEqual([]);
  });

  it('guardar no lanza aunque el almacenamiento falle o no exista', () => {
    expect(() => Comparar.guardarPrioridades(roto, ['salud'])).not.toThrow();
    expect(() => Comparar.guardarPrioridades(null, ['salud'])).not.toThrow();
    expect(() => Comparar.guardarCandidatos(roto, [crear()])).not.toThrow();
  });

  it('guarda y recupera los candidatos', () => {
    const a = memoria();
    const lista = [crear(), crear()];
    Comparar.guardarCandidatos(a, lista);
    expect(Comparar.leerCandidatos(a)).toEqual(lista);
  });

  it('descarta candidatos guardados con una forma inválida y respeta el máximo', () => {
    const a = memoria();
    const bueno = crear();
    const sinEstado = { ...crear(), variables: { ...crear().variables, salud: { estado: 'INVENTADO' } } };
    a.setItem(Comparar.CLAVE_CANDIDATOS, JSON.stringify([bueno, sinEstado, { id: 1 }, null, 'x']));
    expect(Comparar.leerCandidatos(a)).toEqual([bueno]);
    a.setItem(Comparar.CLAVE_CANDIDATOS, JSON.stringify([crear(), crear(), crear(), crear(), crear()]));
    expect(Comparar.leerCandidatos(a)).toHaveLength(Comparar.MAX_CANDIDATOS);
    a.setItem(Comparar.CLAVE_CANDIDATOS, '"texto"');
    expect(Comparar.leerCandidatos(a)).toEqual([]);
  });
});

// ------------------------------------------------- Quebradas y contexto de riesgo (INFORMATIVO)
const cauce = (distanciaM: number | null, extra = {}) => ({ estado: distanciaM === null ? 'SIN DATO' : 'INFORMATIVO', nombre: 'Quebrada El Cuico', tipo: 'Quebrada', distanciaM, ...extra });
const ctxOk = {
  peligros: { estado: 'INFORMATIVO', total: 3, radioM: 500, distanciaM: 120, masCercano: { subtipo: 'Flujo de detritos', tipo: 'Flujos' } },
  sismos: { estado: 'INFORMATIVO', total: 12, radioM: 100000, magnitudMaxima: 4.8, masReciente: '2026-07-15', desde: '2026-01-01', hasta: '2026-11-02' },
};

describe('Comparar: quebradas y cauces (INFORMATIVO salvo el umbral del usuario)', () => {
  it('guarda la distancia y el nombre del cauce como INFORMATIVO (no inventa cumple/no cumple)', () => {
    const c = crear({ cauce: cauce(180) });
    expect(c.variables.quebradas).toMatchObject({ estado: 'INFORMATIVO', distanciaM: 180, nombre: 'Quebrada El Cuico', umbralM: null, segunUmbralUsuario: false });
  });

  it('sin dato de cauces queda SIN DATO', () => {
    expect(crear().variables.quebradas.estado).toBe('SIN DATO');
    expect(crear({ cauce: cauce(null) }).variables.quebradas.estado).toBe('SIN DATO');
  });

  it('conUmbrales aplica el umbral del usuario sin modificar el candidato guardado', () => {
    const c = crear({ cauce: cauce(180) });
    expect(Comparar.conUmbrales(c, { quebradaMinM: 100 }).variables.quebradas).toMatchObject({ estado: 'CUMPLE', umbralM: 100, segunUmbralUsuario: true });
    expect(Comparar.conUmbrales(c, { quebradaMinM: 300 }).variables.quebradas).toMatchObject({ estado: 'NO CUMPLE', umbralM: 300, segunUmbralUsuario: true });
    expect(Comparar.conUmbrales(c, { quebradaMinM: null }).variables.quebradas.estado).toBe('INFORMATIVO');
    expect(Comparar.conUmbrales(c, undefined).variables.quebradas.estado).toBe('INFORMATIVO');
    expect(c.variables.quebradas.estado).toBe('INFORMATIVO');
  });

  it('un cauce SIN DATO sigue SIN DATO aunque haya umbral', () => {
    expect(Comparar.conUmbrales(crear(), { quebradaMinM: 100 }).variables.quebradas).toMatchObject({ estado: 'SIN DATO', segunUmbralUsuario: false });
  });

  it('como prioridad, sin umbral del usuario no se puede confirmar: queda incompleto y lo dice', () => {
    const c = crear({ cauce: cauce(500) });
    const r = Comparar.evaluarPrioridades(c, ['quebradas']);
    expect(r).toMatchObject({ resultado: 'incompleto', informativas: ['quebradas'], cumplen: [], noCumplen: [] });
  });

  it('como prioridad, con el umbral del usuario cumple o no cumple', () => {
    const c = crear({ cauce: cauce(500) });
    expect(Comparar.evaluarPrioridades(c, ['quebradas'], { quebradaMinM: 300 }).resultado).toBe('cumple');
    expect(Comparar.evaluarPrioridades(c, ['quebradas'], { quebradaMinM: 800 })).toMatchObject({ resultado: 'no-cumple', noCumplen: ['quebradas'] });
  });

  it('quienesCumplen y dominancias usan el umbral del usuario', () => {
    const lejos = crear({ cauce: cauce(900) });
    const cerca = crear({ cauce: cauce(100) });
    expect(Comparar.quienesCumplen([lejos, cerca], ['quebradas'], { quebradaMinM: 300 })).toEqual([lejos.id]);
    expect(Comparar.quienesCumplen([lejos, cerca], ['quebradas'])).toEqual([]);
    expect(Comparar.dominancias([lejos, cerca], ['quebradas', 'salud'], { quebradaMinM: 300 })).toEqual([{ mayor: lejos.id, menor: cerca.id, extra: ['quebradas'] }]);
  });

  it('la celda muestra nombre, distancia en línea recta y que no hay umbral normativo', () => {
    const c = crear({ cauce: cauce(180) });
    const cel = Comparar.celda(c, 'quebradas');
    expect(cel.estado).toBe('INFORMATIVO');
    expect(cel.partes[0].texto).toBe('Quebrada El Cuico · 180 m en línea recta');
    expect(cel.partes[1].texto).toMatch(/Sin umbral normativo/);
  });

  it('con umbral del usuario la celda dice «Según tu umbral»', () => {
    const cel = Comparar.celda(crear({ cauce: cauce(180) }), 'quebradas', { quebradaMinM: 250 });
    expect(cel.estado).toBe('NO CUMPLE');
    expect(cel.partes[1].texto).toBe('Según tu umbral: al menos 250 m');
  });

  it('la celda sin dato dice «Sin dato»', () => {
    expect(Comparar.celda(crear(), 'quebradas')).toEqual({ estado: 'SIN DATO', partes: [{ texto: 'Sin dato' }] });
  });

  it('un cauce sin tipo en el nombre agrega el tipo entre paréntesis (por ejemplo Río)', () => {
    const cel = Comparar.celda(crear({ cauce: cauce(50, { nombre: 'Chili', tipo: 'Río' }) }), 'quebradas');
    expect(cel.partes[0].texto).toBe('Chili (río) · 50 m en línea recta');
  });
});

describe('Comparar: peligro volcánico del Misti (informativo)', () => {
  const volcan = { estado: 'INFORMATIVO', enZona: true, frase: 'Tu punto está en zona de peligro bajo por lahares del Misti, según el IGP.', resumen: [{ tipo: 'lahar', nivel: 'bajo' }] };

  it('es una fila de contexto informativa: nunca prioridad, cumple ni puntaje', () => {
    const c = crear({ cauce: cauce(180), contexto: { peligros: null, sismos: null, volcan } });
    const f = Comparar.filas([c], []);
    const fila = f.contexto.find((x: { id: string }) => x.id === 'volcan');
    expect(fila.prioritaria).toBe(false);
    expect(fila.celdas[0].estado).toBe('INFORMATIVO');
    expect(fila.celdas[0].partes[0].texto).toBe('En zona de peligro bajo por lahares');
    expect(fila.celdas[0].mejor).toBe(false);
  });

  it('fuera de las zonas lo dice sin afirmar que no haya peligro; sin dato queda SIN DATO', () => {
    const fuera = crear({ cauce: cauce(180), contexto: { volcan: { ...volcan, enZona: false, resumen: [], frase: 'Tu punto no cae dentro de ninguna zona…' } } });
    expect(Comparar.filas([fuera], []).contexto.find((x: { id: string }) => x.id === 'volcan').celdas[0].partes[0].texto).toBe('Fuera de las zonas mapeadas por el IGP');
    const sin = crear({ cauce: cauce(180), contexto: { volcan: { estado: 'SIN DATO' } } });
    expect(Comparar.filas([sin], []).contexto.find((x: { id: string }) => x.id === 'volcan').celdas[0].estado).toBe('SIN DATO');
  });

  it('un punto guardado antes de existir la fila sigue siendo válido y muestra «Sin dato»', () => {
    const viejo = crear({ cauce: cauce(180) });
    delete viejo.contexto.volcan;
    const a = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    const store: Record<string, string> = {};
    Comparar.guardarCandidatos(a, [viejo]);
    expect(Comparar.leerCandidatos(a)).toHaveLength(1);
    expect(Comparar.filas([viejo], []).contexto.find((x: { id: string }) => x.id === 'volcan').celdas[0].estado).toBe('SIN DATO');
  });
});

describe('Comparar: riesgo del distrito ante El Niño (CENEPRED, informativo)', () => {
  const cenepred = { estado: 'INFORMATIVO', titulo: 'Sachaca', inundacion: { nivel: 'Muy alto' }, movimientos_masa: { nivel: 'Alto' } };
  const fila = (cands: unknown[]) => Comparar.filas(cands, []).contexto.find((x: { id: string }) => x.id === 'cenepred');

  it('es una fila de contexto informativa con los dos niveles y la aclaración de que es del distrito', () => {
    const f = fila([crear({ cauce: cauce(180), contexto: { peligros: null, sismos: null, cenepred } })]);
    expect(f.prioritaria).toBe(false);
    expect(f.celdas[0].estado).toBe('INFORMATIVO');
    expect(f.celdas[0].partes.map((p: { texto: string }) => p.texto)).toEqual([
      'Inundaciones: muy alto', 'Movimientos en masa: alto', 'Estimación del distrito de Sachaca en un escenario El Niño; no es del predio',
    ]);
    expect(f.celdas[0].mejor).toBe(false);
    expect(JSON.stringify(f)).not.toMatch(/NO CUMPLE|puntaje/);
  });

  it('sin dato, o con un nivel desconocido, queda SIN DATO', () => {
    expect(fila([crear({ cauce: cauce(180), contexto: { cenepred: { estado: 'SIN DATO' } } })]).celdas[0].estado).toBe('SIN DATO');
    expect(fila([crear({ cauce: cauce(180), contexto: { cenepred: { ...cenepred, inundacion: { nivel: 'Extremo' } } } })]).celdas[0].estado).toBe('SIN DATO');
  });

  it('un punto guardado antes de existir la fila sigue siendo válido y muestra «Sin dato»', () => {
    const viejo = crear({ cauce: cauce(180) });
    delete viejo.contexto.cenepred;
    const store: Record<string, string> = {};
    const a = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    Comparar.guardarCandidatos(a, [viejo]);
    expect(Comparar.leerCandidatos(a)).toHaveLength(1);
    expect(fila([viejo]).celdas[0].estado).toBe('SIN DATO');
  });
});

describe('Comparar: la fuente del cauce', () => {
  it('la celda de quebradas nombra la fuente del cauce', () => {
    const cel = Comparar.celda(crear({ cauce: cauce(50, { nombre: 'Quebrada Añashuayco', tipo: 'Quebrada', fuenteCorta: 'OpenStreetMap' }) }), 'quebradas');
    expect(cel.partes[0].texto).toBe('Quebrada Añashuayco · 50 m en línea recta · fuente: OpenStreetMap');
  });
});

describe('Comparar: contexto de riesgo (peligros geológicos y sismos), siempre informativo', () => {
  it('guarda el contexto con estado INFORMATIVO y nunca lo vuelve prioridad', () => {
    const c = crear({ contexto: ctxOk });
    expect(c.contexto.peligros).toMatchObject({ estado: 'INFORMATIVO', total: 3, radioM: 500, distanciaM: 120, tipo: 'Flujo de detritos' });
    expect(c.contexto.sismos).toMatchObject({ estado: 'INFORMATIVO', total: 12, radioM: 100000, magnitudMaxima: 4.8, desde: '2026-01-01', hasta: '2026-11-02' });
    expect(Comparar.CONTEXTO.map((x: { id: string }) => x.id)).toEqual(['peligros', 'sismos', 'volcan', 'cenepred']);
    expect(Comparar.normalizarPrioridades(['peligros', 'sismos', 'salud'])).toEqual(['salud']);
  });

  it('sin contexto queda SIN DATO (no se inventan conteos)', () => {
    const c = crear();
    expect(c.contexto.peligros).toMatchObject({ estado: 'SIN DATO', total: null });
    expect(c.contexto.sismos).toMatchObject({ estado: 'SIN DATO', total: null });
    expect(crear({ contexto: { peligros: { estado: 'SIN DATO', total: null }, sismos: undefined } }).contexto.sismos.estado).toBe('SIN DATO');
  });

  it('la celda de peligros dice cuántos, el más cercano y que es en línea recta', () => {
    const cel = Comparar.celdaContexto(crear({ contexto: ctxOk }), 'peligros');
    expect(cel.estado).toBe('INFORMATIVO');
    expect(cel.partes.map((p: { texto: string }) => p.texto)).toEqual(['3 registrados a 500 m o menos', 'El más cercano a 120 m en línea recta (flujo de detritos)']);
  });

  it('la celda de sismos dice cuántos, la magnitud máxima y el periodo que cubre', () => {
    const cel = Comparar.celdaContexto(crear({ contexto: ctxOk }), 'sismos');
    expect(cel.partes.map((p: { texto: string }) => p.texto)).toEqual(['12 sismos a 100 km o menos (en línea recta)', 'Magnitud máxima: 4,8', 'Periodo: 2026-01-01 a 2026-11-02']);
  });

  it('con cero registros dice «0 registrados», no «sin dato»', () => {
    const cero = { peligros: { estado: 'INFORMATIVO', total: 0, radioM: 500, distanciaM: 2400, masCercano: { tipo: 'Caida' } }, sismos: ctxOk.sismos };
    const cel = Comparar.celdaContexto(crear({ contexto: cero }), 'peligros');
    expect(cel.partes[0].texto).toBe('0 registrados a 500 m o menos');
  });

  it('la celda de contexto sin dato dice «Sin dato»', () => {
    expect(Comparar.celdaContexto(crear(), 'sismos')).toEqual({ estado: 'SIN DATO', partes: [{ texto: 'Sin dato' }] });
  });

  it('un candidato guardado sin contexto (de una versión anterior) se descarta al leer', () => {
    const almacen: Record<string, string> = {};
    const a = { getItem: (k: string) => almacen[k] ?? null, setItem: (k: string, v: string) => { almacen[k] = v; } };
    const viejo = { ...crear(), contexto: undefined };
    a.setItem(Comparar.CLAVE_CANDIDATOS, JSON.stringify([viejo]));
    expect(Comparar.leerCandidatos(a)).toEqual([]);
    const nuevo = crear({ contexto: ctxOk });
    Comparar.guardarCandidatos(a, [nuevo]);
    expect(Comparar.leerCandidatos(a)).toEqual([nuevo]);
  });

  it('INFORMATIVO es un estado válido de un candidato guardado', () => {
    const a: Record<string, string> = {};
    const alm = { getItem: (k: string) => a[k] ?? null, setItem: (k: string, v: string) => { a[k] = v; } };
    Comparar.guardarCandidatos(alm, [crear({ cauce: cauce(10), contexto: ctxOk })]);
    expect(Comparar.leerCandidatos(alm)).toHaveLength(1);
  });
});

// ------------------------------------------------- Filas de la comparación (las usan la tabla y las tarjetas del móvil)
describe('Comparar.filas', () => {
  const ctxOk2 = {
    peligros: { estado: 'INFORMATIVO', total: 1, radioM: 500, distanciaM: 200, masCercano: { tipo: 'Flujos' } },
    sismos: { estado: 'INFORMATIVO', total: 5, radioM: 100000, magnitudMaxima: 4, desde: '2026-01-01', hasta: '2026-11-02' },
  };

  it('devuelve una fila por variable y una por contexto, cada una con una celda por punto y en el mismo orden', () => {
    const a = crear({ cauce: cauce(900), contexto: ctxOk2 });
    const b = crear({ cauce: cauce(100), contexto: ctxOk2 });
    const f = Comparar.filas([a, b], ['salud'], { quebradaMinM: 300 });
    expect(f.variables.map((x: { id: string }) => x.id)).toEqual(['zonificacion', 'salud', 'educacion', 'transporte', 'areaVerde', 'quebradas']);
    expect(f.contexto.map((x: { id: string }) => x.id)).toEqual(['peligros', 'sismos', 'volcan', 'cenepred']);
    [...f.variables, ...f.contexto].forEach((fila: { celdas: { candidatoId: string }[] }) => {
      expect(fila.celdas.map((c) => c.candidatoId)).toEqual([a.id, b.id]);
    });
  });

  it('marca las filas que son prioridad y los puntos que cumplen todas', () => {
    const a = crear({ cauce: cauce(900) });
    const b = crear({ cauce: cauce(100) });
    const f = Comparar.filas([a, b], ['quebradas'], { quebradaMinM: 300 });
    expect(f.variables.find((x: { id: string }) => x.id === 'quebradas').prioritaria).toBe(true);
    expect(f.variables.find((x: { id: string }) => x.id === 'salud').prioritaria).toBe(false);
    expect(f.contexto.every((x: { prioritaria: boolean }) => x.prioritaria === false)).toBe(true);
    const q = f.variables.find((x: { id: string }) => x.id === 'quebradas');
    expect(q.celdas.map((c: { mejor: boolean }) => c.mejor)).toEqual([true, false]);
  });

  it('cada celda trae lo mismo que celda() y celdaContexto(), con el umbral del usuario', () => {
    const a = crear({ cauce: cauce(180), contexto: ctxOk2 });
    const f = Comparar.filas([a], [], { quebradaMinM: 250 });
    const q = f.variables.find((x: { id: string }) => x.id === 'quebradas').celdas[0];
    expect(q).toMatchObject({ estado: 'NO CUMPLE', partes: Comparar.celda(a, 'quebradas', { quebradaMinM: 250 }).partes });
    expect(f.contexto[1].celdas[0]).toMatchObject({ estado: 'INFORMATIVO', partes: Comparar.celdaContexto(a, 'sismos').partes });
  });

  it('sin prioridades ningún punto aparece como «mejor»', () => {
    const f = Comparar.filas([crear(), crear()], [], null);
    expect([...f.variables, ...f.contexto].every((x: { celdas: { mejor: boolean }[] }) => x.celdas.every((c) => c.mejor === false))).toBe(true);
  });

  it('sin candidatos devuelve filas vacías, no rompe', () => {
    const f = Comparar.filas([], ['salud'], null);
    expect(f.variables.every((x: { celdas: unknown[] }) => x.celdas.length === 0)).toBe(true);
  });
});

describe('Comparar: precio de oferta del distrito (fila informativa)', () => {
  const precioCayma = {
    estado: 'INFORMATIVO', distrito: 'CAYMA', precioM2: { venta: 4905, alquiler: null }, arriendoMensual: null,
    periodo: { corte: '2026-10-18' }, nAvisos: { venta: 118, arriendo: null }, url: 'https://example.org/estudio',
  };

  it('guarda el precio del distrito en el candidato sin tocar las variables ni las prioridades', () => {
    const c = crear({ precio: precioCayma });
    expect(c.precio).toMatchObject({ estado: 'INFORMATIVO', ventaM2: 4905, nAvisos: 118, corte: '2026-10-18' });
    expect(Object.keys(c.variables)).toEqual(['zonificacion', 'salud', 'educacion', 'transporte', 'areaVerde', 'quebradas']);
    expect(Comparar.VARIABLES.map((v: { id: string }) => v.id)).not.toContain('precio');
  });

  it('la fila es INFORMATIVO con precio, promedio del distrito, avisos, corte y atribución; nunca CUMPLE ni NO CUMPLE', () => {
    const celda = Comparar.celdaMercado(crear({ distrito: 'Cayma', precio: precioCayma }));
    expect(celda.estado).toBe('INFORMATIVO');
    const texto = celda.partes.map((p: { texto: string }) => p.texto).join(' | ');
    expect(texto).toContain('4 905');
    expect(texto).toMatch(/no de este inmueble/);
    expect(texto).toContain('118 avisos');
    expect(texto).toContain('18 de octubre de 2026');
    expect(celda.partes[celda.partes.length - 1]).toEqual({ texto: 'Datos: Aptologia (CC BY 4.0)', url: 'https://example.org/estudio' });
    expect(['CUMPLE', 'NO CUMPLE']).not.toContain(celda.estado);
  });

  it('un distrito sin cifra o un punto sin precio queda SIN DATO con la causa', () => {
    const sin = crear({ precio: { estado: 'SIN DATO', distrito: 'YURA', causa: 'La fuente no publica cifra para este distrito.' } });
    expect(Comparar.celdaMercado(sin).estado).toBe('SIN DATO');
    expect(Comparar.celdaMercado(sin).partes[0].texto).toContain('La fuente no publica cifra');
    expect(Comparar.celdaMercado(crear()).estado).toBe('SIN DATO');
    const viejo = { ...crear(), precio: undefined }; // punto guardado antes de existir la fila
    expect(Comparar.celdaMercado(viejo).estado).toBe('SIN DATO');
  });

  it('filas() trae el bloque mercado aparte, sin prioridad, y un punto viejo guardado sigue siendo válido', () => {
    const a = crear({ precio: precioCayma });
    const f = Comparar.filas([a], []);
    expect(f.mercado).toHaveLength(1);
    expect(f.mercado[0]).toMatchObject({ id: 'precio', prioritaria: false });
    expect(f.mercado[0].celdas[0].mejor).toBe(false);
    const almacen = { getItem: () => JSON.stringify([{ ...a, precio: undefined }]), setItem: () => undefined };
    expect(Comparar.leerCandidatos(almacen)).toHaveLength(1);
  });
});
