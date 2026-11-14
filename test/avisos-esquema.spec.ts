/**
 * Pruebas del esquema normalizado de avisos de venta (scripts/lib/avisos/esquema.js): moneda, tipo de inmueble, números,
 * distrito (con el mismo normalizador que public/js/precios.js), precio por m², construcción del aviso con valores nulos
 * (nunca inventados) y deduplicación por (fuente, id_fuente). Sin red.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const E = require('../scripts/lib/avisos/esquema.js');

const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
const DISTRITOS: string[] = geojson.features.map((f: { properties: { distrito: string } }) => f.properties.distrito);
const AHORA = new Date('2026-11-12T10:00:00.000Z');

describe('Esquema.normalizarMoneda', () => {
  it('reconoce soles y dólares con las grafías de los portales', () => {
    expect(E.normalizarMoneda('S/')).toBe('PEN');
    expect(E.normalizarMoneda('S/.')).toBe('PEN');
    expect(E.normalizarMoneda('PEN')).toBe('PEN');
    expect(E.normalizarMoneda('soles')).toBe('PEN');
    expect(E.normalizarMoneda('$')).toBe('USD');
    expect(E.normalizarMoneda('US$')).toBe('USD');
    expect(E.normalizarMoneda('USD')).toBe('USD');
    expect(E.normalizarMoneda('dólares')).toBe('USD');
  });
  it('devuelve null si no la reconoce, en vez de suponerla', () => {
    expect(E.normalizarMoneda('€')).toBeNull();
    expect(E.normalizarMoneda('')).toBeNull();
    expect(E.normalizarMoneda(null)).toBeNull();
  });
});

describe('Esquema.normalizarTipo', () => {
  it('lleva los nombres de los portales a los tipos del esquema', () => {
    expect(E.normalizarTipo('Departamentos')).toBe('departamento');
    expect(E.normalizarTipo('Departamento')).toBe('departamento');
    expect(E.normalizarTipo('Casas')).toBe('casa');
    expect(E.normalizarTipo('Terrenos')).toBe('terreno');
    expect(E.normalizarTipo('Lotes')).toBe('terreno');
    expect(E.normalizarTipo('Locales Comerciales')).toBe('local');
    expect(E.normalizarTipo('Oficinas')).toBe('oficina');
    expect(E.normalizarTipo('Desarrollos verticales')).toBe('departamento');
  });
  it('un tipo desconocido es null', () => {
    expect(E.normalizarTipo('Chacras')).toBeNull();
    expect(E.normalizarTipo(undefined)).toBeNull();
  });
});

describe('Esquema.numero', () => {
  it('lee números y textos numéricos; lo demás es null', () => {
    expect(E.numero(12)).toBe(12);
    expect(E.numero('534000.00')).toBe(534000);
    expect(E.numero(' 54.5 ')).toBe(54.5);
    expect(E.numero('')).toBeNull();
    expect(E.numero(null)).toBeNull();
    expect(E.numero('abc')).toBeNull();
    expect(E.numero(NaN)).toBeNull();
    expect(E.numero(Infinity)).toBeNull();
  });
});

describe('Esquema.resolverDistrito', () => {
  it('devuelve el nombre del GeoJSON cuando coincide (sin tildes, mayúsculas, alias)', () => {
    expect(E.resolverDistrito('Cerro Colorado', DISTRITOS)).toBe('CERRO COLORADO');
    expect(E.resolverDistrito('  cayma ', DISTRITOS)).toBe('CAYMA');
    expect(E.resolverDistrito('Jose Luis Bustamante Y Rivero', DISTRITOS)).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(E.resolverDistrito('José Luis Bustamante', DISTRITOS)).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
    expect(E.resolverDistrito('Quequeña', DISTRITOS)).toBe('QUEQUEÑA');
  });
  it('si no está entre los distritos conocidos conserva el nombre normalizado, sin inventar otro', () => {
    expect(E.resolverDistrito('Punta De Bombon', DISTRITOS)).toBe('PUNTA DE BOMBON');
  });
  it('vacío o no textual es null', () => {
    expect(E.resolverDistrito('', DISTRITOS)).toBeNull();
    expect(E.resolverDistrito(null, DISTRITOS)).toBeNull();
  });
});

describe('Esquema.calcularPrecioM2', () => {
  it('usa el área construida en departamentos y casas, y el área total en terrenos', () => {
    expect(E.calcularPrecioM2({ precio: 600000, tipo: 'departamento', areaTotal: 120, areaConstruida: 100 })).toEqual({ valor: 6000, base: 'construida' });
    expect(E.calcularPrecioM2({ precio: 600000, tipo: 'departamento', areaTotal: 120, areaConstruida: null })).toEqual({ valor: 5000, base: 'total' });
    expect(E.calcularPrecioM2({ precio: 120000, tipo: 'terreno', areaTotal: 300, areaConstruida: 10 })).toEqual({ valor: 400, base: 'total' });
  });
  it('redondea a dos decimales', () => {
    expect(E.calcularPrecioM2({ precio: 100000, tipo: 'casa', areaTotal: 3, areaConstruida: null }).valor).toBe(33333.33);
  });
  it('no calcula sin precio o sin área positiva, ni en proyectos (rangos)', () => {
    expect(E.calcularPrecioM2({ precio: null, tipo: 'casa', areaTotal: 100, areaConstruida: null })).toEqual({ valor: null, base: null });
    expect(E.calcularPrecioM2({ precio: 100, tipo: 'casa', areaTotal: 0, areaConstruida: null })).toEqual({ valor: null, base: null });
    expect(E.calcularPrecioM2({ precio: 100, tipo: 'casa', areaTotal: null, areaConstruida: null })).toEqual({ valor: null, base: null });
    expect(E.calcularPrecioM2({ precio: 100, tipo: 'departamento', areaTotal: 50, areaConstruida: null, esProyecto: true })).toEqual({ valor: null, base: null });
  });
});

describe('Esquema.crearAviso', () => {
  const base = { fuente: 'prueba', id_fuente: 123, url: 'https://ejemplo.pe/a/123', titulo: ' Departamento  en Cayma ', tipo_portal: 'Departamentos', precio: '300000', moneda: 'S/.', area_total_m2: '100', distrito: 'Cayma' };

  it('trae todas las columnas del esquema, con null en lo que no se publicó', () => {
    const a = E.crearAviso(base, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(Object.keys(a)).toEqual(E.COLUMNAS);
    expect(a).toMatchObject({
      fuente: 'prueba',
      id_fuente: '123',
      url: 'https://ejemplo.pe/a/123',
      titulo: 'Departamento en Cayma',
      tipo_inmueble: 'departamento',
      operacion: 'venta',
      precio: 300000,
      moneda: 'PEN',
      area_total_m2: 100,
      area_construida_m2: null,
      precio_m2: 3000,
      precio_m2_base: 'total',
      distrito: 'CAYMA',
      dormitorios: null,
      banos: null,
      lat: null,
      lon: null,
      fecha_publicacion: null,
      fecha_captura: '2026-11-12T10:00:00.000Z',
      via: 'directo',
      actor: null,
    });
  });

  it('marca la procedencia: directo por defecto; apify solo si se indica, con el actor', () => {
    const a = E.crearAviso({ ...base, via: 'apify', actor: 'scrapers_lat/urbania-scraper' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(a).toMatchObject({ via: 'apify', actor: 'scrapers_lat/urbania-scraper' });
    const b = E.crearAviso({ ...base, via: 'cualquier-cosa', actor: 'x/y' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(b).toMatchObject({ via: 'directo', actor: null });
  });

  it('sin moneda reconocida no calcula precio por m² ni adivina la moneda', () => {
    const a = E.crearAviso({ ...base, moneda: '??' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(a.moneda).toBeNull();
    expect(a.precio_m2).toBeNull();
  });

  it('descarta precios, áreas y coordenadas no válidos', () => {
    const a = E.crearAviso({ ...base, precio: -5, area_total_m2: 0, lat: 95, lon: 'x' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(a.precio).toBeNull();
    expect(a.area_total_m2).toBeNull();
    expect(a.lat).toBeNull();
    expect(a.lon).toBeNull();
    expect(a.precio_m2).toBeNull();
  });

  it('conserva coordenadas válidas y fechas ISO de solo día', () => {
    const a = E.crearAviso({ ...base, lat: '-16.39', lon: -71.54, fecha_publicacion: '2026-10-27T00:00:00-0400', fecha_actualizacion: '2018-11-23 12:03:42' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(a.lat).toBe(-16.39);
    expect(a.lon).toBe(-71.54);
    expect(a.fecha_publicacion).toBe('2026-10-27');
    expect(a.fecha_actualizacion).toBe('2018-11-23');
  });

  it('una fecha ilegible es null', () => {
    const a = E.crearAviso({ ...base, fecha_publicacion: 'ayer' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(a.fecha_publicacion).toBeNull();
  });

  it('no tiene campos de vendedores, teléfonos ni perfiles, aunque vengan en la entrada', () => {
    const a = E.crearAviso({ ...base, vendedor: 'Fulano', telefono: '999888777', perfil: 'https://x/perfil' }, { ahora: AHORA, distritosConocidos: DISTRITOS });
    expect(Object.keys(a)).not.toEqual(expect.arrayContaining(['vendedor', 'telefono', 'perfil']));
    expect(JSON.stringify(a)).not.toMatch(/Fulano|999888777|perfil/);
  });

  it('sin id o sin url no es un aviso utilizable (null)', () => {
    expect(E.crearAviso({ ...base, id_fuente: null }, { ahora: AHORA, distritosConocidos: DISTRITOS })).toBeNull();
    expect(E.crearAviso({ ...base, url: '' }, { ahora: AHORA, distritosConocidos: DISTRITOS })).toBeNull();
  });
});

describe('Esquema.deduplicar', () => {
  const av = (fuente: string, id: string, extra = {}) => ({ fuente, id_fuente: id, ...extra });
  it('quita repetidos por (fuente, id_fuente) y conserva el primero', () => {
    const r = E.deduplicar([av('a', '1', { n: 1 }), av('a', '1', { n: 2 }), av('a', '2'), av('b', '1')]);
    expect(r.avisos.map((x: { fuente: string; id_fuente: string }) => `${x.fuente}:${x.id_fuente}`)).toEqual(['a:1', 'a:2', 'b:1']);
    expect(r.avisos[0]).toMatchObject({ n: 1 });
    expect(r.duplicados).toBe(1);
  });
  it('no mezcla avisos de fuentes distintas aunque se parezcan', () => {
    const r = E.deduplicar([av('a', '1', { titulo: 'igual' }), av('b', '1', { titulo: 'igual' })]);
    expect(r.avisos).toHaveLength(2);
    expect(r.duplicados).toBe(0);
  });
});
