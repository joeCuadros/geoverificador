/**
 * La conversación sin base de datos: qué entiende el asistente de cada mensaje, con erratas, respuestas vagas y seguimientos.
 * Es el intérprete de reglas (sin modelo de lenguaje) y es lo que usan los turnos de /api/agente.
 */
import { describe, expect, it } from 'vitest';
import { CONSULTA_VACIA, loQueFalta, type Consulta } from '../src/consulta.ts';
import { entender } from '../src/dialogo.ts';

const DISTRITOS = ['CAYMA', 'YANAHUARA', 'CERRO COLORADO', 'AREQUIPA', 'PAUCARPATA', 'MIRAFLORES', 'SACHACA', 'JACOBO HUNTER'];
const base = (extra: Partial<Consulta> = {}): Consulta => ({ ...CONSULTA_VACIA, intencion: 'buscar_avisos', criterios: [], noDisponible: [], avisos: [], posiciones: [], ...extra });
const ids = (c: Consulta) => c.criterios.map((x) => x.id);

describe('el mensaje de la persona que se quejó', () => {
  const MENSAJE = 'quiero un aprtamente cerca a la unsa y a mi trabajo en  el parquie idnustrial';
  it('entiende «aprtamente» como departamento y lo dice', () => {
    const e = entender(MENSAJE, { distritos: DISTRITOS });
    expect(e.consulta.tipo).toBe('departamento');
    expect(e.correcciones).toContainEqual({ dicho: 'aprtamente', entendido: 'apartamento' });
  });
  it('reconoce «cerca a la unsa» como un lugar con nombre y el trabajo como otro lugar', () => {
    const e = entender(MENSAJE, { distritos: DISTRITOS });
    expect(e.consulta.lugarCerca).toBe('unsa');
    expect(e.consulta.trabajoLugar).toBe('parquie idnustrial');
    expect(ids(e.consulta)).toEqual(expect.arrayContaining(['lugar', 'trabajo']));
    expect(loQueFalta(e.consulta)).toBeNull();
  });
  it('si falta el tipo, lo pregunta; «departamente» lo completa sin perder el resto', () => {
    const primero = entender('quiero algo cerca a la unsa y a mi trabajo en el parque industrial', { distritos: DISTRITOS });
    expect(loQueFalta(primero.consulta)).toBe('tipo');
    const segundo = entender('departamente', { distritos: DISTRITOS, previa: primero.consulta, pendiente: 'tipo' });
    expect(segundo.consulta.tipo).toBe('departamento');
    expect(segundo.respondio).toBe('tipo');
    expect(segundo.consulta.lugarCerca).toBe('unsa');
    expect(segundo.consulta.trabajoLugar).toBe('parque industrial');
    expect(ids(segundo.consulta)).toEqual(expect.arrayContaining(['lugar', 'trabajo']));
    expect(loQueFalta(segundo.consulta)).toBeNull();
  });
  it('«cualquiera» como respuesta al tipo significa que no importa el tipo', () => {
    const previa = base({ criterios: [{ id: 'colegio' }] });
    const e = entender('cualquiera', { distritos: DISTRITOS, previa, pendiente: 'tipo' });
    expect(e.consulta.tipoCualquiera).toBe(true);
    expect(e.consulta.tipo).toBeNull();
    expect(e.respondio).toBe('tipo');
    expect(loQueFalta(e.consulta)).toBeNull();
    expect(ids(e.consulta)).toEqual(['colegio']);
  });
  it('«cualquiera» escrito con una errata también se entiende', () => {
    const e = entender('cualqiera', { distritos: DISTRITOS, previa: base(), pendiente: 'tipo' });
    expect(e.consulta.tipoCualquiera).toBe(true);
  });
});

describe('respuestas a lo que se preguntó', () => {
  it('una respuesta que no sirve deja pendiente la misma pregunta y lo marca', () => {
    const e = entender('mmm no sé qué decir sobre eso', { distritos: DISTRITOS, previa: base(), pendiente: 'tipo' });
    expect(e.noSirvio).toBe(true);
    expect(e.consulta.tipo).toBeNull();
  });
  it('«me da igual» a la moneda no inventa una moneda', () => {
    const previa = base({ tipo: 'casa', precioMax: 300000 });
    const e = entender('me da igual', { distritos: DISTRITOS, previa, pendiente: 'moneda' });
    expect(e.consulta.moneda).toBeNull();
    expect(e.noSirvio).toBe(true);
  });
  it('«sin tope» a la moneda quita el precio', () => {
    const previa = base({ tipo: 'casa', precioMax: 300000 });
    const e = entender('sin tope', { distritos: DISTRITOS, previa, pendiente: 'moneda' });
    expect(e.consulta.precioMax).toBeNull();
    expect(loQueFalta(e.consulta)).toBeNull();
  });
  it('acepta «dolares» y «soles» aunque lleguen mal escritos', () => {
    const previa = base({ tipo: 'casa', precioMax: 300000 });
    expect(entender('dólares', { distritos: DISTRITOS, previa, pendiente: 'moneda' }).consulta.moneda).toBe('USD');
    expect(entender('en soles', { distritos: DISTRITOS, previa, pendiente: 'moneda' }).consulta.moneda).toBe('PEN');
  });
  it('si no tiene trabajo fijo, el criterio del trabajo se quita', () => {
    const previa = base({ tipo: 'casa', criterios: [{ id: 'trabajo' }, { id: 'colegio' }] });
    const e = entender('no tengo trabajo fijo', { distritos: DISTRITOS, previa, pendiente: 'trabajo' });
    expect(ids(e.consulta)).toEqual(['colegio']);
    expect(loQueFalta(e.consulta)).toBeNull();
  });
  it('un distrito como respuesta, aunque tenga una errata', () => {
    const e = entender('caima', { distritos: DISTRITOS, previa: base({ tipo: 'casa' }), pendiente: 'distrito' });
    expect(e.consulta.distrito).toBe('CAYMA');
    expect(e.correcciones).toContainEqual({ dicho: 'caima', entendido: 'Cayma' });
  });
  it('un precio como respuesta hereda la moneda si ya se había dicho', () => {
    const previa = base({ tipo: 'casa', moneda: 'USD' });
    const e = entender('hasta 90 mil', { distritos: DISTRITOS, previa, pendiente: 'precio' });
    expect(e.consulta.precioMax).toBe(90000);
    expect(e.consulta.moneda).toBe('USD');
  });
  it('si la persona ignora la pregunta y escribe otra búsqueda completa, la toma como búsqueda', () => {
    const e = entender('mejor una casa en Cayma hasta 300 mil soles', { distritos: DISTRITOS, previa: base({ criterios: [{ id: 'trabajo' }] }), pendiente: 'trabajo' });
    expect(e.consulta.tipo).toBe('casa');
    expect(e.consulta.distrito).toBe('CAYMA');
    expect(e.consulta.precioMax).toBe(300000);
  });
});

describe('seguimientos con lo ya entendido', () => {
  const previa = base({ tipo: 'departamento', distrito: 'YANAHUARA', precioMax: 400000, moneda: 'PEN', criterios: [{ id: 'colegio' }, { id: 'mercado', metros: 600 }] });
  it('«sin el colegio» quita ese criterio y conserva lo demás', () => {
    const e = entender('sin el colegio', { distritos: DISTRITOS, previa });
    expect(ids(e.consulta)).toEqual(['mercado']);
    expect(e.consulta.tipo).toBe('departamento');
    expect(e.consulta.distrito).toBe('YANAHUARA');
    expect(e.cambios).toEqual(['colegio']);
    expect(e.consulta.intencion).toBe('buscar_avisos');
  });
  it('«¿y en Cayma?» cambia el distrito y conserva el resto', () => {
    const e = entender('¿y en Cayma?', { distritos: DISTRITOS, previa });
    expect(e.consulta.distrito).toBe('CAYMA');
    expect(e.consulta.precioMax).toBe(400000);
    expect(ids(e.consulta)).toEqual(['colegio', 'mercado']);
    expect(e.consulta.intencion).toBe('buscar_avisos');
  });
  it('«y cayma» sin «en» también', () => {
    expect(entender('y Cayma?', { distritos: DISTRITOS, previa }).consulta.distrito).toBe('CAYMA');
  });
  it('«más barato» baja el tope un 20 % y lo redondea a 5 000', () => {
    const e = entender('y más barato', { distritos: DISTRITOS, previa });
    expect(e.consulta.precioMax).toBe(320000);
    expect(e.consulta.moneda).toBe('PEN');
  });
  it('«más barato» sin un tope previo pide el tope en vez de inventarlo', () => {
    const e = entender('más barato', { distritos: DISTRITOS, previa: { ...previa, precioMax: null, moneda: null } });
    expect(e.necesita).toBe('precio');
  });
  it('un criterio nuevo se suma a los anteriores', () => {
    const e = entender('y que tenga agua y luz', { distritos: DISTRITOS, previa });
    expect(ids(e.consulta)).toEqual(expect.arrayContaining(['colegio', 'mercado', 'agua', 'luz']));
  });
  it('un precio nuevo sin moneda usa la de antes', () => {
    const e = entender('hasta 350 mil', { distritos: DISTRITOS, previa });
    expect(e.consulta.precioMax).toBe(350000);
    expect(e.consulta.moneda).toBe('PEN');
  });
  it('«quita el precio» y «en cualquier distrito» quitan esos filtros', () => {
    expect(entender('quita el tope de precio', { distritos: DISTRITOS, previa }).consulta.precioMax).toBeNull();
    expect(entender('en cualquier distrito', { distritos: DISTRITOS, previa }).consulta.distrito).toBeNull();
  });
  it('«una casa» cambia el tipo y no pierde los criterios', () => {
    const e = entender('mejor una casa', { distritos: DISTRITOS, previa });
    expect(e.consulta.tipo).toBe('casa');
    expect(ids(e.consulta)).toEqual(['colegio', 'mercado']);
  });
  it('una frase completa (tipo más otro dato) es una búsqueda nueva y no arrastra lo anterior', () => {
    const conTrabajo = { ...previa, criterios: [{ id: 'trabajo' as const }, { id: 'colegio' as const }], trabajoLugar: 'Parque Industrial' };
    const e = entender('una casa en Cayma hasta 700 mil soles', { distritos: DISTRITOS, previa: conTrabajo });
    expect(e.acto).toBe('busqueda');
    expect(e.consulta.tipo).toBe('casa');
    expect(e.consulta.trabajoLugar).toBeNull();
    expect(ids(e.consulta)).toEqual([]);
  });
  it('«empezar de nuevo» borra todo', () => {
    const e = entender('empezar de nuevo', { distritos: DISTRITOS, previa });
    expect(e.acto).toBe('reinicio');
  });
});

describe('erratas en lo que se busca', () => {
  it('criterios mal escritos', () => {
    const e = entender('un departamento cerca de un colegioo y un merkado, con univercidad', { distritos: DISTRITOS });
    expect(ids(e.consulta)).toEqual(expect.arrayContaining(['colegio', 'mercado', 'universidad']));
  });
  it('un distrito con una letra mal', () => {
    const e = entender('una casa en paucarpta hasta 300 mil soles', { distritos: DISTRITOS });
    expect(e.consulta.distrito).toBe('PAUCARPATA');
    const f = entender('un departamento en cerro colorao', { distritos: DISTRITOS });
    expect(f.consulta.distrito).toBe('CERRO COLORADO');
  });
  it('no corrige a ciegas: «cosas» no es «casas» y una palabra ajena queda como está', () => {
    const e = entender('cosas lindas en la ciudad', { distritos: DISTRITOS });
    expect(e.consulta.tipo).toBeNull();
    expect(e.correcciones).toEqual([]);
  });
});

describe('lugares con nombre', () => {
  it('«cerca de la plaza de Yanahuara» es un lugar y no un criterio', () => {
    const e = entender('un departamento cerca de la plaza de Yanahuara', { distritos: DISTRITOS });
    expect(e.consulta.lugarCerca).toBe('plaza de Yanahuara');
    expect(ids(e.consulta)).toContain('lugar');
  });
  it('«cerca de un colegio» sigue siendo el criterio colegio y no un lugar', () => {
    const e = entender('un departamento cerca de un colegio', { distritos: DISTRITOS });
    expect(e.consulta.lugarCerca).toBeNull();
    expect(ids(e.consulta)).toEqual(['colegio']);
  });
  it('«cerca de la Universidad Nacional de San Agustín» es el lugar con nombre', () => {
    const e = entender('una casa cerca de la Universidad Nacional de San Agustín', { distritos: DISTRITOS });
    expect(e.consulta.lugarCerca).toBe('Universidad Nacional de San Agustín');
    expect(ids(e.consulta)).not.toContain('universidad');
  });
  it('«cerca de mi trabajo» no es un lugar con nombre', () => {
    const e = entender('una casa cerca de mi trabajo', { distritos: DISTRITOS });
    expect(e.consulta.lugarCerca).toBeNull();
  });
});

describe('otras intenciones', () => {
  for (const frase of ['¿qué hay en este punto?', 'que hay aqui', 'verifica este punto', 'qué tiene el punto que elegí', 'revisa este lugar']) {
    it(`«${frase}» pregunta por el punto elegido en el mapa`, () => {
      expect(entender(frase, { distritos: DISTRITOS }).consulta.intencion).toBe('verificar_punto');
    });
  }
  it('«compara el 1 y el 3» pide comparar esos dos de la lista', () => {
    const e = entender('compara el 1 y el 3', { distritos: DISTRITOS, previa: base({ tipo: 'casa' }) });
    expect(e.consulta.intencion).toBe('comparar');
    expect(e.consulta.posiciones).toEqual([1, 3]);
  });
  it('«compáralos» sin números toma los dos primeros', () => {
    const e = entender('compáralos', { distritos: DISTRITOS, previa: base({ tipo: 'casa' }) });
    expect(e.consulta.intencion).toBe('comparar');
    expect(e.consulta.posiciones).toEqual([1, 2]);
  });
  it('un saludo no toca la búsqueda guardada', () => {
    const e = entender('hola', { distritos: DISTRITOS, previa: base({ tipo: 'casa' }) });
    expect(e.consulta.intencion).toBe('saludo');
    expect(e.acto).toBe('saludo');
  });
  it('«cualquiera» sin pregunta pendiente se reconoce como «sin preferencia»', () => {
    const e = entender('cualquiera', { distritos: DISTRITOS, previa: base({ tipo: 'casa' }) });
    expect(e.sinPreferencia).toBe(true);
  });
  it('un mensaje sin sentido no pierde la consulta que había', () => {
    const previa = base({ tipo: 'casa', criterios: [{ id: 'colegio' }] });
    const e = entender('asdf qwer', { distritos: DISTRITOS, previa });
    expect(e.acto).toBe('ninguno');
    expect(e.consulta).toEqual(previa);
  });
});
