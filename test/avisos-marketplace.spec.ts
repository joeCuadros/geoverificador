/**
 * Pruebas de la fuente Facebook Marketplace (scripts/lib/avisos/fuentes/marketplace.js).
 *
 * IMPORTANTE: no hay una respuesta real de Marketplace en el repositorio (exige una sesión iniciada por una persona y el
 * robots.txt de Facebook prohíbe todo para rastreadores). La estructura de `DATOS` de abajo es SINTÉTICA, hecha a mano con la
 * forma de los resultados de búsqueda que se conoce (nodos con `marketplace_listing_title`, `listing_price`, `location`); NO está
 * verificada contra una respuesta real y hay que confirmarla con una muestra real antes de fiarse del parser.
 * Lo que sí se prueba de verdad: la compuerta de robots.txt, el aviso de que Playwright no está instalado y que no se
 * guarda nada del vendedor. Sin red ni navegador.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const M = require('../scripts/lib/avisos/fuentes/marketplace.js');
const E = require('../scripts/lib/avisos/esquema.js');

const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
const DISTRITOS: string[] = geojson.features.map((f: { properties: { distrito: string } }) => f.properties.distrito);
const ctx = { distritosConocidos: DISTRITOS, ahora: new Date('2026-11-12T10:00:00.000Z') };
type Aviso = Record<string, any>;

// SINTÉTICO (ver el encabezado).
const DATOS = {
  require: [
    [
      'RelayPrefetchedStreamCache',
      {
        data: {
          marketplace_search: {
            feed_units: {
              edges: [
                {
                  node: {
                    __typename: 'MarketplaceFeedListingStoryObject',
                    listing: {
                      id: '1111111111',
                      marketplace_listing_title: 'Casa en venta en Cayma 200 m2',
                      listing_price: { amount: '250000.00', formatted_amount: 'S/ 250,000' },
                      location: { reverse_geocode: { city: 'Cayma', state: 'AR' } },
                      marketplace_listing_seller: { name: 'Persona Privada', id: '999', profile_url: 'https://www.facebook.com/persona.privada' },
                      primary_listing_photo: { image: { uri: 'https://scontent.example/foto.jpg' } },
                      is_sold: false,
                    },
                  },
                },
                {
                  node: {
                    listing: {
                      id: '2222222222',
                      marketplace_listing_title: 'Terreno 300 m2',
                      listing_price: { amount: '45000.00', formatted_amount: 'US$45,000' },
                      location: { reverse_geocode: { city: 'Arequipa', state: 'AR' } },
                      marketplace_listing_seller: { name: 'Otra Persona' },
                    },
                  },
                },
                { node: { listing: { id: '3333333333', marketplace_listing_title: 'Departamento sin precio', location: { reverse_geocode: { city: 'Sachaca' } } } } },
                { node: { listing: { id: '4444444444', marketplace_listing_title: 'Vendido', is_sold: true, listing_price: { amount: '1', formatted_amount: 'S/ 1' } } } },
              ],
            },
          },
        },
      },
    ],
  ],
};

describe('Marketplace.parsearPrecio', () => {
  it('lee monto y moneda del texto que muestra Marketplace', () => {
    expect(M.parsearPrecio('S/ 250,000')).toEqual({ monto: 250000, moneda: 'PEN' });
    expect(M.parsearPrecio('S/250,000')).toEqual({ monto: 250000, moneda: 'PEN' });
    expect(M.parsearPrecio('US$45,000')).toEqual({ monto: 45000, moneda: 'USD' });
    expect(M.parsearPrecio('$ 120,500')).toEqual({ monto: 120500, moneda: 'USD' });
  });
  it('sin monto legible, null (no se adivina)', () => {
    expect(M.parsearPrecio('Gratis')).toEqual({ monto: null, moneda: null });
    expect(M.parsearPrecio(undefined)).toEqual({ monto: null, moneda: null });
  });
});

describe('Marketplace.parsear (estructura sintética)', () => {
  const r = M.parsear(DATOS, ctx);
  const por = (id: string): Aviso => r.find((a: Aviso) => a.id_fuente === id);

  it('encuentra los avisos anidados a cualquier profundidad y salta los vendidos', () => {
    expect(r.map((a: Aviso) => a.id_fuente)).toEqual(['1111111111', '2222222222', '3333333333']);
  });

  it('normaliza título, precio, moneda y URL; el tipo no se adivina por el título', () => {
    expect(por('1111111111')).toMatchObject({
      fuente: 'marketplace',
      url: 'https://www.facebook.com/marketplace/item/1111111111/',
      titulo: 'Casa en venta en Cayma 200 m2',
      tipo_inmueble: null,
      precio: 250000,
      moneda: 'PEN',
      area_total_m2: null,
      precio_m2: null,
      distrito: 'CAYMA',
    });
    expect(por('2222222222')).toMatchObject({ precio: 45000, moneda: 'USD' });
  });

  it('una ciudad que no es un distrito conocido no se toma como distrito; «Arequipa» es la ciudad, no el distrito Cercado', () => {
    expect(por('2222222222').distrito).toBeNull();
    expect(por('2222222222').zona).toBe('Arequipa');
    const otro = M.parsear({ listing: { id: '5', marketplace_listing_title: 'x', location: { reverse_geocode: { city: 'Lima' } } } }, ctx);
    expect(otro[0].distrito).toBeNull();
    expect(otro[0].zona).toBe('Lima');
  });

  it('sin precio publicado, precio null', () => {
    expect(por('3333333333')).toMatchObject({ precio: null, moneda: null, distrito: 'SACHACA' });
  });

  it('no guarda nada del vendedor: ni nombre, ni identificador, ni perfil, ni foto', () => {
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/Persona|Otra Persona|profile|persona\.privada|scontent|"999"/i);
    for (const a of r) expect(Object.keys(a)).toEqual(E.COLUMNAS);
  });

  it('acepta también el JSON como texto y datos vacíos', () => {
    expect(M.parsear(JSON.stringify(DATOS), ctx)).toHaveLength(3);
    expect(M.parsear('no es json', ctx)).toEqual([]);
    expect(M.parsear(null, ctx)).toEqual([]);
  });
});

describe('Marketplace.cargarNavegador', () => {
  it('si Playwright no está instalado, falla con una explicación clara en español', async () => {
    const importar = async () => {
      throw Object.assign(new Error("Cannot find package 'playwright'"), { code: 'ERR_MODULE_NOT_FOUND' });
    };
    await expect(M.cargarNavegador(importar)).rejects.toThrow(/Playwright no está instalado/);
    await expect(M.cargarNavegador(importar)).rejects.toThrow(/pnpm add -D playwright/);
  });
  it('un error distinto de «no encontrado» se propaga tal cual', async () => {
    const importar = async () => {
      throw new Error('fallo raro');
    };
    await expect(M.cargarNavegador(importar)).rejects.toThrow('fallo raro');
  });
});

describe('Marketplace.buscar', () => {
  const filtros = { tipo: 'todos', distrito: null };
  const armar = (permitido: Record<string, unknown>, cargarNavegador = jest.fn()) => ({ cliente: { permitido: jest.fn(async () => permitido) }, cargarNavegador, paginas: 1, ...ctx });

  it('si robots.txt de Facebook lo prohíbe, se omite sin abrir el navegador', async () => {
    const c = armar({ estado: 'robots', motivo: 'robots.txt de www.facebook.com no permite /marketplace/arequipa/propertyforsale' });
    const r = await M.buscar(filtros, c);
    expect(r).toMatchObject({ estado: 'robots', avisos: [], paginas: 0 });
    expect(r.mensaje).toMatch(/robots\.txt/);
    expect(c.cargarNavegador).not.toHaveBeenCalled();
  });

  it('si el sitio bloquea la lectura de robots.txt se informa como bloqueado', async () => {
    const r = await M.buscar(filtros, armar({ estado: 'bloqueado', motivo: 'HTTP 429' }));
    expect(r).toMatchObject({ estado: 'bloqueado', avisos: [] });
  });

  it('si robots.txt lo permitiera pero Playwright falta, estado «sin_navegador» con el mensaje', async () => {
    const cargar = jest.fn(async () => {
      throw new Error('Playwright no está instalado. Para usar Marketplace…');
    });
    const r = await M.buscar(filtros, armar({ estado: 'ok' }, cargar));
    expect(r).toMatchObject({ estado: 'sin_navegador', avisos: [] });
    expect(r.mensaje).toMatch(/Playwright no está instalado/);
  });
});
