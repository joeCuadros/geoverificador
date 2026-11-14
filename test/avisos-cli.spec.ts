/**
 * Pruebas de la línea de comandos de recolectar-avisos (scripts/lib/avisos/cli.js), del recolector que une las fuentes
 * (scripts/lib/avisos/recolector.js) y de los escritores JSON y CSV (scripts/lib/avisos/salida.js). Sin red: fuentes falsas.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Cli = require('../scripts/lib/avisos/cli.js');
const Rec = require('../scripts/lib/avisos/recolector.js');
const Salida = require('../scripts/lib/avisos/salida.js');
const E = require('../scripts/lib/avisos/esquema.js');

const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'distritos_aqp.geojson'), 'utf8'));
const DISTRITOS: string[] = geojson.features.map((f: { properties: { distrito: string } }) => f.properties.distrito);
const AHORA = new Date('2026-11-12T10:00:00.000Z');
type Aviso = Record<string, any>;

describe('Cli.parsearArgumentos', () => {
  it('sin argumentos usa los valores por defecto', () => {
    expect(Cli.parsearArgumentos([])).toEqual({
      ayuda: false,
      fuentes: ['nexo', 'adondevivir', 'urbania'],
      distrito: null,
      tipo: 'todos',
      paginas: 2,
      salida: null,
      formato: 'json',
      esperaSeg: 3,
      perfil: null,
      transporte: 'directo',
      topeUsd: 0.5,
      conDetalles: false,
      maxItems: null,
      actores: {},
      urlMarketplace: null,
    });
  });

  it('acepta «--bandera valor» y «--bandera=valor»', () => {
    const a = Cli.parsearArgumentos(['--fuente', 'urbania', '--distrito=Cayma', '--tipo', 'casa', '--paginas', '3', '--salida', 'x/y.json', '--formato=csv']);
    expect(a).toMatchObject({ fuentes: ['urbania'], distrito: 'Cayma', tipo: 'casa', paginas: 3, salida: 'x/y.json', formato: 'csv' });
  });

  it('«todas» son las fuentes sin navegador; Marketplace solo si se pide por nombre', () => {
    expect(Cli.parsearArgumentos(['--fuente', 'todas']).fuentes).toEqual(['nexo', 'adondevivir', 'urbania']);
    expect(Cli.parsearArgumentos(['--fuente', 'marketplace']).fuentes).toEqual(['marketplace']);
    expect(Cli.parsearArgumentos(['--fuente', 'nexo,marketplace']).fuentes).toEqual(['nexo', 'marketplace']);
  });

  it('acepta el tipo en plural', () => {
    expect(Cli.parsearArgumentos(['--tipo', 'departamentos']).tipo).toBe('departamento');
    expect(Cli.parsearArgumentos(['--tipo', 'Terrenos']).tipo).toBe('terreno');
  });

  it('ignora un «--» suelto (pnpm lo reenvía al script)', () => {
    expect(Cli.parsearArgumentos(['--', '--tipo', 'casa']).tipo).toBe('casa');
    expect(Cli.parsearArgumentos(['--', '--ayuda']).ayuda).toBe(true);
  });

  it('--ayuda y -h piden la ayuda', () => {
    expect(Cli.parsearArgumentos(['--ayuda']).ayuda).toBe(true);
    expect(Cli.parsearArgumentos(['-h']).ayuda).toBe(true);
  });

  it('rechaza valores no válidos con un mensaje en español', () => {
    expect(() => Cli.parsearArgumentos(['--fuente', 'zonaprop'])).toThrow(/fuente/i);
    expect(() => Cli.parsearArgumentos(['--tipo', 'castillo'])).toThrow(/tipo/i);
    expect(() => Cli.parsearArgumentos(['--formato', 'xml'])).toThrow(/formato/i);
    expect(() => Cli.parsearArgumentos(['--paginas', '0'])).toThrow(/páginas/i);
    expect(() => Cli.parsearArgumentos(['--paginas', 'muchas'])).toThrow(/páginas/i);
    expect(() => Cli.parsearArgumentos(['--paginas', '50'])).toThrow(/páginas/i);
    expect(() => Cli.parsearArgumentos(['--fuente'])).toThrow(/valor/i);
    expect(() => Cli.parsearArgumentos(['--rara'])).toThrow(/--rara/);
    expect(() => Cli.parsearArgumentos(['suelto'])).toThrow(/suelto/);
  });

  it('la espera mínima entre solicitudes es de 2 segundos', () => {
    expect(Cli.parsearArgumentos(['--espera', '2']).esperaSeg).toBe(2);
    expect(Cli.parsearArgumentos(['--espera', '5']).esperaSeg).toBe(5);
    expect(() => Cli.parsearArgumentos(['--espera', '1'])).toThrow(/espera/i);
    expect(() => Cli.parsearArgumentos(['--espera', '0'])).toThrow(/espera/i);
  });

  it('la ayuda describe cada bandera y los límites', () => {
    const t = Cli.textoAyuda();
    for (const b of ['--fuente', '--distrito', '--tipo', '--paginas', '--salida', '--formato', '--espera', '--perfil', '--ayuda']) expect(t).toContain(b);
    expect(t).toMatch(/robots\.txt/);
  });
});

describe('Cli: transporte Apify', () => {
  it('el transporte es «directo» salvo que se pida «apify» de forma explícita', () => {
    expect(Cli.parsearArgumentos([]).transporte).toBe('directo');
    expect(Cli.parsearArgumentos(['--transporte', 'apify']).transporte).toBe('apify');
    expect(Cli.parsearArgumentos(['--transporte=directo']).transporte).toBe('directo');
    expect(() => Cli.parsearArgumentos(['--transporte', 'proxy'])).toThrow(/transporte/i);
  });

  it('--tope-usd: número positivo; por defecto 0.50', () => {
    expect(Cli.parsearArgumentos(['--tope-usd', '0.1']).topeUsd).toBe(0.1);
    expect(Cli.parsearArgumentos(['--tope-usd=2']).topeUsd).toBe(2);
    for (const malo of ['0', '-1', 'mucho', '']) expect(() => Cli.parsearArgumentos(['--tope-usd', malo])).toThrow(/tope/i);
  });

  it('--max-items: entero positivo con un máximo razonable', () => {
    expect(Cli.parsearArgumentos(['--max-items', '5']).maxItems).toBe(5);
    for (const malo of ['0', '2.5', 'x', '100000']) expect(() => Cli.parsearArgumentos(['--max-items', malo])).toThrow(/max-items/i);
  });

  it('--con-detalles es una bandera sin valor y no se confunde con la siguiente', () => {
    const a = Cli.parsearArgumentos(['--con-detalles', '--tipo', 'casa']);
    expect(a.conDetalles).toBe(true);
    expect(a.tipo).toBe('casa');
  });

  it('--actor cambia el actor de una fuente (admite varias separadas por coma)', () => {
    expect(Cli.parsearArgumentos(['--actor', 'urbania=otro/actor,marketplace=a/b']).actores).toEqual({ urbania: 'otro/actor', marketplace: 'a/b' });
    expect(() => Cli.parsearArgumentos(['--actor', 'nexo=a/b'])).toThrow(/actor/i);
    expect(() => Cli.parsearArgumentos(['--actor', 'urbania=malo'])).toThrow(/actor/i);
    expect(() => Cli.parsearArgumentos(['--actor', 'urbania'])).toThrow(/actor/i);
  });

  it('--url-marketplace se guarda tal cual', () => {
    expect(Cli.parsearArgumentos(['--url-marketplace', 'https://www.facebook.com/marketplace/x/propertyforsale']).urlMarketplace).toBe('https://www.facebook.com/marketplace/x/propertyforsale');
  });

  it('exigirToken: con apify y una fuente que lo usa, sin APIFY_TOKEN es un error de uso (antes de cualquier ejecución)', () => {
    const apify = Cli.parsearArgumentos(['--transporte', 'apify', '--fuente', 'urbania']);
    expect(() => Cli.exigirToken(apify, {})).toThrow(/APIFY_TOKEN/);
    expect(() => Cli.exigirToken(apify, { APIFY_TOKEN: ' ' })).toThrow(/APIFY_TOKEN/);
    expect(Cli.exigirToken(apify, { APIFY_TOKEN: 'abc' })).toBe('abc');
  });

  it('exigirToken: no hace falta token en transporte directo ni si solo se pide Nexo (no tiene variante Apify)', () => {
    expect(Cli.exigirToken(Cli.parsearArgumentos([]), {})).toBeNull();
    expect(Cli.exigirToken(Cli.parsearArgumentos(['--transporte', 'apify', '--fuente', 'nexo']), {})).toBeNull();
  });

  it('la ayuda explica que Apify cuesta dinero, el token y los topes', () => {
    const t = Cli.textoAyuda();
    for (const b of ['--transporte', '--tope-usd', '--max-items', '--con-detalles', '--actor', '--url-marketplace', 'APIFY_TOKEN']) expect(t).toContain(b);
    expect(t).toMatch(/cuesta dinero|de pago/);
  });
});

describe('Cli.resolverDistritoPedido', () => {
  it('acepta el distrito con tildes, minúsculas o alias y devuelve el nombre del GeoJSON', () => {
    expect(Cli.resolverDistritoPedido('cerro colorado', DISTRITOS)).toBe('CERRO COLORADO');
    expect(Cli.resolverDistritoPedido('José Luis Bustamante', DISTRITOS)).toBe('JOSE LUIS BUSTAMANTE Y RIVERO');
  });
  it('un distrito que no existe es un error que lista los válidos', () => {
    expect(() => Cli.resolverDistritoPedido('Narnia', DISTRITOS)).toThrow(/CAYMA/);
  });
  it('sin distrito pedido, null', () => {
    expect(Cli.resolverDistritoPedido(null, DISTRITOS)).toBeNull();
  });
});

const av = (fuente: string, id: string, extra: Aviso = {}): Aviso => ({ fuente, id_fuente: id, tipo_inmueble: 'departamento', distrito: 'CAYMA', ...extra });

describe('Recolector.filtrarAvisos', () => {
  const lista = [av('a', '1'), av('a', '2', { distrito: 'YANAHUARA' }), av('a', '3', { tipo_inmueble: 'casa' }), av('a', '4', { tipo_inmueble: null })];
  it('sin filtros deja todo', () => {
    expect(Rec.filtrarAvisos(lista, { distrito: null, tipo: 'todos' }).avisos).toHaveLength(4);
  });
  it('por distrito', () => {
    expect(Rec.filtrarAvisos(lista, { distrito: 'YANAHUARA', tipo: 'todos' }).avisos.map((x: Aviso) => x.id_fuente)).toEqual(['2']);
  });
  it('por tipo: los avisos sin tipo conocido se excluyen y se cuentan', () => {
    const r = Rec.filtrarAvisos(lista, { distrito: null, tipo: 'departamento' });
    expect(r.avisos.map((x: Aviso) => x.id_fuente)).toEqual(['1', '2']);
    expect(r.sinTipo).toBe(1);
  });
});

/** Fuente falsa: devuelve lo que se le diga. */
const fuenteFalsa = (nombre: string, resultado: Aviso | Error, requiereNavegador = false) => ({
  nombre,
  requiereNavegador,
  buscar: jest.fn(async () => {
    if (resultado instanceof Error) throw resultado;
    return resultado;
  }),
});

describe('Recolector.recolectar', () => {
  const base = { filtros: { distrito: null, tipo: 'todos' }, paginas: 2, cliente: {}, distritosConocidos: DISTRITOS, ahora: AHORA };

  it('junta las fuentes, deduplica por (fuente, id_fuente) y resume cada una', async () => {
    const registro = {
      a: fuenteFalsa('a', { estado: 'ok', mensaje: null, avisos: [av('a', '1'), av('a', '1'), av('a', '2')], paginas: 2 }),
      b: fuenteFalsa('b', { estado: 'ok', mensaje: null, avisos: [av('b', '1')], paginas: 1 }),
    };
    const r = await Rec.recolectar({ ...base, fuentes: ['a', 'b'], registro });
    expect(r.avisos.map((x: Aviso) => `${x.fuente}:${x.id_fuente}`)).toEqual(['a:1', 'a:2', 'b:1']);
    expect(r.duplicados).toBe(1);
    expect(r.resumen).toEqual([
      expect.objectContaining({ fuente: 'a', estado: 'ok', recolectados: 3, finales: 2, paginas: 2 }),
      expect.objectContaining({ fuente: 'b', estado: 'ok', recolectados: 1, finales: 1, paginas: 1 }),
    ]);
  });

  it('una fuente bloqueada no detiene a las demás y queda en el resumen con el motivo', async () => {
    const registro = {
      urbania: fuenteFalsa('urbania', { estado: 'bloqueado', mensaje: 'bloqueado por anti-bot: desafío (HTTP 403)', avisos: [], paginas: 0 }),
      nexo: fuenteFalsa('nexo', { estado: 'ok', mensaje: null, avisos: [av('nexo', '9')], paginas: 1 }),
    };
    const r = await Rec.recolectar({ ...base, fuentes: ['urbania', 'nexo'], registro });
    expect(r.avisos).toHaveLength(1);
    expect(r.resumen[0]).toMatchObject({ fuente: 'urbania', estado: 'bloqueado', recolectados: 0 });
    expect(r.resumen[0].mensaje).toMatch(/anti-bot/);
    expect(registro.nexo.buscar).toHaveBeenCalledTimes(1);
  });

  it('si una fuente lanza una excepción se registra como error y se sigue', async () => {
    const registro = { a: fuenteFalsa('a', new Error('explotó')), b: fuenteFalsa('b', { estado: 'ok', mensaje: null, avisos: [av('b', '1')], paginas: 1 }) };
    const r = await Rec.recolectar({ ...base, fuentes: ['a', 'b'], registro });
    expect(r.resumen[0]).toMatchObject({ fuente: 'a', estado: 'error' });
    expect(r.resumen[0].mensaje).toMatch(/explotó/);
    expect(r.avisos).toHaveLength(1);
  });

  it('aplica los filtros de distrito y tipo después de recolectar', async () => {
    const registro = { a: fuenteFalsa('a', { estado: 'ok', mensaje: null, avisos: [av('a', '1'), av('a', '2', { distrito: 'YANAHUARA' }), av('a', '3', { tipo_inmueble: 'casa' })], paginas: 1 }) };
    const r = await Rec.recolectar({ ...base, filtros: { distrito: 'CAYMA', tipo: 'departamento' }, fuentes: ['a'], registro });
    expect(r.avisos.map((x: Aviso) => x.id_fuente)).toEqual(['1']);
    expect(r.resumen[0]).toMatchObject({ recolectados: 3, finales: 1 });
  });

  describe('transporte', () => {
    const registroBase = () => ({
      nexo: fuenteFalsa('nexo', { estado: 'ok', mensaje: null, avisos: [av('nexo', '1')], paginas: 1 }),
      urbania: fuenteFalsa('urbania', { estado: 'bloqueado', mensaje: 'desafío anti-bot (HTTP 403)', avisos: [], paginas: 0 }),
    });
    const apifyOk = () => jest.fn(async (nombre: string) => ({ estado: 'ok', mensaje: 'ejecución de Apify: 1 ítem(s) recibidos', avisos: [av(nombre, '9', { via: 'apify' })], paginas: 0, via: 'apify' }));

    it('directo (por defecto): nunca llama a Apify, ni siquiera cuando la fuente está bloqueada; solo sugiere --transporte apify', async () => {
      const buscarApify = apifyOk();
      const registro = registroBase();
      const r = await Rec.recolectar({ ...base, fuentes: ['nexo', 'urbania'], registro, buscarApify });
      expect(buscarApify).not.toHaveBeenCalled();
      expect(r.resumen[1]).toMatchObject({ fuente: 'urbania', estado: 'bloqueado', via: 'directo' });
      expect(r.resumen[1].mensaje).toMatch(/--transporte apify/);
      expect(r.resumen[1].mensaje).toMatch(/de pago/);
      expect(r.resumen[0].mensaje).toBeNull(); // Nexo no tiene variante Apify: sin sugerencia
    });

    it('apify: las fuentes con variante Apify van por Apify y Nexo sigue directo; el resumen dice la vía', async () => {
      const buscarApify = apifyOk();
      const registro = registroBase();
      const apify = { cliente: {}, topeUsd: 0.5 };
      const r = await Rec.recolectar({ ...base, fuentes: ['nexo', 'urbania'], registro, transporte: 'apify', apify, buscarApify });
      expect(buscarApify).toHaveBeenCalledTimes(1);
      expect(buscarApify.mock.calls[0][0]).toBe('urbania');
      expect(buscarApify.mock.calls[0][2]).toMatchObject({ apify, paginas: 2 });
      expect(registro.urbania.buscar).not.toHaveBeenCalled();
      expect(registro.nexo.buscar).toHaveBeenCalledTimes(1);
      expect(r.resumen.map((x: Aviso) => [x.fuente, x.via])).toEqual([['nexo', 'directo'], ['urbania', 'apify']]);
      expect(r.avisos.map((x: Aviso) => x.fuente)).toEqual(['nexo', 'urbania']);
    });

    it('apify: una falla de Apify no detiene a las demás fuentes ni cae a la lectura directa', async () => {
      const buscarApify = jest.fn(async () => {
        throw new Error('explotó Apify');
      });
      const registro = registroBase();
      const r = await Rec.recolectar({ ...base, fuentes: ['urbania', 'nexo'], registro, transporte: 'apify', apify: {}, buscarApify });
      expect(r.resumen[0]).toMatchObject({ fuente: 'urbania', estado: 'error', via: 'apify' });
      expect(registro.urbania.buscar).not.toHaveBeenCalled();
      expect(r.avisos).toHaveLength(1);
    });
  });

  it('una fuente desconocida es un error de uso', async () => {
    await expect(Rec.recolectar({ ...base, fuentes: ['zonaprop'], registro: {} })).rejects.toThrow(/zonaprop/);
  });

  it('el registro real tiene las cuatro fuentes y solo Marketplace necesita navegador', () => {
    expect(Object.keys(Rec.FUENTES).sort()).toEqual(['adondevivir', 'marketplace', 'nexo', 'urbania']);
    expect(Object.values(Rec.FUENTES).filter((f: any) => f.requiereNavegador).map((f: any) => f.nombre)).toEqual(['marketplace']);
  });
});

describe('Salida.aCsv', () => {
  const aviso = (extra: Aviso = {}) =>
    E.crearAviso({ fuente: 'x', id_fuente: '1', url: 'https://x/1', titulo: 'Casa, "grande"\ncon patio', tipo_portal: 'Casas', precio: 100000, moneda: 'S/', area_total_m2: 100, distrito: 'Cayma', ...extra }, { ahora: AHORA, distritosConocidos: DISTRITOS });

  it('primera fila con las columnas del esquema; null queda vacío', () => {
    const [cab, fila] = Salida.aCsv([aviso()]).replace(/^﻿/, '').split('\n');
    expect(cab.split(',')).toEqual(E.COLUMNAS);
    expect(fila.startsWith('x,1,https://x/1,')).toBe(true);
  });

  it('entrecomilla comas, comillas y saltos de línea (RFC 4180) y empieza con BOM para Excel', () => {
    const csv = Salida.aCsv([aviso()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Casa, ""grande"" con patio"');
    expect(Salida.celda('a\nb')).toBe('"a\nb"');
  });

  it('un texto que empieza con = + - @ no se ejecuta como fórmula en una hoja de cálculo', () => {
    expect(Salida.aCsv([aviso({ titulo: '=HYPERLINK("http://malo")' })])).toContain('\'=HYPERLINK(""http://malo"")');
    expect(Salida.aCsv([aviso({ titulo: '+51 oferta' })])).toContain("'+51 oferta");
  });

  it('los números negativos (coordenadas) no se alteran', () => {
    expect(Salida.aCsv([aviso({ lat: -16.4, lon: -71.5 })])).toContain(',-16.4,-71.5,');
  });

  it('booleanos como true/false y la lista vacía solo trae el encabezado', () => {
    expect(Salida.aCsv([aviso({ es_proyecto: true })])).toContain(',true,');
    expect(Salida.aCsv([]).replace(/^﻿/, '').trim().split('\n')).toHaveLength(1);
  });
});

describe('Salida.aJson', () => {
  it('lleva metadatos (fecha, filtros, resumen por fuente, aviso de uso) y los avisos', () => {
    const texto = Salida.aJson({ avisos: [av('a', '1')], resumen: [{ fuente: 'a', estado: 'ok' }], filtros: { distrito: null, tipo: 'todos' }, ahora: AHORA });
    const obj = JSON.parse(texto);
    expect(obj.metadatos).toMatchObject({ generado: '2026-11-12T10:00:00.000Z', total: 1, filtros: { distrito: null, tipo: 'todos' }, fuentes: [{ fuente: 'a', estado: 'ok' }] });
    expect(obj.metadatos.aviso).toMatch(/terceros/);
    expect(obj.avisos).toHaveLength(1);
    expect(texto.endsWith('\n')).toBe(true);
  });
});

describe('Salida.rutaSalida', () => {
  const raiz = path.join(os.tmpdir(), 'raiz-proyecto');
  it('por defecto: datos-crudos/avisos/avisos-AAAA-MM-DD.<formato> dentro del proyecto', () => {
    expect(Salida.rutaSalida({ salida: null, formato: 'json', ahora: AHORA, raiz })).toBe(path.join(raiz, 'datos-crudos', 'avisos', 'avisos-2026-11-12.json'));
    expect(Salida.rutaSalida({ salida: null, formato: 'csv', ahora: AHORA, raiz })).toBe(path.join(raiz, 'datos-crudos', 'avisos', 'avisos-2026-11-12.csv'));
  });
  it('respeta --salida', () => {
    expect(Salida.rutaSalida({ salida: 'otra/ruta.json', formato: 'json', ahora: AHORA, raiz })).toBe(path.resolve('otra/ruta.json'));
  });
  it('se niega a escribir dentro de public/ (se publica en la web)', () => {
    expect(() => Salida.rutaSalida({ salida: path.join(raiz, 'public', 'data', 'avisos.json'), formato: 'json', ahora: AHORA, raiz })).toThrow(/public/);
    expect(() => Salida.rutaSalida({ salida: path.join(raiz, 'public', 'x.csv'), formato: 'csv', ahora: AHORA, raiz })).toThrow(/public/);
  });
});

describe('Salida.escribir', () => {
  it('crea las carpetas que falten y escribe el archivo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
    const ruta = path.join(dir, 'a', 'b', 'avisos.json');
    await Salida.escribir(ruta, '{"ok":true}\n');
    expect(fs.readFileSync(ruta, 'utf8')).toBe('{"ok":true}\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
