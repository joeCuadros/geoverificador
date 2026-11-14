/**
 * Pruebas de las variantes Apify de las fuentes (scripts/lib/avisos/apify-mapeo.js y apify-fuentes.js): traducción de la salida de
 * los actores al esquema normalizado, armado del input con tope de ítems, actores configurables y fallos claros.
 *
 * IMPORTANTE: los archivos test/fixtures/avisos/apify-*-sintetico.json son SINTÉTICOS, hechos a mano con los nombres de campo de
 * las páginas públicas de los actores; NO son salidas reales de Apify y los nombres de campo NO están verificados. Los mapeadores
 * se escriben a la defensiva por eso. Sin red: el cliente de Apify es un doble.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const Mapeo = require('../scripts/lib/avisos/apify-mapeo.js');
const AF = require('../scripts/lib/avisos/apify-fuentes.js');
const Rec = require('../scripts/lib/avisos/recolector.js');
const E = require('../scripts/lib/avisos/esquema.js');

const leer = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'avisos', n), 'utf8')).items as unknown[];
const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
const DISTRITOS: string[] = geojson.features.map((f: { properties: { distrito: string } }) => f.properties.distrito);
const AHORA = new Date('2026-11-12T10:00:00.000Z');
type Aviso = Record<string, any>;

describe('Mapeo.mapearScrapersLat (salida sintética de scrapers_lat)', () => {
  const ACTOR = 'scrapers_lat/urbania-scraper';
  const r = Mapeo.mapearItems(leer('apify-scrapers-lat-sintetico.json'), 'scrapers_lat', { fuente: 'urbania', base: 'https://urbania.pe', actor: ACTOR, distritosConocidos: DISTRITOS, ahora: AHORA });
  const por = (id: string): Aviso => r.avisos.find((a: Aviso) => a.id_fuente === id);

  it('cuenta lo mapeado, lo descartado por no ser venta y lo que no se pudo mapear, sin lanzar excepciones', () => {
    expect(r.avisos.map((a: Aviso) => a.id_fuente)).toEqual(['151184336', '150000001', '150000002', '150000004', '4461355', '4461356', '4461357']);
    expect(r.descartados).toEqual({ no_venta: 1, vendido: 0 });
    expect(r.noMapeados).toBe(3);
  });

  it('aviso completo: precio, moneda y equivalente, áreas, características, distrito, coordenadas y fecha', () => {
    expect(por('151184336')).toMatchObject({
      fuente: 'urbania',
      url: 'https://urbania.pe/inmueble/clasificado/veclapin-departamentos-en-preventa-en-cayma-151184336',
      titulo: 'Departamentos en Preventa en Cayma, Urb. Los Girasoles',
      tipo_inmueble: 'departamento',
      tipo_portal: 'Departamento',
      precio: 617000,
      moneda: 'PEN',
      precio_alterno: 182500,
      moneda_alterna: 'USD',
      area_total_m2: 120,
      area_construida_m2: 114,
      precio_m2: 5412.28,
      precio_m2_base: 'construida',
      dormitorios: 3,
      banos: 2,
      estacionamientos: 1,
      distrito: 'CAYMA',
      direccion: 'Urb. Los Girasoles',
      lat: -16.3699633,
      lon: -71.5455032,
      fecha_publicacion: '2026-10-01',
      via: 'apify',
      actor: ACTOR,
      fecha_captura: '2026-11-12T10:00:00.000Z',
    });
    expect(Object.keys(por('151184336'))).toEqual(E.COLUMNAS);
  });

  it('tolera nombres distintos: solo precio en dólares, tipo en inglés, latitude/longitude sueltos y distrito sacado de «location»', () => {
    expect(por('150000001')).toMatchObject({ precio: 250000, moneda: 'USD', precio_alterno: null, tipo_inmueble: 'casa', distrito: 'YANAHUARA', lat: -16.39, lon: -71.54, area_total_m2: 300 });
  });

  it('precio como texto «S/ 120,000», áreas como texto y distrito explícito aunque no sea Cercado', () => {
    expect(por('150000002')).toMatchObject({ precio: 120000, moneda: 'PEN', area_total_m2: 300, precio_m2: 400, tipo_inmueble: 'terreno', distrito: 'PAUCARPATA' });
  });

  it('valores inservibles (precio raro, área negativa, coordenadas que no son un objeto) quedan en null sin descartar el aviso', () => {
    expect(por('150000004')).toMatchObject({ precio: null, moneda: null, area_total_m2: null, lat: null, lon: null, precio_m2: null });
  });

  it('no deja nada del anunciante: nombres, teléfonos, WhatsApp, publicador ni enlaces a perfiles', () => {
    const texto = JSON.stringify(r.avisos);
    expect(texto).not.toMatch(/NO_DEBE_SALIR|999111222|987654321|whatsapp|inmobiliarias\/|publisher|agent|description|imageUrl|img\.example/i);
    expect(texto).not.toMatch(/aiListing|aiFeatures/);
  });

  describe('proyectos («Desarrollo» / isDevelopment), como en la salida real de scrapers_lat en modo lista', () => {
    const contexto = (extra = {}) => ({ fuente: 'urbania', base: 'https://urbania.pe', actor: ACTOR, distritosConocidos: DISTRITOS, ahora: AHORA, ...extra });
    const con = (tipoBusqueda: string | null) => Mapeo.mapearItems(leer('apify-scrapers-lat-sintetico.json'), 'scrapers_lat', contexto({ tipoBusqueda }));
    const porId = (x: any, id: string): Aviso => x.avisos.find((a: Aviso) => a.id_fuente === id);

    it('propertyType «Desarrollo» es proyecto, conserva tipo_portal y no se descarta; el distrito sale del location del ítem', () => {
      expect(por('4461355')).toMatchObject({ es_proyecto: true, tipo_portal: 'Desarrollo', precio: 300000, moneda: 'PEN', area_total_m2: 60, dormitorios: 2, distrito: 'CAYMA' });
    });
    it('isDevelopment === true también marca proyecto, aunque propertyType diga otra cosa', () => {
      expect(por('4461356')).toMatchObject({ es_proyecto: true, tipo_portal: 'Desarrollo' });
      const x = Mapeo.mapearItems([{ listingId: '9', url: 'https://urbania.pe/x-99999', price: 1, currency: 'PEN', propertyType: 'Departamento', isDevelopment: true }], 'scrapers_lat', contexto());
      expect(x.avisos[0]).toMatchObject({ es_proyecto: true, tipo_inmueble: 'departamento' });
    });
    it('misma convención que Nexo: un proyecto no lleva precio por m² (aunque tenga un solo precio y una sola área)', () => {
      expect(por('4461355')).toMatchObject({ precio_m2: null, precio_m2_base: null });
      expect(por('4461356').precio_m2).toBeNull();
    });
    it('el tipo sale de la búsqueda (un solo tipo); si no, del título; si no, null', () => {
      const casa = con('casa');
      expect(porId(casa, '4461355').tipo_inmueble).toBe('casa'); // manda la búsqueda aunque el título hable de departamentos
      expect(porId(casa, '4461357').tipo_inmueble).toBe('casa');
      const varios = con(null);
      expect(porId(varios, '4461355').tipo_inmueble).toBe('departamento'); // del título
      expect(porId(varios, '4461357').tipo_inmueble).toBeNull(); // sin pista: no se adivina
    });
    it('un tipo desconocido que no es proyecto no se inventa a partir de la búsqueda', () => {
      const x = Mapeo.mapearItems([{ listingId: '8', url: 'https://urbania.pe/x-88888', price: 1, currency: 'PEN', propertyType: 'Chacra' }], 'scrapers_lat', contexto({ tipoBusqueda: 'casa' }));
      expect(x.avisos[0].tipo_inmueble).toBeNull();
    });
    it('el location con barrio y separadores varios también da el distrito', () => {
      const x = Mapeo.mapearItems([{ listingId: '7', url: 'https://urbania.pe/x-77777', price: 1, currency: 'PEN', location: 'Urb. Los Girasoles - Cayma, Arequipa' }], 'scrapers_lat', contexto());
      expect(x.avisos[0].distrito).toBe('CAYMA');
    });
  });

  it('«Arequipa» en location no se toma como distrito Cercado', () => {
    const x = Mapeo.mapearItems([{ listingId: '1', url: 'https://urbania.pe/x-1', location: 'Arequipa, Arequipa', price: 1, currency: 'PEN' }], 'scrapers_lat', { fuente: 'urbania', base: 'https://urbania.pe', actor: ACTOR, distritosConocidos: DISTRITOS, ahora: AHORA });
    expect(x.avisos[0].distrito).toBeNull();
  });

  it('sin listingId toma el número final de la URL antes que el código alfanumérico', () => {
    const x = Mapeo.mapearItems([{ url: 'https://urbania.pe/inmueble/clasificado/algo-777888', postingCode: 'ZZ9', price: 1, currency: 'PEN' }], 'scrapers_lat', { fuente: 'urbania', base: 'https://urbania.pe', actor: ACTOR, distritosConocidos: DISTRITOS, ahora: AHORA });
    expect(x.avisos[0].id_fuente).toBe('777888');
  });

  it('una entrada que no es una lista da resultado vacío', () => {
    expect(Mapeo.mapearItems(null, 'scrapers_lat', {}).avisos).toEqual([]);
  });
});

describe('Mapeo.mapearMarketplace (salida sintética de apify/facebook-marketplace-scraper)', () => {
  const ACTOR = 'apify/facebook-marketplace-scraper';
  const r = Mapeo.mapearItems(leer('apify-marketplace-sintetico.json'), 'marketplace', { fuente: 'marketplace', actor: ACTOR, distritosConocidos: DISTRITOS, ahora: AHORA });
  const por = (id: string): Aviso => r.avisos.find((a: Aviso) => a.id_fuente === id);

  it('cuenta mapeados, vendidos y no mapeables', () => {
    expect(r.avisos.map((a: Aviso) => a.id_fuente)).toEqual(['1111111111', '2222222222', '3333333333']);
    expect(r.descartados).toEqual({ no_venta: 0, vendido: 1 });
    expect(r.noMapeados).toBe(2);
  });

  it('aviso con detalles: título, precio, moneda, distrito, coordenadas y fecha de «timestamp»', () => {
    expect(por('1111111111')).toMatchObject({
      fuente: 'marketplace',
      url: 'https://www.facebook.com/marketplace/item/1111111111/',
      titulo: 'Casa en venta en Cayma 200 m2',
      tipo_inmueble: null,
      precio: 250000,
      moneda: 'PEN',
      distrito: 'CAYMA',
      lat: -16.37,
      lon: -71.55,
      fecha_publicacion: '2025-10-09',
      via: 'apify',
      actor: ACTOR,
    });
  });

  it('sin detalles: sin coordenadas ni fecha (null); la ciudad «Arequipa» no es distrito; sin precio, null', () => {
    expect(por('2222222222')).toMatchObject({ precio: 45000, moneda: 'USD', distrito: null, zona: 'Arequipa', lat: null, lon: null, fecha_publicacion: null, url: 'https://www.facebook.com/marketplace/item/2222222222/' });
    expect(por('3333333333')).toMatchObject({ precio: null, moneda: null, zona: 'Lima' });
  });

  it('no deja nada del vendedor ni la descripción (que puede traer teléfonos) ni las fotos', () => {
    const texto = JSON.stringify(r.avisos);
    expect(texto).not.toMatch(/NO_DEBE_SALIR|999888777|987654321|seller|scontent|Casa amplia/i);
    for (const a of r.avisos) expect(Object.keys(a)).toEqual(E.COLUMNAS);
  });
});

describe('Apify-fuentes.resolverActores', () => {
  it('por defecto: los tres actores acordados', () => {
    expect(AF.resolverActores({ flags: {}, env: {} })).toEqual({
      urbania: 'scrapers_lat/urbania-scraper',
      adondevivir: 'scrapers_lat/adondevivir-scraper',
      marketplace: 'apify/facebook-marketplace-scraper',
    });
  });
  it('el entorno reemplaza el valor por defecto y la bandera reemplaza al entorno', () => {
    const a = AF.resolverActores({ flags: { urbania: 'otro/urbania-v2' }, env: { APIFY_ACTOR_URBANIA: 'env/urbania', APIFY_ACTOR_MARKETPLACE: 'env/mkt' } });
    expect(a).toMatchObject({ urbania: 'otro/urbania-v2', marketplace: 'env/mkt', adondevivir: 'scrapers_lat/adondevivir-scraper' });
  });
  it('un identificador mal formado es un error', () => {
    expect(() => AF.resolverActores({ flags: {}, env: { APIFY_ACTOR_URBANIA: 'sin-usuario' } })).toThrow(/APIFY_ACTOR_URBANIA/);
    expect(() => AF.resolverActores({ flags: { adondevivir: 'a b/c' }, env: {} })).toThrow(/adondevivir/);
  });
});

describe('Apify-fuentes.buscar', () => {
  const clienteFalso = (items: unknown[] | Error) => ({
    ejecutar: jest.fn(async () => {
      if (items instanceof Error) throw items;
      return items;
    }),
  });
  const apify = (cliente: unknown, extra: Record<string, unknown> = {}) => ({ cliente, topeUsd: 0.5, detalles: false, maxItems: null, actores: AF.resolverActores({ flags: {}, env: {} }), urlMarketplace: null, ...extra });
  const ctx = (a: unknown, extra: Record<string, unknown> = {}) => ({ apify: a, paginas: 2, distritosConocidos: DISTRITOS, ahora: AHORA, log: jest.fn(), ...extra });

  it('urbania: un solo run con las URL de búsqueda de los adaptadores directos, tope de ítems derivado de las páginas y withDetails=false', async () => {
    const c = clienteFalso(leer('apify-scrapers-lat-sintetico.json'));
    const x = ctx(apify(c));
    const r = await AF.buscar('urbania', { tipo: 'todos', distrito: null }, x);
    expect(c.ejecutar).toHaveBeenCalledTimes(1);
    const [actor, input, opciones] = c.ejecutar.mock.calls[0] as [string, Aviso, Aviso];
    expect(actor).toBe('scrapers_lat/urbania-scraper');
    expect(input).toEqual({
      startUrls: [
        { url: 'https://urbania.pe/buscar/venta-de-departamentos-en-arequipa--arequipa' },
        { url: 'https://urbania.pe/buscar/venta-de-casas-en-arequipa--arequipa' },
        { url: 'https://urbania.pe/buscar/venta-de-terrenos-en-arequipa--arequipa' },
      ],
      maxListings: 180, // 2 páginas × 30 avisos × 3 tipos
      withDetails: false,
    });
    expect(opciones).toEqual({ topeUsd: 0.5, maxItems: 180 });
    expect(r).toMatchObject({ estado: 'parcial', via: 'apify' });
    expect(r.avisos).toHaveLength(7);
    expect(r.avisos.every((a: Aviso) => a.via === 'apify' && a.actor === 'scrapers_lat/urbania-scraper' && a.fuente === 'urbania')).toBe(true);
    expect(r.mensaje).toMatch(/3 ítem\(s\) no se pudieron mapear/);
  });

  it('búsqueda de un solo tipo: los proyectos heredan ese tipo y pasan el filtro --tipo; el distrito sale del location, no del filtro --distrito', async () => {
    const c = clienteFalso(leer('apify-scrapers-lat-sintetico.json'));
    const r = await AF.buscar('urbania', { tipo: 'departamento', distrito: 'YANAHUARA' }, ctx(apify(c)));
    expect(r.avisos.find((a: Aviso) => a.id_fuente === '4461355')).toMatchObject({ es_proyecto: true, tipo_inmueble: 'departamento', distrito: 'CAYMA' });
    const ids = Rec.filtrarAvisos(r.avisos, { distrito: null, tipo: 'departamento' }).avisos.map((a: Aviso) => a.id_fuente);
    expect(ids).toEqual(expect.arrayContaining(['4461355', '4461356', '4461357']));
  });

  it('con varios tipos a la vez no se atribuye el tipo de la búsqueda a ningún proyecto', async () => {
    const c = clienteFalso(leer('apify-scrapers-lat-sintetico.json'));
    const r = await AF.buscar('urbania', { tipo: 'todos', distrito: null }, ctx(apify(c)));
    expect(r.avisos.find((a: Aviso) => a.id_fuente === '4461357').tipo_inmueble).toBeNull();
  });

  it('antes de empezar informa el actor, el tope de ítems y el tope de USD', async () => {
    const x = ctx(apify(clienteFalso([])));
    await AF.buscar('urbania', { tipo: 'departamento', distrito: null }, x);
    const lineas = (x.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n');
    expect(lineas).toContain('scrapers_lat/urbania-scraper');
    expect(lineas).toContain('60 ítems');
    expect(lineas).toContain('0.5 USD');
    expect(lineas).toMatch(/de pago/);
  });

  it('adondevivir: mismas reglas con su actor y sus URL; distrito con página propia; detalles activados', async () => {
    const c = clienteFalso([]);
    await AF.buscar('adondevivir', { tipo: 'departamento', distrito: 'CAYMA' }, ctx(apify(c, { detalles: true })));
    const [actor, input] = c.ejecutar.mock.calls[0] as [string, Aviso];
    expect(actor).toBe('scrapers_lat/adondevivir-scraper');
    expect(input).toEqual({ startUrls: [{ url: 'https://www.adondevivir.com/departamentos-en-venta-en-cayma.html' }], maxListings: 60, withDetails: true });
  });

  it('--max-items manda sobre las páginas, y el tope de USD se pasa tal cual', async () => {
    const c = clienteFalso([]);
    await AF.buscar('urbania', { tipo: 'todos', distrito: null }, ctx(apify(c, { maxItems: 5, topeUsd: 0.1 })));
    const [, input, opciones] = c.ejecutar.mock.calls[0] as [string, Aviso, Aviso];
    expect(input.maxListings).toBe(5);
    expect(opciones).toEqual({ topeUsd: 0.1, maxItems: 5 });
  });

  it('usa el actor reemplazado por configuración', async () => {
    const c = clienteFalso([]);
    await AF.buscar('urbania', { tipo: 'casa', distrito: null }, ctx(apify(c, { actores: { ...AF.resolverActores({ flags: {}, env: {} }), urbania: 'otro/actor' } })));
    expect(c.ejecutar.mock.calls[0][0]).toBe('otro/actor');
  });

  it('marketplace: exige una URL de inicio; sin ella falla con un mensaje claro y no llama a Apify', async () => {
    const c = clienteFalso([]);
    const r = await AF.buscar('marketplace', { tipo: 'todos', distrito: null }, ctx(apify(c)));
    expect(c.ejecutar).not.toHaveBeenCalled();
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/--url-marketplace/);
    expect(r.mensaje).toMatch(/MARKETPLACE_URL/);
    expect(r.mensaje).toMatch(/facebook\.com\/marketplace/);
  });

  it('marketplace: rechaza una URL que no es de Facebook', async () => {
    const c = clienteFalso([]);
    const r = await AF.buscar('marketplace', { tipo: 'todos', distrito: null }, ctx(apify(c, { urlMarketplace: 'https://ejemplo.com/x' })));
    expect(r.estado).toBe('error');
    expect(c.ejecutar).not.toHaveBeenCalled();
  });

  it('marketplace con URL: input startUrls/resultsLimit/includeListingDetails; no hace ninguna solicitud propia a Facebook', async () => {
    const c = clienteFalso(leer('apify-marketplace-sintetico.json'));
    const url = 'https://www.facebook.com/marketplace/arequipa/propertyforsale';
    const r = await AF.buscar('marketplace', { tipo: 'todos', distrito: null }, ctx(apify(c, { urlMarketplace: url, detalles: true })));
    const [actor, input, opciones] = c.ejecutar.mock.calls[0] as [string, Aviso, Aviso];
    expect(actor).toBe('apify/facebook-marketplace-scraper');
    expect(input).toEqual({ startUrls: [{ url }], resultsLimit: 60, includeListingDetails: true });
    expect(opciones).toEqual({ topeUsd: 0.5, maxItems: 60 });
    expect(r.avisos).toHaveLength(3);
    expect(r.avisos.every((a: Aviso) => a.fuente === 'marketplace' && a.via === 'apify')).toBe(true);
  });

  it('un error de Apify (sin crédito, token inválido, falla) es estado «error» con el mensaje y sin avisos', async () => {
    const r = await AF.buscar('urbania', { tipo: 'todos', distrito: null }, ctx(apify(clienteFalso(new Error('Apify informa que no hay crédito suficiente (HTTP 402).')))));
    expect(r).toMatchObject({ estado: 'error', avisos: [] });
    expect(r.mensaje).toMatch(/crédito/);
  });

  it('si el actor devuelve ítems pero ninguno se puede mapear, es error de formato (no «ok» vacío)', async () => {
    const r = await AF.buscar('urbania', { tipo: 'todos', distrito: null }, ctx(apify(clienteFalso([{ cosa: 1 }, { otra: 2 }]))));
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/formato/i);
  });

  it('si el actor no devuelve nada, ok con aviso y sin avisos', async () => {
    const r = await AF.buscar('urbania', { tipo: 'todos', distrito: null }, ctx(apify(clienteFalso([]))));
    expect(r.estado).toBe('ok');
    expect(r.mensaje).toMatch(/no devolvió/);
  });

  it('un tipo que la fuente no tiene se omite sin llamar a Apify', async () => {
    const c = clienteFalso([]);
    const r = await AF.buscar('urbania', { tipo: 'oficina', distrito: null }, ctx(apify(c)));
    expect(r.estado).toBe('omitido');
    expect(c.ejecutar).not.toHaveBeenCalled();
  });

  it('una fuente sin variante Apify (Nexo) es un error de programación claro', async () => {
    await expect(AF.buscar('nexo', { tipo: 'todos' }, ctx(apify(clienteFalso([]))))).rejects.toThrow(/nexo/);
  });
});
