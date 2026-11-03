/**
 * Pruebas del asistente con el precio de oferta por m² del distrito (Aptología): cómo se reconoce la pregunta, qué
 * responde con el archivo real congelado y qué NO responde (el precio de una casa, un alquiler, zonas «baratas»).
 * Son funciones puras: no usan red ni DOM.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const Asistente = require('../public/js/asistente.js');
const Precios = require('../public/js/precios.js');

const precios = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'precios_m2_distrito.json'), 'utf8'));
const responder = (frase: string, ctx: Record<string, unknown> = {}) =>
  Asistente.responder(Asistente.interpretar(frase, { hayPunto: Boolean(ctx.punto) }), { precios, ...ctx });

describe('Asistente.interpretar: precio de oferta por m²', () => {
  it.each([
    ['¿cuánto cuesta el m² en Cayma?', 'CAYMA'],
    ['precio por metro cuadrado en Yanahuara', 'YANAHUARA'],
    ['¿a cuánto está el m2 en Cerro Colorado?', 'CERRO COLORADO'],
    ['precio en José Luis Bustamante', 'JOSE LUIS BUSTAMANTE Y RIVERO'],
    ['precio de las casas en Socabaya', 'SOCABAYA'],
  ])('«%s» es una consulta de precio del distrito %s', (frase, distrito) => {
    const i = Asistente.interpretar(frase);
    expect(i.tipo).toBe('precio');
    expect(i.distritoPrecio).toBe(distrito);
    expect(i.criterios).toEqual([]);
  });

  it('sin distrito nombrado, la pregunta es sobre el distrito del punto o sobre todos si lo pide', () => {
    const uno = Asistente.interpretar('¿cuánto cuesta el metro cuadrado?');
    expect(uno).toMatchObject({ tipo: 'precio', distritoPrecio: null, todosPrecio: false });
    const todos = Asistente.interpretar('¿qué distrito es el más caro?');
    expect(todos).toMatchObject({ tipo: 'precio', distritoPrecio: null, todosPrecio: true });
  });

  it.each([
    '¿cuánto cuesta esta casa?',
    '¿cuánto vale mi terreno?',
    'precio de este departamento',
    '¿cuánto cuesta alquilar en Cayma?',
    'precio del alquiler en Yanahuara',
    'tasación de mi predio',
  ])('«%s» sigue fuera de alcance (no hay precio de un inmueble ni de alquileres)', (frase) => {
    const i = Asistente.interpretar(frase);
    expect(i.tipo).toBe('no_soportado');
    expect(i.temaNoSoportado).toBe('precio');
  });

  it('buscar zonas «baratas» no es una consulta de precio: se avisa y no se filtra por precio', () => {
    expect(Asistente.interpretar('busco una zona barata')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'precio' });
    const mezcla = Asistente.interpretar('quiero algo barato cerca de un parque');
    expect(mezcla.tipo).toBe('buscar');
    expect(mezcla.temaNoSoportado).toBe('precio');
  });

  it('seguridad no cambia', () => {
    expect(Asistente.interpretar('¿es seguro vivir ahí?')).toMatchObject({ tipo: 'no_soportado', temaNoSoportado: 'seguridad' });
  });
});

describe('Asistente.responder: precio de oferta por m²', () => {
  it('responde con el precio del distrito, los avisos, el periodo y la atribución, como oferta y no como cierre', () => {
    const { texto } = responder('¿cuánto cuesta el m² en Cayma?');
    expect(texto).toContain('Cayma');
    expect(texto).toContain('S/ 4,905');
    expect(texto).toContain('118 avisos');
    expect(texto).toContain('11 al 18 de octubre de 2026');
    expect(texto).toMatch(/no de cierre/);
    expect(texto).toMatch(/no el precio de un inmueble en particular/);
    expect(texto).toContain('Datos: Aptologia');
    expect(texto).toContain('CC BY 4.0');
    expect(texto).not.toMatch(/recomiend|conviene|caro|barato/i);
  });

  it('sin distrito usa el del punto', () => {
    const { texto } = responder('¿cuánto cuesta el metro cuadrado?', { punto: { lat: -16.4, lon: -71.5 }, distrito: 'YANAHUARA' });
    expect(texto).toContain('Yanahuara');
    expect(texto).toContain('S/ 4,765');
  });

  it('un distrito nombrado manda sobre el del punto', () => {
    const { texto } = responder('precio por m2 en Cerro Colorado', { punto: { lat: -16.4, lon: -71.5 }, distrito: 'YANAHUARA' });
    expect(texto).toContain('S/ 4,390');
    expect(texto).not.toContain('Yanahuara');
  });

  it('un distrito sin cifra dice la causa, nombra los que sí tienen y no estima nada', () => {
    const { texto } = responder('precio del m2 en Socabaya');
    expect(texto).toMatch(/no publica precio por m² para este distrito/);
    expect(texto).toMatch(/al menos 30 avisos/);
    expect(texto).toContain('Distritos con cifra: Cayma, Yanahuara, Cerro Colorado');
    expect(texto).toMatch(/No estimo/);
    expect(texto).not.toMatch(/S\/ \d/);
  });

  it('sin distrito ni punto lista los distritos con cifra', () => {
    const { texto } = responder('precio por m2');
    expect(texto).toContain('• Cayma: S/ 4,905 por m² (118 avisos)');
    expect(texto).toContain('• Yanahuara: S/ 4,765 por m² (47 avisos)');
    expect(texto).toContain('• Cerro Colorado: S/ 4,390 por m² (108 avisos)');
  });

  it('«todos los distritos» lista aunque haya punto', () => {
    const { texto } = responder('precio del m2 en todos los distritos', { punto: { lat: -16.4, lon: -71.5 }, distrito: 'YANAHUARA' });
    expect(texto.match(/^• /gm)).toHaveLength(3);
  });

  it('si el archivo de precios no se pudo leer, lo dice y no inventa una cifra', () => {
    const { texto } = Asistente.responder(Asistente.interpretar('precio del m2 en Cayma'), { precios: null });
    expect(texto).toMatch(/No pude leer el archivo de precios/);
    expect(texto).not.toMatch(/S\/ \d/);
  });

  it('el precio de una casa responde que solo se conocen promedios de oferta por distrito', () => {
    const { texto } = responder('¿cuánto cuesta esta casa?');
    expect(texto).toMatch(/No tengo el precio de una casa/);
    expect(texto).toMatch(/precio de oferta por m² promedio de algunos distritos/);
    expect(texto).not.toMatch(/S\/ \d/);
  });

  it('el apartado «por qué, fuente y límites» existe y repite que es oferta y no cierre', () => {
    const e = Asistente.explicar('precio');
    expect(JSON.stringify(e)).toMatch(/no de cierre/);
    expect(JSON.stringify(e)).toMatch(/CC BY 4.0/);
    expect(e.limites.length).toBeGreaterThan(1);
  });

  it('la ayuda y las fuentes mencionan el precio por distrito y siguen negando seguridad y ruido', () => {
    expect(responder('ayuda').texto).toMatch(/precio de oferta por m²/);
    expect(responder('ayuda').texto).toMatch(/seguridad ni ruido/);
    expect(responder('¿de dónde salen los datos?').texto).toMatch(/Aptología/);
  });
});

describe('Precios.distritoEnTexto', () => {
  it('reconoce el distrito sin tildes ni mayúsculas y prefiere el nombre largo', () => {
    expect(Precios.distritoEnTexto('en yanahuara')).toBe('YANAHUARA');
    expect(Precios.distritoEnTexto('en Cerro Colorado')).toBe('CERRO COLORADO');
    expect(Precios.distritoEnTexto('jose luis bustamante y rivero')).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(Precios.distritoEnTexto('hola')).toBeNull();
    expect(Precios.distritoEnTexto('')).toBeNull();
    expect(Precios.distritoEnTexto(null)).toBeNull();
  });

  it('la lista de distritos coincide con el GeoJSON', () => {
    const geo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
    expect([...Precios.DISTRITOS_AQP].sort((a: string, b: string) => a.localeCompare(b))).toEqual(geo.features.map((f: any) => f.properties.distrito).sort((a: string, b: string) => a.localeCompare(b)));
  });
});
