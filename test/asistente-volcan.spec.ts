/**
 * Pruebas del chat con el peligro volcánico del Misti (zonas del IGP): cómo se entiende la frase (en el punto y en un distrito),
 * qué se responde con lo ya calculado, que siempre es informativo (nunca «cumple» ni un puntaje) y el contrato con Gemini.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');
const Volcan = require('../public/js/volcan.js');
const LLM = require('../public/js/asistente-llm.js');
const { PROMPT_INTERPRETAR } = require('../api/_lib/gemini.js');

const valido = (args: unknown) => {
  const r = LLM.validarSpec(args);
  if (!r.ok) throw new Error(`rechazado: ${r.motivo}`);
  return r.spec;
};

describe('Asistente.interpretar: volcán, Misti, lahares y ceniza', () => {
  it.each([
    '¿estoy en peligro por el volcán?',
    '¿Qué pasa si erupciona el Misti?',
    '¿hay lahares cerca de mi punto?',
    'peligro de ceniza en mi zona',
    '¿Mi punto está en zona de flujos piroclásticos?',
    'avalancha de escombros del Misti',
  ])('«%s» es una pregunta del volcán sobre el punto', (frase) => {
    const r = Asistente.interpretar(frase, { hayPunto: true });
    expect(r.tipo).toBe('volcan');
    expect(r.distrito).toBeNull();
  });

  it('«¿Paucarpata está en peligro por el Misti?» es una pregunta del volcán sobre ese distrito, no un perfil', () => {
    const r = Asistente.interpretar('¿Paucarpata está en peligro por el Misti?');
    expect(r.tipo).toBe('volcan');
    expect(r.distrito).toBe('PAUCARPATA');
  });

  it('entiende el distrito con errores de tipeo', () => {
    expect(Asistente.interpretar('hay lahares en pauccarpata').distrito).toBe('PAUCARPATA');
  });

  it('guarda qué fenómeno nombra la frase', () => {
    expect(Asistente.interpretar('¿hay lahares cerca de mi punto?').volcanTipos).toEqual(['lahar']);
    expect(Asistente.interpretar('¿llega la ceniza del volcán a Cayma?').volcanTipos).toEqual(['ceniza']);
    expect(Asistente.interpretar('flujos piroclásticos o lava en Yura').volcanTipos).toEqual(['flujo_piroclastico', 'lava']);
    expect(Asistente.interpretar('¿estoy en peligro por el volcán?').volcanTipos).toEqual([]);
  });

  it('un distrito que no es de la provincia se dice, no se adivina', () => {
    expect(Asistente.interpretar('qué lahares hay en Zamacola').tipo).toBe('distrito_desconocido');
  });

  it('una búsqueda de zonas «lejos del volcán» no se atiende y lo dice (no ignora el pedido)', () => {
    const r = Asistente.interpretar('busco una zona con colegio y parque lejos del Misti');
    expect(r.tipo).toBe('no_soportado');
    expect(r.temaNoSoportado).toBe('volcan_busqueda');
    const resp = Asistente.responder(r, {});
    expect(resp.texto).toMatch(/Todavía no puedo buscar zonas según el peligro volcánico/);
    expect(resp.texto).toMatch(/Paucarpata está en peligro por el Misti/);
  });

  it('no roba las preguntas de siempre: quebradas, sismos, peligros geológicos, buses y precios', () => {
    expect(Asistente.interpretar('¿hay una quebrada cerca de mi punto?').tipo).toBe('quebrada');
    expect(Asistente.interpretar('¿cuántos sismos hubo?').tipo).toBe('sismos');
    expect(Asistente.interpretar('¿hay peligros geológicos cerca?').tipo).toBe('peligros');
    expect(Asistente.interpretar('¿qué líneas pasan por Paucarpata?').tipo).toBe('rutas');
    expect(Asistente.interpretar('¿cuánto cuesta el m² en Cayma?').tipo).toBe('precio');
  });
});

// Zonas de prueba (grados) y un punto dentro de un lahar bajo con ceniza.
const cuadrado = (x: number, y: number, l: number) => [[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]];
const feat = (tipo: string, nivel: string, ring: number[][], extra = {}) => ({
  type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: { tipo, nivel, etiqueta: `Peligro ${nivel}`, capa: 'Capa', ...extra },
});
const zonas = Volcan.indexar([
  feat('lahar', 'bajo', cuadrado(0, 0, 10)),
  feat('ceniza', 'alto', cuadrado(-5, -5, 20), { escenario: 'pliniana', deposito: '≤ 100 cm' }),
]);
const volcanEn = (lon: number, lat: number) => {
  const resumen = Volcan.resumirPunto(Volcan.enZonas(lat, lon, zonas));
  return { estado: 'INFORMATIVO', enZona: resumen.length > 0, resumen, frase: Volcan.frasePunto(resumen), lineas: Volcan.lineasPunto(resumen), fecha: '2026-11-03' };
};

describe('Asistente.responder: volcán sobre el punto', () => {
  const punto = { lat: 5, lon: 5 };
  const pregunta = (frase: string, ctx = {}) => Asistente.responder(Asistente.interpretar(frase, { hayPunto: true }), { punto, volcan: volcanEn(5, 5), ...ctx });

  it('dice en qué zona cae, de dónde sale y los límites', () => {
    const r = pregunta('¿estoy en peligro por el Misti?');
    expect(r.texto).toContain('Tu punto está en zona de peligro alto por ceniza volcánica (según el escenario de erupción) y bajo por lahares del Misti, según el IGP.');
    expect(r.texto).toContain('• Lahares: peligro bajo.');
    expect(r.texto).toMatch(/escala regional/);
    expect(r.texto).toMatch(/sin fecha de elaboración/);
    expect(r.texto).toMatch(/No es una evaluación de riesgo/);
    expect(r.texto).toMatch(/CENEPRED \(SIGRID\)/);
  });

  it('nunca dice cumple, no cumple ni da un puntaje', () => {
    expect(pregunta('¿estoy en peligro por el Misti?').texto).not.toMatch(/\bcumple\b|no cumple|puntaje|%/i);
  });

  it('con un fenómeno pedido solo habla de ese', () => {
    const r = pregunta('¿hay lahares cerca de mi punto?');
    expect(r.texto).toContain('peligro bajo por lahares del Misti');
    expect(r.texto).not.toContain('ceniza');
  });

  it('un fenómeno que no alcanza el punto lo dice sin afirmar que no haya peligro', () => {
    const r = pregunta('¿hay flujos piroclásticos aquí?');
    expect(r.texto).toMatch(/no cae dentro de ninguna zona de flujos piroclásticos del Misti/);
    expect(r.texto).toMatch(/no significa que no haya peligro/);
  });

  it('dibuja las zonas en el mapa (sin la ceniza) y la ceniza sola no dibuja nada', () => {
    expect(pregunta('¿hay lahares cerca de mi punto?').mapa).toEqual({ distrito: null, capas: [], volcan: { tipos: ['lahar'] } });
    expect(pregunta('¿estoy en peligro por el Misti?').mapa.volcan.tipos).toEqual(['lahar', 'flujo_piroclastico', 'lava', 'avalancha']);
    const ceniza = pregunta('¿llega la ceniza a mi punto?');
    expect(ceniza.mapa).toBeNull();
    expect(ceniza.texto).toMatch(/no la dibujo en el mapa/);
  });

  it('sin punto pide elegirlo o preguntar por un distrito', () => {
    const r = Asistente.responder(Asistente.interpretar('¿hay lahares?'), {});
    expect(r.texto).toMatch(/Elige un punto en el mapa/);
    expect(r.texto).toMatch(/Paucarpata está en peligro por el Misti/);
  });

  it('sin dato del archivo no inventa nada', () => {
    const r = pregunta('¿estoy en peligro por el Misti?', { volcan: { estado: 'SIN DATO', error: 'archivo ausente' } });
    expect(r.texto).toMatch(/No tengo el mapa de peligro volcánico del IGP \(archivo ausente\), así que no lo afirmo/);
    expect(pregunta('¿estoy en peligro por el Misti?', { volcan: null }).texto).toMatch(/Todavía estoy calculando/);
  });

  it('la explicación cita la fuente (IGP e INGEMMET) y los límites', () => {
    const e = Asistente.explicar('volcan');
    expect(JSON.stringify(e.fuente)).toMatch(/Instituto Geofísico del Perú/);
    expect(JSON.stringify(e.fuente)).toMatch(/Boletín Serie C n\.° 100/);
    expect(JSON.stringify(e.limites)).toMatch(/escala regional/);
  });
});

describe('Asistente.responder: volcán sobre un distrito', () => {
  // Un distrito de 2 km de lado dentro del lahar bajo y de la ceniza.
  const g = 2000 / ((Math.PI / 180) * 6371008.8);
  const polys = [[cuadrado(5, 5, g)]];
  const r = Volcan.porDistrito(zonas, polys, { pasoM: 200 });
  const ctx = { distritoTitulo: 'Paucarpata', volcanDistrito: { r, fecha: '2026-11-03' } };
  const responder = (frase: string, extra = {}) => Asistente.responder(Asistente.interpretar(frase), { ...ctx, ...extra });

  it('da la parte del distrito en cada nivel y lo aclara como muestra', () => {
    const t = responder('¿Paucarpata está en peligro por el Misti?');
    expect(t.texto).toContain('Parte de Paucarpata en cada zona de peligro volcánico del Misti, según el IGP');
    expect(t.texto).toContain('• Lahares: 100 % en peligro bajo.');
    expect(t.texto).toContain('• Ceniza volcánica: 100 % en peligro alto.');
    expect(t.texto).toMatch(/muestra de puntos del distrito/);
    expect(t.texto).not.toMatch(/\bcumple\b|puntaje/i);
  });

  it('con un fenómeno pedido solo habla de ese y dibuja el distrito con sus zonas', () => {
    const t = responder('¿hay lahares en Paucarpata?');
    expect(t.texto).toContain('Lahares');
    expect(t.texto).not.toContain('Ceniza');
    expect(t.mapa).toEqual({ distrito: 'PAUCARPATA', capas: [], volcan: { tipos: ['lahar'] } });
  });

  it('un distrito fuera de los datos se dice', () => {
    const fuera = Asistente.responder({ ...Asistente.interpretar('¿hay lahares en Paucarpata?'), distritoFuera: true }, ctx);
    expect(fuera.texto).toMatch(/no está en los datos de GeoVerificador/);
  });

  it('si falló el archivo o aún se calcula, lo dice sin inventar', () => {
    expect(responder('¿hay lahares en Paucarpata?', { volcanDistrito: { error: 'sin archivo' } }).texto).toMatch(/No tengo el mapa de peligro volcánico del IGP \(sin archivo\)/);
    expect(responder('¿hay lahares en Paucarpata?', { volcanDistrito: undefined }).texto).toMatch(/Todavía estoy midiendo/);
  });
});

describe('AsistenteLLM: intención volcan', () => {
  it('el esquema ofrece la intención y el fenómeno, y el prompt la explica sin inventar distritos', () => {
    const p = LLM.HERRAMIENTA.parameters.properties;
    expect(p.intencion.enum).toContain('volcan');
    expect(p.fenomeno.enum).toEqual(['lahar', 'flujo_piroclastico', 'lava', 'avalancha', 'ceniza']);
    expect(PROMPT_INTERPRETAR).toMatch(/intencion=volcan/);
    expect(PROMPT_INTERPRETAR).toMatch(/not a risk assessment/);
    expect(LLM.HERRAMIENTA.parameters.properties.intencion.description).toMatch(/volcan = peligro volcánico/);
  });

  it('valida el fenómeno y el distrito de la consulta', () => {
    expect(valido({ intencion: 'volcan', distrito: 'Paucarpata', fenomeno: 'lahar' })).toMatchObject({ intencion: 'volcan', distrito: 'Paucarpata', fenomeno: 'lahar' });
    expect(LLM.validarSpec({ intencion: 'volcan', fenomeno: 'terremoto' })).toEqual({ ok: false, motivo: 'fenomeno_invalido' });
    expect(LLM.validarSpec({ intencion: 'zona', fenomeno: 'lahar' }).spec).not.toHaveProperty('fenomeno');
  });

  it('la consulta del modelo da la misma intención que las reglas con la frase equivalente', () => {
    const modelo = LLM.aIntencion(valido({ intencion: 'volcan', distrito: 'Paucarpata', fenomeno: 'lahar' }));
    const reglas = Asistente.interpretar('¿hay lahares en Paucarpata?');
    expect(modelo).toEqual(reglas);
    const punto = LLM.aIntencion(valido({ intencion: 'volcan' }));
    expect(punto).toEqual(Asistente.interpretar('¿estoy en peligro por el volcán?', { hayPunto: true }));
  });

  it('un distrito que no existe se dice, no se adivina', () => {
    expect(LLM.aIntencion(valido({ intencion: 'volcan', distrito: 'Zamacola' })).tipo).toBe('distrito_desconocido');
  });
});
