/**
 * Las líneas de SmartBus en la comparación de puntos (comparar.js) y en el informe imprimible (reporte.js). Los cálculos de las
 * líneas están en test/rutas.spec.ts; aquí solo se comprueba cómo se muestran, con su fuente y sus límites.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Comparar = require('../public/js/comparar.js');
const Reporte = require('../public/js/reporte.js');
const Verificaciones = require('../public/js/verificaciones.js');

type Estado = 'CUMPLE' | 'NO CUMPLE' | 'SIN DATO';
const serv = (estado: Estado, distanciaM: number | null, umbralM: number, nombre: string | null = 'Paradero X') => ({
  estado, distanciaM, umbralM, nombre, fecha: '2026-05-01', fuente: 'OpenStreetMap (ODbL)', metodo: 'Distancia en línea recta.',
});
const rutas = (lineas: any[], extra = {}) => ({
  distanciaM: 400, lineas, rutas: lineas.length, fuente: 'SmartBus (smartbus.app)', fecha: '2026-11-03',
  permiso: 'autorización verbal de SmartBus; confirmación escrita pendiente', atribucion: 'Rutas: SmartBus (smartbus.app)', ...extra,
});
const L2 = { linea: 'C2', empresas: ['Cono Norte'], distanciaM: 85, ramales: [{ ramal: 'Cettar' }, { ramal: 'Cettar' }], parada: { nombre: 'Cettar - 12', distanciaM: 120 } };
const L5 = { linea: 'C5', empresas: ['EtraBus'], distanciaM: 300, ramales: [{ ramal: 'Norte' }], parada: null };

describe('Comparar: líneas de SmartBus en la fila de transporte', () => {
  let n = 0;
  const entorno = (transporte: any) => ({
    salud: serv('CUMPLE', 300, 1000),
    educacion: { inicial: serv('CUMPLE', 200, 500), primaria: serv('CUMPLE', 900, 1500), secundaria: serv('CUMPLE', 2000, 3000) },
    transporte,
    areaVerde: serv('CUMPLE', 120, 300),
  });
  const crear = (transporte: any) => {
    n += 1;
    return Comparar.crearCandidato({ lat: -16.4 - n * 0.01, lon: -71.53, etiqueta: `Punto ${n}`, entorno: entorno(transporte) });
  };
  const conRutas = (r: any) => crear({ ...serv('CUMPLE', 100, 400), rutas: r });

  it('guarda solo la línea y su empresa, sin trazados ni ramales', () => {
    const c = conRutas(rutas([L2]));
    expect(c.variables.transporte.rutas).toEqual({ distanciaM: 400, lineas: [{ linea: 'C2', empresas: ['Cono Norte'] }], fecha: '2026-11-03' });
  });

  it('agrega a la celda una segunda línea con las líneas a la distancia de referencia', () => {
    const celda = Comparar.celda(conRutas(rutas([L2, L5])), 'transporte');
    expect(celda.partes).toHaveLength(2);
    expect(celda.partes[0].texto).toBe('100 m en línea recta · ref. 400 m');
    expect(celda.partes[1].texto).toBe('Líneas a 400 m o menos: C2 (Cono Norte), C5 (EtraBus)');
  });

  it('dice cuando ninguna línea publicada pasa tan cerca', () => {
    expect(Comparar.celda(conRutas(rutas([])), 'transporte').partes[1].texto).toBe('Ninguna línea de SmartBus a 400 m o menos');
  });

  it('sin líneas calculadas (o con error) la celda queda como antes: nunca se inventan', () => {
    const sinRutas = crear(serv('CUMPLE', 100, 400));
    expect(sinRutas.variables.transporte.rutas).toBeNull();
    expect(Comparar.celda(sinRutas, 'transporte').partes).toHaveLength(1);
    const error = conRutas(rutas([], { error: 'No se encontró el archivo' }));
    expect(error.variables.transporte.rutas).toBeNull();
    expect(Comparar.celda(error, 'transporte').partes).toHaveLength(1);
  });

  it('un punto guardado antes de existir las líneas sigue siendo válido', () => {
    const viejo = crear(serv('CUMPLE', 100, 400));
    delete viejo.variables.transporte.rutas;
    const almacen = { getItem: () => JSON.stringify([viejo]), setItem: () => undefined };
    expect(Comparar.leerCandidatos(almacen)).toHaveLength(1);
    expect(Comparar.celda(viejo, 'transporte').partes).toHaveLength(1);
  });
});

describe('Reporte: líneas de transporte de SmartBus', () => {
  const base = (r: any) => ({
    fecha: '3 de noviembre de 2026', punto: { lat: -16.4, lon: -71.53 }, distritoTitulo: 'Distrito de Arequipa', distritoNombre: 'Arequipa',
    resumen: [['Zonificación vigente', 'RDM-2']], zonaStatus: 'outside', zona: null, badgeZona: null, lote: null, potencial: null, avisoPDM: null,
    variables: { salud: serv('CUMPLE', 120, 1000), educacion: { inicial: serv('CUMPLE', 1, 500), primaria: serv('CUMPLE', 1, 1500), secundaria: serv('CUMPLE', 1, 3000) }, transporte: { ...serv('CUMPLE', 120, 400), rutas: r }, areaVerde: serv('CUMPLE', 1, 300) },
    umbrales: { areaVerde: { areaMinM2: 5000, areaGrandeM2: 10000, distanciaM: 300 } },
    fuentesUmbral: { salud: 'x', educacion: 'x', transporte: 'Convención del proyecto', areaVerde: 'x' }, modulos: {},
    fuentes: { zonificacion: 'Plano del PDM', peligros: 'p', distritos: 'd', delitos: 'e' },
    cauce: null, contextoRiesgo: null,
    verificaciones: { calculado: Verificaciones.CALCULADO, items: Verificaciones.ITEMS, aviso: Verificaciones.AVISO },
  });
  const seccion = (d: any) => Reporte.construirSecciones(d).find((s: { titulo: string }) => s.titulo === 'Transporte');

  it('lista las líneas con su empresa, el trazado y la parada más cercana, junto al paradero de OSM', () => {
    const h = seccion(base(rutas([L2, L5]))).cuerpo;
    expect(h).toContain('Paradero X');
    expect(h).toContain('C2 (Cono Norte), C5 (EtraBus)');
    expect(h).toContain('trazado a 85 m');
    expect(h).toContain('parada más cercana «Cettar - 12» a 120 m');
    expect((h.match(/Cettar(?! - )/g) || []).length).toBe(1); // el ramal de ida y vuelta se nombra una sola vez
  });

  it('cita la fuente, el permiso verbal con confirmación pendiente y que la distancia es una convención', () => {
    const s = seccion(base(rutas([L2])));
    expect(s.cuerpo).toContain('SmartBus (smartbus.app)');
    expect(s.cuerpo).toContain('autorización verbal de SmartBus; confirmación escrita pendiente');
    expect(s.cuerpo).toContain('Convención del proyecto');
    expect(s.cuerpo).toMatch(/sin frecuencias ni horarios/);
    expect(s.fuente).toContain('Rutas: SmartBus (smartbus.app)');
  });

  it('si ninguna línea pasa tan cerca lo dice, y si el archivo falló muestra el error sin romper el paradero', () => {
    expect(seccion(base(rutas([]))).cuerpo).toMatch(/Ninguna línea publicada por SmartBus pasa a 400 m o menos/);
    const err = seccion(base(rutas([], { error: 'sin archivo' })));
    expect(err.cuerpo).toContain('No se pudieron cargar las líneas de transporte: sin archivo');
    expect(err.cuerpo).toContain('Paradero X');
    expect(err.fuente).not.toContain('SmartBus');
  });

  it('sin líneas calculadas el informe de transporte es el de antes', () => {
    const h = seccion(base(undefined)).cuerpo;
    expect(h).toContain('Paradero X');
    expect(h).not.toContain('SmartBus');
  });

  it('los límites del informe mencionan las líneas de SmartBus y su permiso', () => {
    expect(Reporte.limites(base(undefined)).join(' ')).toMatch(/SmartBus.*autorización verbal.*confirmación escrita pendiente/);
  });
});
