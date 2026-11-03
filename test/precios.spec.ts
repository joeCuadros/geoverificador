/**
 * Pruebas de public/js/precios.js: búsqueda del precio de oferta por m² del distrito. Se revisa la normalización de
 * nombres, que el resultado nunca sea CUMPLE / NO CUMPLE y que un distrito sin cifra devuelva SIN DATO con su causa.
 * También se comprueba el archivo congelado real (data/precios_m2_distrito.json) contra los distritos del GeoJSON.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const Precios = require('../public/js/precios.js');

const leer = (ruta: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', ruta), 'utf8'));

const DATOS = {
  fuente: 'Aptología',
  url: 'https://example.org/estudio',
  licencia: 'CC BY 4.0',
  atribucion: 'Datos: Aptologia',
  fecha_descarga: '2026-11-03',
  periodo: { desde: '2026-10-11', hasta: '2026-10-18', corte: '2026-10-18' },
  tipo: 'precio de oferta (avisos), no de cierre',
  moneda: 'PEN',
  muestra_minima: 30,
  distritos: {
    CAYMA: { venta_m2: 4904.7, avisos_venta: 118, arriendo_mensual: null, avisos_arriendo: null },
    'CERRO COLORADO': { venta_m2: 4390, avisos_venta: 108, arriendo_mensual: 2900, avisos_arriendo: 35 },
    'JOSE LUIS BUSTAMANTE Y RIVERO': { venta_m2: 3800, avisos_venta: 40, arriendo_mensual: null, avisos_arriendo: null },
  },
};

describe('Precios.normalizarNombre', () => {
  it('quita tildes, signos y espacios de más, y pasa a mayúsculas', () => {
    expect(Precios.normalizarNombre('  Yanahuara ')).toBe('YANAHUARA');
    expect(Precios.normalizarNombre('José   Luis Bustamante y Rivero')).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(Precios.normalizarNombre('Cerro-Colorado.')).toBe('CERRO COLORADO');
    expect(Precios.normalizarNombre('Quequeña')).toBe(Precios.normalizarNombre('QUEQUEÑA'));
  });

  it('devuelve cadena vacía si no es texto', () => {
    expect(Precios.normalizarNombre(null)).toBe('');
    expect(Precios.normalizarNombre(undefined)).toBe('');
    expect(Precios.normalizarNombre(42)).toBe('');
  });
});

describe('Precios.buscar', () => {
  it('devuelve el precio de oferta, el periodo, el número de avisos y la fuente', () => {
    const r = Precios.buscar(DATOS, 'Cayma');
    expect(r.estado).toBe('INFORMATIVO');
    expect(r.distrito).toBe('CAYMA');
    expect(r.precioM2).toEqual({ venta: 4905, alquiler: null });
    expect(r.moneda).toBe('PEN');
    expect(r.periodo).toEqual(DATOS.periodo);
    expect(r.nAvisos).toEqual({ venta: 118, arriendo: null });
    expect(r.tipo).toMatch(/no de cierre/);
    expect(r.fuente).toBe('Aptología');
    expect(r.atribucion).toBe('Datos: Aptologia');
    expect(r.licencia).toBe('CC BY 4.0');
  });

  it('encuentra el distrito con tildes, minúsculas o el nombre del GeoJSON', () => {
    expect(Precios.buscar(DATOS, 'cerro colorado').precioM2.venta).toBe(4390);
    expect(Precios.buscar(DATOS, 'CERRO COLORADO').distrito).toBe('CERRO COLORADO');
    expect(Precios.buscar(DATOS, 'José Luis Bustamante y Rivero').precioM2.venta).toBe(3800);
    expect(Precios.buscar(DATOS, 'JLB y R').precioM2.venta).toBe(3800);
  });

  it('incluye el arriendo mensual cuando la fuente lo publica, aparte del precio por m²', () => {
    const r = Precios.buscar(DATOS, 'Cerro Colorado');
    expect(r.arriendoMensual).toBe(2900);
    expect(r.precioM2.alquiler).toBeNull();
    expect(r.nAvisos.arriendo).toBe(35);
  });

  it('nunca devuelve CUMPLE ni NO CUMPLE ni un puntaje', () => {
    ['Cayma', 'Cerro Colorado', 'Yura', null].forEach((d) => {
      const r = Precios.buscar(DATOS, d);
      expect(['INFORMATIVO', 'SIN DATO']).toContain(r.estado);
      expect(JSON.stringify(r)).not.toMatch(/CUMPLE|puntaje|score/i);
    });
  });

  it('un distrito sin cifra publicada es SIN DATO con la causa (muestra mínima)', () => {
    const r = Precios.buscar(DATOS, 'Yura');
    expect(r.estado).toBe('SIN DATO');
    expect(r.motivo).toBe('sin_muestra');
    expect(r.distrito).toBe('YURA');
    expect(r.causa).toMatch(/al menos 30 avisos/);
    expect(r.precioM2).toBeUndefined();
  });

  it('una fila sin ninguna cifra también es SIN DATO', () => {
    const datos = { ...DATOS, distritos: { SOCABAYA: { venta_m2: null, avisos_venta: null, arriendo_mensual: null, avisos_arriendo: null } } };
    expect(Precios.buscar(datos, 'Socabaya').estado).toBe('SIN DATO');
  });

  it('sin distrito (punto fuera de los distritos) es SIN DATO y no inventa uno', () => {
    ['', '   ', null, undefined].forEach((d) => {
      const r = Precios.buscar(DATOS, d);
      expect(r.estado).toBe('SIN DATO');
      expect(r.motivo).toBe('sin_distrito');
      expect(r.distrito).toBeNull();
    });
  });

  it('si el archivo falta o está mal formado es SIN DATO con la causa', () => {
    [null, undefined, {}, { distritos: null }, 'texto'].forEach((d) => {
      const r = Precios.buscar(d, 'Cayma');
      expect(r.estado).toBe('SIN DATO');
      expect(r.motivo).toBe('sin_archivo');
      expect(r.causa).toMatch(/precios_m2_distrito/);
    });
  });
});

describe('Precios: formato', () => {
  it('formatea soles con separador de miles', () => {
    expect(Precios.formatearSoles(4905)).toBe('S/ 4 905');
    expect(Precios.formatearSoles(390)).toBe('S/ 390');
    expect(Precios.formatearSoles(null)).toBe('—');
  });

  it('escribe fechas y periodos en español', () => {
    expect(Precios.fechaLarga('2026-10-18')).toBe('18 de octubre de 2026');
    expect(Precios.textoPeriodo({ desde: '2026-10-11', hasta: '2026-10-18', corte: '2026-10-18' })).toBe('avisos vistos del 11 de octubre de 2026 al 18 de octubre de 2026');
    expect(Precios.textoPeriodo({ corte: '2026-10-18' })).toBe('datos con corte al 18 de octubre de 2026');
    expect(Precios.textoPeriodo(null)).toBe('periodo no informado');
  });
});

describe('data/precios_m2_distrito.json (archivo congelado)', () => {
  const datos = leer('data/precios_m2_distrito.json');
  const distritosGeo = leer('data/distritos_aqp.geojson').features.map((f: any) => f.properties.distrito);

  it('declara licencia, atribución, fecha, periodo, tipo y moneda', () => {
    expect(datos.licencia).toBe('CC BY 4.0');
    expect(datos.atribucion).toBe('Datos: Aptologia');
    expect(datos.fecha_descarga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(datos.periodo.corte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(datos.tipo).toMatch(/no de cierre/);
    expect(datos.moneda).toBe('PEN');
    expect(datos.url).toMatch(/^https:\/\//);
  });

  it('cada distrito está escrito como en el GeoJSON y cumple la muestra mínima', () => {
    const nombres = Object.keys(datos.distritos);
    expect(nombres.length).toBeGreaterThan(0);
    nombres.forEach((n) => {
      expect(distritosGeo).toContain(n);
      const d = datos.distritos[n];
      expect(d.venta_m2).toBeGreaterThan(0);
      expect(d.avisos_venta).toBeGreaterThanOrEqual(datos.muestra_minima);
      expect(Precios.buscar(datos, n).estado).toBe('INFORMATIVO');
    });
  });
});
