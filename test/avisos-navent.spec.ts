/**
 * Pruebas de las fuentes Adondevivir y Urbania (scripts/lib/avisos/fuentes/navent.js, adondevivir.js, urbania.js): lectura del
 * estado precargado de la página (window.__PRELOADED_STATE__) con muestras recortadas de respuestas reales
 * (test/fixtures/avisos/), armado de las URL, y el recorrido de páginas con un cliente falso (sin red).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const Navent = require('../scripts/lib/avisos/fuentes/navent.js');
const Adondevivir = require('../scripts/lib/avisos/fuentes/adondevivir.js');
const Urbania = require('../scripts/lib/avisos/fuentes/urbania.js');
const E = require('../scripts/lib/avisos/esquema.js');

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'avisos', n), 'utf8');
const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
const DISTRITOS: string[] = geojson.features.map((f: { properties: { distrito: string } }) => f.properties.distrito);
const AHORA = new Date('2026-11-12T10:00:00.000Z');
const ctx = { distritosConocidos: DISTRITOS, ahora: AHORA };

type Aviso = Record<string, any>;
const por = (avisos: Aviso[], id: string) => avisos.find((a) => a.id_fuente === id) as Aviso;

describe('Navent.extraerEstado', () => {
  it('lee el JSON de window.__PRELOADED_STATE__ aunque haya llaves y comillas dentro de los textos', () => {
    const html = '<script>window.__PRELOADED_STATE__ = {"a":"texto con } y \\" comilla","b":{"c":[1,2,{"d":"{"}]}};window.otra = {"x":1};</script>';
    expect(Navent.extraerEstado(html)).toEqual({ a: 'texto con } y " comilla', b: { c: [1, 2, { d: '{' }] } });
  });
  it('devuelve null si la página no trae el estado o el JSON está cortado', () => {
    expect(Navent.extraerEstado('<html><body>nada</body></html>')).toBeNull();
    expect(Navent.extraerEstado('<script>window.__PRELOADED_STATE__ = {"a":')).toBeNull();
  });
});

describe('Navent.parsearPagina con una muestra real de Adondevivir', () => {
  const r = Navent.parsearPagina(fixture('adondevivir-arequipa-muestra.html'), { fuente: 'adondevivir', base: 'https://www.adondevivir.com', ...ctx });

  it('devuelve todos los avisos de la muestra y los datos de paginación', () => {
    expect(r.avisos).toHaveLength(6);
    expect(r.paginacion).toEqual({ total: 160, paginaActual: 1, totalPaginas: 6 });
  });

  it('departamento con área total y techada, dormitorios, baños, estacionamiento, precio en soles y dólares', () => {
    const a = por(r.avisos, '151184336');
    expect(a).toMatchObject({
      fuente: 'adondevivir',
      url: expect.stringMatching(/^https:\/\/www\.adondevivir\.com\/propiedades\/clasificado\/.*151184336\.html$/),
      titulo: 'Departamentos en Preventa en Cayma, Urb. Los Girasoles',
      tipo_inmueble: 'departamento',
      tipo_portal: 'Departamentos',
      operacion: 'venta',
      es_proyecto: false,
      precio: 617000,
      moneda: 'PEN',
      precio_alterno: 182500,
      moneda_alterna: 'USD',
      area_total_m2: 114,
      area_construida_m2: 114,
      precio_m2: 5412.28,
      precio_m2_base: 'construida',
      dormitorios: 3,
      banos: 2,
      estacionamientos: 1,
      distrito: 'CAYMA',
      zona: null,
      direccion: 'Urb. Los Girasoles',
      lat: -16.3699633,
      lon: -71.5455032,
      fecha_publicacion: null,
      fecha_actualizacion: '2026-09-25',
      fecha_captura: '2026-11-12T10:00:00.000Z',
    });
  });

  it('el distrito sale de la ZONA y la subzona va aparte; sin geolocalización lat y lon son null', () => {
    const a = por(r.avisos, '147469172');
    expect(a.distrito).toBe('YANAHUARA');
    expect(a.zona).toBe('Cercado De Yanahuara');
    expect(a.lat).toBeNull();
    expect(a.lon).toBeNull();
  });

  it('proyecto (desarrollo): precio «desde», sin áreas ni precio por m²', () => {
    const a = por(r.avisos, '148976364');
    expect(a).toMatchObject({ es_proyecto: true, tipo_inmueble: 'departamento', precio: 294926, moneda: 'PEN', area_total_m2: null, precio_m2: null, dormitorios: null, distrito: 'CAYMA' });
  });

  it('casa: decodifica las entidades HTML del título y calcula el precio por m² con el área construida', () => {
    const a = por(r.avisos, '150389942');
    expect(a.titulo).toContain('315 m²,');
    expect(a.titulo).not.toContain('&sup2;');
    expect(a).toMatchObject({ tipo_inmueble: 'casa', area_total_m2: 315, area_construida_m2: 486, precio_m2_base: 'construida', distrito: 'AREQUIPA', dormitorios: 7, banos: 7 });
  });

  it('terreno: precio por m² sobre el área total; un distrito fuera de Arequipa Metropolitana conserva su nombre', () => {
    const a = por(r.avisos, '90045056');
    expect(a).toMatchObject({ tipo_inmueble: 'terreno', area_total_m2: 21200, area_construida_m2: null, precio_m2_base: 'total', distrito: 'LA JOYA' });
    expect(a.precio_m2).toBeCloseTo(8649600 / 21200, 2);
  });

  it('no deja nada del anunciante: ni nombre, ni teléfono, ni enlaces a su perfil, ni la clave de mapas', () => {
    const texto = JSON.stringify(r.avisos);
    expect(texto).not.toMatch(/REDACTADO|inmobiliarias\/|publisher|whatsapp|maps\.google|AIza/i);
    for (const a of r.avisos) expect(Object.keys(a)).toEqual(E.COLUMNAS);
  });
});

describe('Navent.parsearPagina con una muestra real de Urbania', () => {
  const r = Navent.parsearPagina(fixture('urbania-arequipa-muestra.html'), { fuente: 'urbania', base: 'https://urbania.pe', ...ctx });

  it('lee los avisos y arma la URL con el dominio de Urbania', () => {
    expect(r.avisos).toHaveLength(3);
    expect(r.paginacion.total).toBe(162);
    expect(r.avisos.every((a: Aviso) => a.fuente === 'urbania' && a.url.startsWith('https://urbania.pe/inmueble/'))).toBe(true);
  });

  it('subzona dentro de la zona «Arequipa»: distrito AREQUIPA y zona Vallecito', () => {
    const a = por(r.avisos, '151442056');
    expect(a).toMatchObject({ distrito: 'AREQUIPA', zona: 'Vallecito', precio: 352920, area_total_m2: 54, dormitorios: 2, banos: 1, estacionamientos: 1 });
  });
});

describe('Navent.parsearPagina: datos faltantes', () => {
  const pagina = (postings: unknown[]) => `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ listStore: { listPostings: postings, paging: { total: postings.length, currentPage: 1, totalPages: 1 } } })};</script>`;
  const opciones = { fuente: 'adondevivir', base: 'https://www.adondevivir.com', ...ctx };

  it('un aviso sin precio, sin ubicación y sin características da nulls y no falla', () => {
    const r = Navent.parsearPagina(pagina([{ postingId: '1', url: '/propiedades/x-1.html', title: 'Algo', realEstateType: { name: 'Casas' }, priceOperationTypes: [], mainFeatures: {}, postingLocation: null }]), opciones);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ id_fuente: '1', precio: null, moneda: null, precio_m2: null, distrito: null, lat: null, dormitorios: null });
  });

  it('ignora los avisos que no son de venta y los que no traen id o url', () => {
    const alquiler = { postingId: '2', url: '/a-2.html', realEstateType: { name: 'Casas' }, priceOperationTypes: [{ operationType: { name: 'Alquiler' }, prices: [{ amount: 1000, currency: 'S/' }] }], mainFeatures: {} };
    const sinId = { url: '/a.html', priceOperationTypes: [] };
    expect(Navent.parsearPagina(pagina([alquiler, sinId]), opciones).avisos).toEqual([]);
  });

  it('una página sin estado precargado se informa como formato inesperado', () => {
    const r = Navent.parsearPagina('<html>otra cosa</html>', opciones);
    expect(r.avisos).toEqual([]);
    expect(r.error).toMatch(/formato/i);
  });
});

describe('Adondevivir.construirUrl', () => {
  it('lista por tipo de toda Arequipa y paginación -pagina-N antes de .html', () => {
    expect(Adondevivir.construirUrl({ tipo: 'departamento', pagina: 1 })).toBe('https://www.adondevivir.com/departamentos-en-venta-en-arequipa.html');
    expect(Adondevivir.construirUrl({ tipo: 'casa', pagina: 2 })).toBe('https://www.adondevivir.com/casas-en-venta-en-arequipa-pagina-2.html');
    expect(Adondevivir.construirUrl({ tipo: 'terreno', pagina: 1 })).toBe('https://www.adondevivir.com/terrenos-en-venta-en-arequipa.html');
  });
  it('distritos con página propia verificada', () => {
    expect(Adondevivir.construirUrl({ tipo: 'departamento', distrito: 'CAYMA', pagina: 1 })).toBe('https://www.adondevivir.com/departamentos-en-venta-en-cayma.html');
    expect(Adondevivir.construirUrl({ tipo: 'departamento', distrito: 'CERRO COLORADO', pagina: 3 })).toBe('https://www.adondevivir.com/departamentos-en-venta-en-cerro-colorado-pagina-3.html');
    expect(Adondevivir.construirUrl({ tipo: 'departamento', distrito: 'AREQUIPA', pagina: 1 })).toBe('https://www.adondevivir.com/departamentos-en-venta-en-arequipa-ciudad-de-arequipa.html');
  });
  it('un distrito sin página verificada usa la lista de toda Arequipa (se filtra después)', () => {
    expect(Adondevivir.construirUrl({ tipo: 'departamento', distrito: 'PAUCARPATA', pagina: 1 })).toBe('https://www.adondevivir.com/departamentos-en-venta-en-arequipa.html');
  });
  it('un tipo que la fuente no tiene devuelve null', () => {
    expect(Adondevivir.construirUrl({ tipo: 'oficina', pagina: 1 })).toBeNull();
  });
});

describe('Urbania.construirUrl', () => {
  it('lista por tipo y paginación con ?page=N', () => {
    expect(Urbania.construirUrl({ tipo: 'departamento', pagina: 1 })).toBe('https://urbania.pe/buscar/venta-de-departamentos-en-arequipa--arequipa');
    expect(Urbania.construirUrl({ tipo: 'casa', pagina: 2 })).toBe('https://urbania.pe/buscar/venta-de-casas-en-arequipa--arequipa?page=2');
  });
  it('distritos con página propia verificada', () => {
    expect(Urbania.construirUrl({ tipo: 'departamento', distrito: 'YANAHUARA', pagina: 1 })).toBe('https://urbania.pe/buscar/venta-de-departamentos-en-yanahuara--arequipa--arequipa');
    expect(Urbania.construirUrl({ tipo: 'terreno', distrito: 'AREQUIPA', pagina: 2 })).toBe('https://urbania.pe/buscar/venta-de-terrenos-en-arequipa--arequipa--arequipa?page=2');
  });
});

/** Cliente falso: `paginas` asocia URL → resultado de obtener(); lo que no está da error 404. */
function clienteFalso(paginas: Record<string, { estado: string; texto?: string; motivo?: string }>) {
  const pedidas: string[] = [];
  return {
    pedidas,
    obtener: async (url: string) => {
      pedidas.push(url);
      return paginas[url] ?? { estado: 'error', status: 404, motivo: 'HTTP 404' };
    },
  };
}
const pagAdv = (n: number) => `https://www.adondevivir.com/departamentos-en-venta-en-arequipa${n > 1 ? `-pagina-${n}` : ''}.html`;

describe('Adondevivir.buscar', () => {
  const html = fixture('adondevivir-arequipa-muestra.html');

  it('recorre las páginas pedidas, junta los avisos y los marca con la fuente', async () => {
    const cliente = clienteFalso({ [pagAdv(1)]: { estado: 'ok', texto: html }, [pagAdv(2)]: { estado: 'ok', texto: html } });
    const r = await Adondevivir.buscar({ tipo: 'departamento', distrito: null }, { cliente, paginas: 2, ...ctx });
    expect(cliente.pedidas).toEqual([pagAdv(1), pagAdv(2)]);
    expect(r.estado).toBe('ok');
    expect(r.paginas).toBe(2);
    expect(r.avisos).toHaveLength(12);
  });

  it('con tipo «todos» pide departamentos, casas y terrenos', async () => {
    const cliente = clienteFalso({});
    await Adondevivir.buscar({ tipo: 'todos', distrito: null }, { cliente, paginas: 1, ...ctx });
    expect(cliente.pedidas).toEqual([
      'https://www.adondevivir.com/departamentos-en-venta-en-arequipa.html',
      'https://www.adondevivir.com/casas-en-venta-en-arequipa.html',
      'https://www.adondevivir.com/terrenos-en-venta-en-arequipa.html',
    ]);
  });

  it('se detiene en la última página que informa el sitio', async () => {
    const corta = html.replace('"totalPages":6', '"totalPages":1');
    const cliente = clienteFalso({ [pagAdv(1)]: { estado: 'ok', texto: corta } });
    const r = await Adondevivir.buscar({ tipo: 'departamento', distrito: null }, { cliente, paginas: 4, ...ctx });
    expect(cliente.pedidas).toEqual([pagAdv(1)]);
    expect(r.avisos).toHaveLength(6);
  });

  it('si robots.txt no permite la página siguiente conserva lo recogido y lo dice', async () => {
    const cliente = clienteFalso({ [pagAdv(1)]: { estado: 'ok', texto: html }, [pagAdv(2)]: { estado: 'robots', motivo: 'robots.txt de www.adondevivir.com no permite /x' } });
    const r = await Adondevivir.buscar({ tipo: 'departamento', distrito: null }, { cliente, paginas: 3, ...ctx });
    expect(cliente.pedidas).toEqual([pagAdv(1), pagAdv(2)]);
    expect(r.estado).toBe('ok');
    expect(r.avisos).toHaveLength(6);
    expect(r.mensaje).toMatch(/robots\.txt/);
  });

  it('si el sitio bloquea, devuelve «bloqueado» con el motivo y no pide más páginas ni más tipos', async () => {
    const cliente = clienteFalso({ [pagAdv(1)]: { estado: 'bloqueado', motivo: 'bloqueado por el sitio o por límite de solicitudes (HTTP 403)' } });
    const r = await Adondevivir.buscar({ tipo: 'todos', distrito: null }, { cliente, paginas: 3, ...ctx });
    expect(r.estado).toBe('bloqueado');
    expect(r.avisos).toEqual([]);
    expect(r.mensaje).toMatch(/403/);
    expect(cliente.pedidas).toEqual([pagAdv(1)]);
  });

  it('un error en un tipo no impide recoger los otros; el resultado queda «parcial»', async () => {
    const cliente = clienteFalso({ [pagAdv(1)]: { estado: 'ok', texto: html } });
    const r = await Adondevivir.buscar({ tipo: 'todos', distrito: null }, { cliente, paginas: 1, ...ctx });
    expect(r.estado).toBe('parcial');
    expect(r.avisos).toHaveLength(6);
    expect(r.mensaje).toMatch(/casa/);
  });

  it('una página con formato inesperado es error y no inventa avisos', async () => {
    const cliente = clienteFalso({ [pagAdv(1)]: { estado: 'ok', texto: '<html>cambió el sitio</html>' } });
    const r = await Adondevivir.buscar({ tipo: 'departamento', distrito: null }, { cliente, paginas: 1, ...ctx });
    expect(r.estado).toBe('error');
    expect(r.avisos).toEqual([]);
    expect(r.mensaje).toMatch(/formato/i);
  });
});

describe('Urbania.buscar', () => {
  it('lee la página y pide ?page=2 para la segunda', async () => {
    const html = fixture('urbania-arequipa-muestra.html');
    const u1 = 'https://urbania.pe/buscar/venta-de-departamentos-en-arequipa--arequipa';
    const cliente = clienteFalso({ [u1]: { estado: 'ok', texto: html }, [`${u1}?page=2`]: { estado: 'ok', texto: html } });
    const r = await Urbania.buscar({ tipo: 'departamento', distrito: null }, { cliente, paginas: 2, ...ctx });
    expect(cliente.pedidas).toEqual([u1, `${u1}?page=2`]);
    expect(r.avisos).toHaveLength(6);
  });

  it('un desafío anti-bot se informa como bloqueado y no se sigue', async () => {
    const cliente = clienteFalso({ 'https://urbania.pe/buscar/venta-de-departamentos-en-arequipa--arequipa': { estado: 'bloqueado', motivo: 'desafío anti-bot (HTTP 403)' } });
    const r = await Urbania.buscar({ tipo: 'todos', distrito: null }, { cliente, paginas: 2, ...ctx });
    expect(r.estado).toBe('bloqueado');
    expect(r.mensaje).toMatch(/anti-bot/);
    expect(cliente.pedidas).toHaveLength(1);
  });
});
