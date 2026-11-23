/**
 * Pruebas del chat con el escenario de riesgo del CENEPRED ante El Niño (inundaciones y movimientos en masa, por distrito): cómo se
 * entiende la frase (en el punto y en un distrito), qué se responde con lo ya calculado, que siempre es informativo (nunca «cumple» ni
 * un puntaje) y el contrato con Gemini (esquema y prompt).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const Asistente = require('../public/js/asistente.js');
const Cenepred = require('../public/js/cenepred.js');
const Distritos = require('../public/js/distritos.js');
const LLM = require('../public/js/asistente-llm.js');
const { PROMPT_INTERPRETAR } = require('../api/_lib/gemini.js');

const datosReales = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'riesgo_cenepred_fen2027.json'), 'utf8'));

const valido = (args: unknown) => {
  const r = LLM.validarSpec(args);
  if (!r.ok) throw new Error(`rechazado: ${r.motivo}`);
  return r.spec;
};

describe('Asistente.interpretar: inundaciones, huaicos y el CENEPRED', () => {
  it('«¿Paucarpata se inunda?» es una pregunta de inundación sobre ese distrito', () => {
    const r = Asistente.interpretar('¿Paucarpata se inunda?');
    expect(r.tipo).toBe('cenepred');
    expect(r.distrito).toBe('PAUCARPATA');
    expect(r.cenepredFenomenos).toEqual(['inundacion']);
  });

  it('«riesgo de huaico en Sachaca» es una pregunta de movimientos en masa sobre ese distrito', () => {
    const r = Asistente.interpretar('riesgo de huaico en Sachaca');
    expect(r.tipo).toBe('cenepred');
    expect(r.distrito).toBe('SACHACA');
    expect(r.cenepredFenomenos).toEqual(['movimientos_masa']);
  });

  it('«¿qué dice el CENEPRED de mi punto?» es sobre el distrito del punto y trae los dos fenómenos', () => {
    const r = Asistente.interpretar('¿qué dice el CENEPRED de mi punto?', { hayPunto: true });
    expect(r.tipo).toBe('cenepred');
    expect(r.distrito).toBeNull();
    expect(r.cenepredFenomenos).toEqual([]);
  });

  it.each([
    '¿mi punto se inunda?', '¿hay riesgo de inundación aquí?', '¿qué pasa en mi zona si llega El Niño?', 'movimientos en masa en mi punto',
  ])('«%s» es sobre el punto', (frase) => {
    const r = Asistente.interpretar(frase, { hayPunto: true });
    expect(r.tipo).toBe('cenepred');
    expect(r.distrito).toBeNull();
  });

  it('entiende el distrito con errores de tipeo y guarda qué fenómeno nombra', () => {
    expect(Asistente.interpretar('¿se inunda pauccarpata?').distrito).toBe('PAUCARPATA');
    expect(Asistente.interpretar('deslizamientos o inundaciones en Cayma').cenepredFenomenos).toEqual(['inundacion', 'movimientos_masa']);
    expect(Asistente.interpretar('derrumbes en Yura').cenepredFenomenos).toEqual(['movimientos_masa']);
  });

  it('detecta que pidió verlo en el mapa', () => {
    expect(Asistente.interpretar('muéstrame en el mapa el riesgo de inundación').cenepredMapa).toBe(true);
    expect(Asistente.interpretar('¿Paucarpata se inunda?').cenepredMapa).toBe(false);
  });

  it('«¿qué distritos se inundan?» pide la lista de distritos', () => {
    const r = Asistente.interpretar('¿qué distritos se inundan?');
    expect(r.tipo).toBe('cenepred');
    expect(r.cenepredTodos).toBe(true);
    expect(r.distrito).toBeNull();
  });

  it('un distrito que no es de la provincia se dice, no se adivina', () => {
    expect(Asistente.interpretar('¿Zamacola se inunda?').tipo).toBe('distrito_desconocido');
    expect(Asistente.interpretar('riesgo de huaico en Zamacola').tipo).toBe('distrito_desconocido');
  });

  it('una búsqueda de zonas «lejos de inundaciones» no se atiende y lo dice', () => {
    const r = Asistente.interpretar('busco una zona con colegio y parque lejos de inundaciones');
    expect(r.tipo).toBe('no_soportado');
    expect(r.temaNoSoportado).toBe('cenepred_busqueda');
    expect(Asistente.responder(r, {}).texto).toMatch(/Todavía no puedo buscar zonas según el riesgo de inundación/);
  });

  it('no roba las preguntas de siempre: huaico sin distrito, quebradas, peligros, volcán, buses, precios, perfil y fuentes', () => {
    expect(Asistente.interpretar('hay riesgo de huaico').tipo).toBe('quebrada');
    expect(Asistente.interpretar('¿hay una quebrada cerca de mi punto?').tipo).toBe('quebrada');
    expect(Asistente.interpretar('¿hay peligros geológicos cerca?').tipo).toBe('peligros');
    expect(Asistente.interpretar('¿Paucarpata está en peligro por el Misti?').tipo).toBe('volcan');
    expect(Asistente.interpretar('¿qué líneas pasan por Paucarpata?').tipo).toBe('rutas');
    expect(Asistente.interpretar('¿cuánto cuesta el m² en Cayma?').tipo).toBe('precio');
    expect(Asistente.interpretar('cuéntame de Sachaca').tipo).toBe('perfil');
    expect(Asistente.interpretar('quiero vivir en Cayma').tipo).toBe('perfil');
    expect(Asistente.interpretar('¿de dónde salen los datos del CENEPRED?').tipo).toBe('fuentes');
  });
});

describe('Asistente.responder: escenario del CENEPRED sobre el punto', () => {
  const punto = { lat: -16.44, lon: -71.57 };
  const sachaca = Cenepred.buscar(datosReales, 'Sachaca');
  const cenepred = { ...sachaca, frase: Cenepred.frase(sachaca), lineas: Cenepred.lineas(sachaca), fecha: '2026-11-03' };
  const pregunta = (frase: string, ctx = {}) => Asistente.responder(Asistente.interpretar(frase, { hayPunto: true }), { punto, cenepred, ...ctx });

  it('dice el nivel de los dos fenómenos, que es del distrito, los conteos y los límites', () => {
    const t = pregunta('¿qué dice el CENEPRED de mi punto?').texto;
    expect(t).toContain('Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones y alto ante movimientos en masa en un escenario El Niño (estimación por distrito, no del predio).');
    expect(t).toMatch(/• Inundaciones: riesgo muy alto\. En zonas de mayor susceptibilidad a inundaciones: 7 926 viviendas/);
    expect(t).toMatch(/Una zona de mayor susceptibilidad es donde el terreno es más propenso/);
    expect(t).toMatch(/deslizamientos, huaicos y derrumbes/);
    expect(t).toMatch(/no una predicción ni una evaluación de tu predio/);
    expect(t).toMatch(/evaluación de riesgos de la municipalidad/);
    expect(t).toMatch(/Datos del CENEPRED congelados el 2026-11-03/);
  });

  it('con un fenómeno pedido solo habla de ese', () => {
    const t = pregunta('¿mi punto se inunda?').texto;
    expect(t).toContain('riesgo muy alto ante inundaciones en un escenario El Niño');
    expect(t).not.toMatch(/movimientos en masa/);
  });

  it('nunca dice cumple, no cumple ni da un puntaje', () => {
    expect(pregunta('¿qué dice el CENEPRED de mi punto?').texto).not.toMatch(/\bcumple\b|no cumple|puntaje/i);
  });

  it('no dibuja nada si no lo pidió y dibuja los distritos si lo pidió', () => {
    expect(pregunta('¿mi punto se inunda?').mapa).toBeUndefined();
    expect(pregunta('muéstrame en el mapa si mi punto se inunda').mapa).toEqual({ distrito: null, capas: [], cenepred: { fenomeno: 'inundacion' } });
    expect(pregunta('muéstrame el mapa de movimientos en masa').mapa.cenepred.fenomeno).toBe('movimientos_masa');
  });

  it('si pidió el mapa de los dos fenómenos, dibuja la inundación y lo avisa', () => {
    const r = pregunta('muéstrame el mapa del riesgo del CENEPRED');
    expect(r.mapa.cenepred.fenomeno).toBe('inundacion');
    expect(r.texto).toMatch(/pide «mapa del riesgo de movimientos en masa»/);
  });

  it('sin punto pide elegirlo o preguntar por un distrito', () => {
    const r = Asistente.responder(Asistente.interpretar('¿qué dice el CENEPRED?'), {});
    expect(r.texto).toMatch(/Elige un punto en el mapa/);
    expect(r.texto).toMatch(/Paucarpata se inunda/);
  });

  it('sin dato no inventa nada y manda al SIGRID y a la municipalidad', () => {
    const t = pregunta('¿mi punto se inunda?', { cenepred: { estado: 'SIN DATO', error: 'El escenario no cubre este distrito' } }).texto;
    expect(t).toMatch(/No tengo el escenario de riesgo del CENEPRED para tu punto \(El escenario no cubre este distrito\), así que no lo afirmo/);
    expect(t).toMatch(/SIGRID \(CENEPRED\)/);
    expect(pregunta('¿mi punto se inunda?', { cenepred: null }).texto).toMatch(/Todavía estoy calculando/);
  });

  it('la explicación cita la fuente y los límites', () => {
    const e = Asistente.explicar('cenepred');
    expect(JSON.stringify(e.fuente)).toMatch(/CENEPRED/);
    expect(JSON.stringify(e.fuente)).toMatch(/mayo de 2026/);
    expect(JSON.stringify(e.limites)).toMatch(/una estimación por distrito/);
  });
});

describe('Asistente.responder: escenario del CENEPRED sobre un distrito', () => {
  const ctx = { distritoTitulo: 'Paucarpata', cenepredDatos: datosReales };
  const responder = (frase: string, extra = {}) => Asistente.responder(Asistente.interpretar(frase), { ...ctx, ...extra });

  it('«¿Paucarpata se inunda?» responde con el nivel del distrito, sin decir sí ni no', () => {
    const t = responder('¿Paucarpata se inunda?').texto;
    expect(t).toContain('Según el CENEPRED, el distrito de Paucarpata tiene riesgo alto ante inundaciones en un escenario El Niño (estimación por distrito, no del predio).');
    expect(t).toMatch(/36 020 viviendas/);
    expect(t).not.toMatch(/\bcumple\b|puntaje/i);
    expect(t).not.toMatch(/^Sí\b|^No,/);
  });

  it('«riesgo de huaico en Sachaca» responde con movimientos en masa', () => {
    const t = responder('riesgo de huaico en Sachaca', { distritoTitulo: 'Sachaca' }).texto;
    expect(t).toContain('el distrito de Sachaca tiene riesgo alto ante movimientos en masa en un escenario El Niño');
    expect(t).not.toMatch(/ante inundaciones/);
  });

  it('dibuja el distrito con todos los demás coloreados solo si lo pidió', () => {
    expect(responder('¿Paucarpata se inunda?').mapa).toBeUndefined();
    expect(responder('muéstrame en el mapa si Paucarpata se inunda').mapa).toEqual({ distrito: 'PAUCARPATA', capas: [], cenepred: { fenomeno: 'inundacion' } });
  });

  it('«¿qué distritos se inundan?» lista los distritos por nivel, del más alto al más bajo', () => {
    const t = Asistente.responder(Asistente.interpretar('¿qué distritos se inundan?'), { cenepredDatos: datosReales }).texto;
    expect(t).toMatch(/Estos son los 25 distritos/);
    expect(t).toMatch(/• Riesgo muy alto \(7\): .*Sachaca/);
    expect(t.indexOf('Riesgo muy alto')).toBeLessThan(t.indexOf('Riesgo alto ('));
    expect(t).not.toMatch(/movimientos en masa, según/);
  });

  it('un distrito fuera de los datos se dice', () => {
    const fuera = Asistente.responder({ ...Asistente.interpretar('¿Paucarpata se inunda?'), distritoFuera: true }, ctx);
    expect(fuera.texto).toMatch(/no está en los datos de GeoVerificador/);
    const vitor = Asistente.responder(Asistente.interpretar('¿se inunda Vítor?'), { ...ctx, distritoTitulo: 'Vítor' });
    expect(vitor.texto).toMatch(/no está en los datos de GeoVerificador/);
  });

  it('si falta el archivo lo dice sin inventar', () => {
    expect(responder('¿Paucarpata se inunda?', { cenepredDatos: null }).texto).toMatch(/No pude leer el archivo del escenario de riesgo del CENEPRED/);
  });
});

describe('Asistente.responder: el perfil del distrito suma el escenario del CENEPRED', () => {
  const perfil = {
    conteo: {
      colegios: { total: 235, inicial: 134, primaria: 90, secundaria: 55, sinNivel: 0, lista: [] },
      salud: { total: 18, lista: [] },
      paraderos: { total: 43, lista: [] },
      parques: { total: 145, grandes: 8, areaTotalM2: 400000, lista: [] },
    },
    zonas: { conPlano: true, partes: [{ id: 'residencial', etiqueta: 'residencial', pct: 61.6 }] },
    cauces: { nombres: ['Río Chili'], total: 2 },
  };
  it('agrega una línea con los dos niveles cuando hay dato y no cuando falta', () => {
    const intencion = Asistente.interpretar('cuéntame de Paucarpata');
    const con = Asistente.responder(intencion, { distritoTitulo: 'Paucarpata', perfil, fecha: '2026-10-28', cenepredDatos: datosReales });
    expect(con.texto).toContain('• Riesgo ante El Niño (CENEPRED): inundaciones, riesgo alto; movimientos en masa, riesgo medio. Es una estimación del distrito, no de tu predio.');
    expect(con.texto).not.toMatch(/\bcumple\b|puntaje/i);
    const sin = Asistente.responder(intencion, { distritoTitulo: 'Paucarpata', perfil, fecha: '2026-10-28' });
    expect(sin.texto).not.toContain('Riesgo ante El Niño');
  });
});

describe('Asistente: ayuda y fuentes mencionan el escenario del CENEPRED', () => {
  it('la ayuda da los tres ejemplos y las fuentes citan el CENEPRED y que no es del predio', () => {
    const ayuda = Asistente.responder(Asistente.interpretar('ayuda'), {}).texto;
    expect(ayuda).toMatch(/¿Paucarpata se inunda\?/);
    expect(ayuda).toMatch(/riesgo de huaico en Sachaca/);
    expect(ayuda).toMatch(/¿qué dice el CENEPRED de mi punto\?/);
    const fuentes = Asistente.responder(Asistente.interpretar('de dónde salen los datos'), {}).texto;
    expect(fuentes).toMatch(/escenario del CENEPRED/);
    expect(fuentes).toMatch(/no es una evaluación de tu predio/);
  });
});

describe('AsistenteLLM: intención riesgo_cenepred', () => {
  it('el esquema ofrece la intención y los campos, y el prompt la explica con los tres ejemplos', () => {
    const p = LLM.HERRAMIENTA.parameters.properties;
    expect(p.intencion.enum).toContain('riesgo_cenepred');
    expect(p.fenomenoRiesgo.enum).toEqual(['inundacion', 'movimientos_masa']);
    expect(p.verEnMapa.type).toBe('boolean');
    expect(p.intencion.description).toMatch(/riesgo_cenepred = riesgo de inundación o de movimientos en masa/);
    expect(PROMPT_INTERPRETAR).toMatch(/intencion=riesgo_cenepred/);
    expect(PROMPT_INTERPRETAR).toMatch(/¿Paucarpata se inunda\?/);
    expect(PROMPT_INTERPRETAR).toMatch(/riesgo de huaico en Sachaca/);
    expect(PROMPT_INTERPRETAR).toMatch(/¿qué dice el CENEPRED de mi punto\?/);
    expect(PROMPT_INTERPRETAR).toMatch(/not an assessment of a property/);
  });

  it('valida el fenómeno y el mapa, y los deja solo en esa intención', () => {
    expect(valido({ intencion: 'riesgo_cenepred', distrito: 'Paucarpata', fenomenoRiesgo: 'inundacion', verEnMapa: true })).toMatchObject({ intencion: 'riesgo_cenepred', distrito: 'Paucarpata', fenomenoRiesgo: 'inundacion', verEnMapa: true });
    expect(valido({ intencion: 'riesgo_cenepred' })).toMatchObject({ distrito: null, fenomenoRiesgo: null, verEnMapa: false });
    expect(LLM.validarSpec({ intencion: 'riesgo_cenepred', fenomenoRiesgo: 'terremoto' })).toEqual({ ok: false, motivo: 'fenomenoRiesgo_invalido' });
    expect(LLM.validarSpec({ intencion: 'riesgo_cenepred', verEnMapa: 'si' })).toEqual({ ok: false, motivo: 'verEnMapa_no_es_booleano' });
    const otra = LLM.validarSpec({ intencion: 'zona', fenomenoRiesgo: 'inundacion', verEnMapa: true }).spec;
    expect(otra).not.toHaveProperty('fenomenoRiesgo');
    expect(otra).not.toHaveProperty('verEnMapa');
  });

  it('la consulta del modelo da la misma intención que las reglas con la frase equivalente', () => {
    expect(LLM.aIntencion(valido({ intencion: 'riesgo_cenepred', distrito: 'Paucarpata', fenomenoRiesgo: 'inundacion' }))).toEqual(Asistente.interpretar('¿Paucarpata se inunda?'));
    expect(LLM.aIntencion(valido({ intencion: 'riesgo_cenepred', distrito: 'Sachaca', fenomenoRiesgo: 'movimientos_masa' }))).toEqual(Asistente.interpretar('riesgo de huaico en Sachaca'));
    expect(LLM.aIntencion(valido({ intencion: 'riesgo_cenepred' }))).toEqual(Asistente.interpretar('¿qué dice el CENEPRED de mi punto?', { hayPunto: true }));
    expect(LLM.aIntencion(valido({ intencion: 'riesgo_cenepred', verEnMapa: true })).cenepredMapa).toBe(true);
  });

  it('un distrito que no existe se dice, no se adivina', () => {
    expect(LLM.aIntencion(valido({ intencion: 'riesgo_cenepred', distrito: 'Zamacola' })).tipo).toBe('distrito_desconocido');
  });

  it('las dos rutas usan los mismos nombres de distrito que el archivo real', () => {
    Distritos.cargarParaPruebas(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8')));
    expect(Cenepred.buscar(datosReales, LLM.aIntencion(valido({ intencion: 'riesgo_cenepred', distrito: 'sachaca' })).distrito).estado).toBe('INFORMATIVO');
  });
});
