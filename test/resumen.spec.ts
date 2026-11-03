/**
 * Pruebas de public/js/resumen.js: el resumen en lenguaje llano de un punto (para el chat y para el inicio de la ficha).
 * Solo reordena lo que la ficha ya calculó; no agrega datos.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Resumen = require('../public/js/resumen.js');

const r = (estado: string, distanciaM: number | null, umbralM: number, nombre = 'X') => ({ estado, distanciaM, umbralM, nombre });
const ok = (d: number, u: number) => r('CUMPLE', d, u);
const no = (d: number, u: number) => r('NO CUMPLE', d, u);

const RDM1 = {
  codigo: 'RDM-1',
  regla: { nombre: 'Residencial densidad media tipo 1', grupo: 'residencial', edificable: 'si', pisos_base: 3, pisos_max: 4, nota: 'Base = unifamiliar (lote 90 m²); máximo = multifamiliar (lote 150 m²)' },
};
const entorno = {
  salud: ok(351, 1000),
  educacion: { inicial: ok(200, 500), primaria: ok(900, 1500), secundaria: ok(2000, 3000) },
  transporte: no(1040, 400),
  areaVerde: no(1200, 300),
};
const cauce = { estado: 'INFORMATIVO', nombre: 'Río Chili', distanciaM: 1860 };
const base = { distrito: 'SACHACA', zona: RDM1, entorno, cauce };

describe('Resumen.punto', () => {
  const s = Resumen.punto(base);

  it('dice dónde estás y qué se puede construir, en llano', () => {
    expect(s.texto).toContain('Estás en Sachaca, zona RDM-1 (residencial densidad media tipo 1): puedes construir hasta 3 pisos (4 si es multifamiliar).');
  });

  it('dice lo que tienes cerca con una marca', () => {
    expect(s.texto).toContain('Cerca tienes: posta a 351 m ✓, colegios de los 3 niveles ✓.');
  });

  it('dice lo que queda más lejos de lo recomendado, con la distancia y la referencia', () => {
    expect(s.texto).toContain('Más lejos de lo recomendado: paradero (1,04 km, ref. 400 m), parque (1,20 km, ref. 300 m).');
  });

  it('dice lo más cercano en riesgo con el nombre del cauce', () => {
    expect(s.texto).toContain('Lo más cercano en riesgo: Río Chili a 1,86 km.');
  });

  it('entrega tres líneas para el inicio de la ficha', () => {
    expect(s.lineas).toHaveLength(3);
    expect(s.lineas[0]).toMatch(/Sachaca/);
    expect(s.lineas[1]).toMatch(/Cerca tienes/);
    expect(s.lineas[2]).toMatch(/Más lejos/);
  });

  it('con colegios solo de algunos niveles los nombra; los que faltan van a «más lejos»', () => {
    const e = { ...entorno, educacion: { inicial: ok(200, 500), primaria: no(2100, 1500), secundaria: ok(2000, 3000) } };
    const t = Resumen.punto({ ...base, entorno: e }).texto;
    expect(t).toContain('colegio inicial ✓, colegio de secundaria ✓');
    expect(t).toContain('colegio de primaria (2,10 km, ref. 1,5 km)');
  });

  it('si todo está cerca no inventa un «más lejos»', () => {
    const e = { salud: ok(100, 1000), educacion: entorno.educacion, transporte: ok(100, 400), areaVerde: ok(100, 300) };
    const t = Resumen.punto({ ...base, entorno: e }).texto;
    expect(t).not.toContain('Más lejos de lo recomendado');
    expect(t).toContain('Cerca tienes: posta a 351'.replace('351', '100'));
  });

  it('lo que no tiene dato se dice como «sin dato», no como lejos ni como cerca', () => {
    const e = { ...entorno, transporte: r('SIN DATO', null, 400) };
    const t = Resumen.punto({ ...base, entorno: e }).texto;
    expect(t).toContain('Sin dato de: paradero');
    expect(t).not.toMatch(/paradero \(/);
  });

  it('un punto fuera del plano lo dice y no inventa parámetros', () => {
    const t = Resumen.punto({ ...base, zona: null }).texto;
    expect(t).toContain('Estás en Sachaca, fuera del área zonificada del plano');
    expect(t).not.toMatch(/pisos/);
  });

  it('una zona no construible o condicionada lo dice en llano', () => {
    const za = { codigo: 'ZA', regla: { nombre: 'Zona agrícola', grupo: 'proteccion', edificable: 'no' } };
    expect(Resumen.punto({ ...base, zona: za }).texto).toMatch(/aquí no se puede construir/);
    const ch = { codigo: 'ZRE-CH', regla: { nombre: 'Reglamentación especial centro histórico', grupo: 'especial', edificable: 'condicionado' } };
    expect(Resumen.punto({ ...base, zona: ch }).texto).toMatch(/depende del plan específico/);
  });

  it('sin pisos en el reglamento remite al reglamento, sin inventar una altura', () => {
    const ce = { codigo: 'CE', regla: { nombre: 'Comercio especializado', grupo: 'comercial', edificable: 'si', pisos_base: null, pisos_max: null } };
    expect(Resumen.punto({ ...base, zona: ce }).texto).toMatch(/la altura la fija el reglamento/);
  });

  it('sin cauce con distancia omite la línea de riesgo', () => {
    expect(Resumen.punto({ ...base, cauce: { estado: 'SIN DATO', nombre: null, distanciaM: null } }).texto).not.toContain('en riesgo');
  });

  it('es referencial y lo dice', () => {
    expect(s.aviso).toMatch(/referencial/);
  });

  it('no usa el lenguaje de «cumple / no cumple» en el texto', () => {
    expect(s.texto).not.toMatch(/no cumple|suelo|coincidencia/i);
  });
});

describe('Resumen.punto: líneas de SmartBus', () => {
  const conRutas = (rutas: unknown) => Resumen.punto({ ...base, entorno: { ...entorno, transporte: { ...entorno.transporte, rutas } } });
  const lineas = [{ linea: 'C2', empresas: ['Cono Norte'] }, { linea: 'C5', empresas: ['EtraBus'] }];

  it('suma «Pasan N líneas a menos de 400 m: …» a la línea de lo que tienes cerca', () => {
    const s = conRutas({ distanciaM: 400, lineas });
    expect(s.texto).toContain('Pasan 2 líneas a menos de 400 m: C2 (Cono Norte), C5 (EtraBus).');
    expect(s.lineas).toHaveLength(3); // sigue siendo un resumen de tres líneas
  });

  it('una sola línea va en singular', () => {
    expect(conRutas({ distanciaM: 400, lineas: lineas.slice(0, 1) }).texto).toContain('Pasa 1 línea a menos de 400 m: C2 (Cono Norte).');
  });

  it('si ninguna pasa, lo dice; si no se calcularon o fallaron, no dice nada', () => {
    expect(conRutas({ distanciaM: 400, lineas: [] }).texto).toContain('Ninguna línea de SmartBus pasa a menos de 400 m.');
    expect(conRutas(null).texto).not.toMatch(/línea/i);
    expect(conRutas({ error: 'sin archivo', lineas: [], distanciaM: 400 }).texto).not.toMatch(/línea/i);
    expect(Resumen.punto(base).texto).not.toMatch(/SmartBus/);
  });

  it('con muchas líneas recorta la lista y dice cuántas más hay', () => {
    const muchas = Array.from({ length: 9 }, (_: unknown, i: number) => ({ linea: `L${i + 1}`, empresas: ['X'] }));
    expect(conRutas({ distanciaM: 400, lineas: muchas }).texto).toContain('Pasan 9 líneas a menos de 400 m: L1 (X)');
    expect(conRutas({ distanciaM: 400, lineas: muchas }).texto).toContain('y 3 más');
  });
});

describe('Resumen.verificar', () => {
  it('lista los trámites por su nombre corto para el chat', () => {
    const v = Resumen.verificar([{ titulo: 'Certificado de Zonificación', entidad: 'IMPLA' }, { titulo: 'Búsqueda en SUNARP', entidad: 'SUNARP' }]);
    expect(v).toContain('• Certificado de Zonificación (IMPLA)');
    expect(v).toContain('• Búsqueda en SUNARP (SUNARP)');
    expect(v).toMatch(/Antes de comprar/);
  });
});
