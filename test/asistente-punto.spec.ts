/**
 * «Solo cerca de mi punto» en el constructor de búsquedas: la opción de los menús debe producir la MISMA intención que el
 * intérprete saca de «… cerca de mi punto» (`limitarAlPunto`). Con esa opción, la distancia máxima del menú es el radio del
 * área alrededor del punto (igual que «en un radio de 1 km» escrito con «cerca de mi punto»).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Asistente = require('../public/js/asistente.js');

const ids = (q: { criterios: { id: string }[] }) => q.criterios.map((c) => c.id).sort();

describe('Asistente.construirConsulta con «solo cerca de mi punto»', () => {
  it('por defecto no limita la búsqueda al punto (igual que una frase sin «mi punto»)', () => {
    expect(Asistente.construirConsulta({ criterios: ['salud'] }).limitarAlPunto).toBe(false);
    expect(Asistente.interpretar('busco una zona con posta').limitarAlPunto).toBe(false);
  });

  it('con la opción activa marca limitarAlPunto, igual que el intérprete con «cerca de mi punto»', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud', 'areaVerde'], cercaDeMiPunto: true });
    expect(q.limitarAlPunto).toBe(true);
    const hablada = Asistente.interpretar('busco cerca de una posta y un parque cerca de mi punto');
    expect(hablada.limitarAlPunto).toBe(true);
    expect(Object.keys(q).sort()).toEqual(Object.keys(hablada).sort());
    expect(ids(q)).toEqual(ids(hablada));
  });

  it('la frase generada se entiende con la misma opción, criterios, prioridad y radio', () => {
    const q = Asistente.construirConsulta({ criterios: ['colegio', 'transporte'], nivel: 'primaria', prioridades: ['transporte'], radioM: 1500, cercaDeMiPunto: true, incluirCondicional: true });
    const texto = Asistente.textoDeConsulta(q);
    expect(texto).toMatch(/cerca de mi punto/);
    const vuelta = Asistente.interpretar(texto);
    expect(vuelta.tipo).toBe('buscar');
    expect(vuelta.limitarAlPunto).toBe(true);
    expect(ids(vuelta)).toEqual(ids(q));
    expect(vuelta.radioGlobalM).toBe(1500);
    expect(vuelta.incluirCondicional).toBe(true);
    expect(vuelta.criterios.find((c: { id: string }) => c.id === 'transporte').prioridad).toBe(2);
  });

  it('sin la opción la frase no menciona «mi punto» y no limita', () => {
    const texto = Asistente.textoDeConsulta(Asistente.construirConsulta({ criterios: ['salud'], radioM: 1000 }));
    expect(texto).not.toMatch(/mi punto/);
    expect(Asistente.interpretar(texto).limitarAlPunto).toBe(false);
  });

  it('funciona con cada criterio y cada radio del menú', () => {
    Object.keys(Asistente.CRITERIOS).forEach((id) => {
      const q = Asistente.construirConsulta({ criterios: [id], cercaDeMiPunto: true });
      const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
      expect(vuelta.limitarAlPunto).toBe(true);
      expect(ids(vuelta)).toEqual(ids(q));
    });
    Asistente.OPCIONES.radios.filter((r: number | null) => r !== null).forEach((r: number) => {
      const q = Asistente.construirConsulta({ criterios: ['salud'], radioM: r, cercaDeMiPunto: true });
      const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
      expect(vuelta.limitarAlPunto).toBe(true);
      expect(vuelta.radioGlobalM).toBe(r);
    });
  });

  it('también con «lejos de quebradas» y su distancia propia', () => {
    const q = Asistente.construirConsulta({ criterios: ['salud'], lejosQuebradaM: 200, cercaDeMiPunto: true, radioM: 1000 });
    const vuelta = Asistente.interpretar(Asistente.textoDeConsulta(q));
    expect(vuelta.limitarAlPunto).toBe(true);
    expect(vuelta.criterios.find((c: { id: string }) => c.id === 'lejosQuebrada').umbralM).toBe(200);
    expect(vuelta.radioGlobalM).toBe(1000);
  });

  it('solo valen valores verdaderos de verdad: «false», 0 o texto no activan la opción', () => {
    [false, 0, '', null, undefined].forEach((v) => {
      expect(Asistente.construirConsulta({ criterios: ['salud'], cercaDeMiPunto: v as never }).limitarAlPunto).toBe(false);
    });
  });

  it('sin criterios la opción sola no crea una búsqueda', () => {
    expect(Asistente.construirConsulta({ cercaDeMiPunto: true }).tipo).toBe('desconocido');
  });

  it('el preajuste «cerca de mi punto» existe como opción y se entiende', () => {
    expect(Asistente.OPCIONES.cercaDeMiPunto).toEqual({ etiqueta: 'Solo cerca de mi punto' });
  });
});
