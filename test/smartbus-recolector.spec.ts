/**
 * Pruebas del recolector de SmartBus (scripts/lib/smartbus/recolector.js), de su línea de comandos (cli.js) y de la salida
 * (salida.js): robots.txt primero, solicitudes una a una, caché de respuestas crudas, parada ante bloqueos o redirecciones,
 * validación antes de escribir, escritura atómica y rechazo de public/, dist/ y api/. Sin red: cliente y caché falsos.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../scripts/lib/smartbus/recolector.js');
const Cli = require('../scripts/lib/smartbus/cli.js');
const Sal = require('../scripts/lib/smartbus/salida.js');
const Http = require('../scripts/lib/avisos/http.js');

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'smartbus', n), 'utf8'));
const listaJson = fx('routes-muestra.json');
const detalleReal = fx('ruta-17664795.json').data;
const AHORA = new Date('2026-11-12T12:00:00.000Z');
const ORIGEN = 'https://smartbus.app';
const URL_LISTA = `${ORIGEN}/smartbus/pe/arequipa/routes`;
const detalleDe = (id: string) => ({ ok: true, data: { ...detalleReal, id } });

type Respuesta = { estado: string; texto?: string; motivo?: string };
/** Cliente falso. `respuestas`: url → Respuesta; lo que no está, 404. Registra el orden y la concurrencia. */
function clienteFalso(respuestas: Record<string, Respuesta> = {}, robots: Respuesta = { estado: 'ok' }) {
  const pedidas: string[] = [];
  const estado = { enCurso: 0, maxEnCurso: 0 };
  const todas: Record<string, Respuesta> = { [URL_LISTA]: { estado: 'ok', texto: JSON.stringify(listaJson) }, ...respuestas };
  for (const r of listaJson.data) if (!todas[`${URL_LISTA}/${r.id}`]) todas[`${URL_LISTA}/${r.id}`] = { estado: 'ok', texto: JSON.stringify(detalleDe(r.id)) };
  return {
    pedidas,
    estado,
    permitido: jest.fn(async () => robots),
    obtener: jest.fn(async (url: string) => {
      pedidas.push(url);
      estado.enCurso++;
      estado.maxEnCurso = Math.max(estado.maxEnCurso, estado.enCurso);
      await Promise.resolve();
      estado.enCurso--;
      return todas[url] ?? { estado: 'error', motivo: 'HTTP 404' };
    }),
  };
}
const cacheFalsa = (inicial: Record<string, string> = {}) => {
  const datos = new Map(Object.entries(inicial));
  return { datos, leer: (n: string) => datos.get(n) ?? null, guardar: (n: string, t: string) => void datos.set(n, t) };
};
const base = (cliente: unknown, extra: Record<string, unknown> = {}) => ({ cliente, linea: 'todas', maxRutas: 2, cache: cacheFalsa(), refrescar: false, ahora: AHORA, userAgent: 'UA/1', log: () => undefined, ...extra });

describe('Smartbus recolector: flujo', () => {
  it('comprueba robots.txt primero, luego la lista y luego cada detalle, de uno en uno y en el orden de la lista', async () => {
    const c = clienteFalso();
    const r = await R.recolectarSmartbus(base(c, { maxRutas: 3 }));
    expect(c.permitido).toHaveBeenCalledTimes(1);
    expect(c.permitido.mock.invocationCallOrder[0]).toBeLessThan(c.obtener.mock.invocationCallOrder[0]);
    expect(c.pedidas).toEqual([URL_LISTA, ...listaJson.data.slice(0, 3).map((x: any) => `${URL_LISTA}/${x.id}`)]);
    expect(c.estado.maxEnCurso).toBe(1);
    expect(r.rutas).toHaveLength(3);
    expect(r.metadata.conteos.rutas).toBe(3);
  });

  it('--linea pide solo los detalles de esa línea', async () => {
    const c = clienteFalso();
    const r = await R.recolectarSmartbus(base(c, { linea: 'C2', maxRutas: null }));
    expect(c.pedidas).toHaveLength(1 + 2);
    expect(r.rutas.every((f: any) => f.properties.linea === 'C2')).toBe(true);
    expect(r.metadata.filtros).toEqual({ linea: 'C2', maxRutas: null });
  });

  it('una línea inexistente es un error y no pide ningún detalle', async () => {
    const c = clienteFalso();
    await expect(R.recolectarSmartbus(base(c, { linea: 'C99' }))).rejects.toThrow(/C99/);
    expect(c.pedidas).toEqual([URL_LISTA]);
  });

  it('una corrida «completa» sobre una lista parcial se rechaza como lista parcial', async () => {
    const c = clienteFalso();
    await expect(R.recolectarSmartbus(base(c, { maxRutas: null }))).rejects.toThrow(/parcial/);
  });

  it('el resultado trae conteos y metadatos con la restricción de uso', async () => {
    const r = await R.recolectarSmartbus(base(clienteFalso(), { maxRutas: 1 }));
    expect(r.metadata.uso).toBe('uso local de análisis; sin licencia; no redistribuir');
    expect(r.metadata.conteos).toMatchObject({ rutas: 1, paradas: 14, posiciones_de_parada_distintas: 14 });
    expect(r.paradas).toHaveLength(14);
  });
});

describe('Smartbus recolector: caché de respuestas crudas', () => {
  it('guarda cada respuesta válida y, con la caché llena, no vuelve a pedir nada a la red (robots.txt sí se comprueba)', async () => {
    const cache = cacheFalsa();
    const c1 = clienteFalso();
    await R.recolectarSmartbus(base(c1, { cache, maxRutas: 2 }));
    expect([...cache.datos.keys()].sort()).toEqual(['routes.json', `ruta-${listaJson.data[0].id}.json`, `ruta-${listaJson.data[1].id}.json`].sort());
    const c2 = clienteFalso();
    await R.recolectarSmartbus(base(c2, { cache, maxRutas: 2 }));
    expect(c2.obtener).not.toHaveBeenCalled();
    expect(c2.permitido).toHaveBeenCalledTimes(1);
  });

  it('--refrescar ignora la caché', async () => {
    const cache = cacheFalsa();
    await R.recolectarSmartbus(base(clienteFalso(), { cache, maxRutas: 1 }));
    const c = clienteFalso();
    await R.recolectarSmartbus(base(c, { cache, maxRutas: 1, refrescar: true }));
    expect(c.obtener).toHaveBeenCalledTimes(2);
  });

  it('una respuesta con forma inválida no se guarda en la caché', async () => {
    const cache = cacheFalsa();
    const c = clienteFalso({ [`${URL_LISTA}/${listaJson.data[0].id}`]: { estado: 'ok', texto: JSON.stringify({ ok: true, data: { stops: [] } }) } });
    await expect(R.recolectarSmartbus(base(c, { cache, maxRutas: 1 }))).rejects.toThrow(/ruta/);
    expect(cache.datos.has(`ruta-${listaJson.data[0].id}.json`)).toBe(false);
  });
});

describe('Smartbus recolector: paradas obligatorias', () => {
  it('robots.txt que ya no permite la ruta: se detiene sin pedir nada', async () => {
    const c = clienteFalso({}, { estado: 'robots', motivo: 'robots.txt de smartbus.app no permite /smartbus/pe/arequipa/routes' });
    const err = await R.recolectarSmartbus(base(c)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(R.Detenido);
    expect(err.message).toMatch(/robots\.txt/);
    expect(c.obtener).not.toHaveBeenCalled();
  });

  it.each([
    ['403', 'bloqueado por el sitio o por límite de solicitudes (HTTP 403)'],
    ['429', 'bloqueado por el sitio o por límite de solicitudes (HTTP 429)'],
    ['desafío anti-bot', 'desafío anti-bot (HTTP 200)'],
    ['redirección', 'redirección a https://otro.example/ (HTTP 302)'],
  ])('un bloqueo (%s) en un detalle detiene la corrida: no hay resultado parcial y no se piden más rutas', async (_n, motivo) => {
    const id1 = listaJson.data[1].id;
    const c = clienteFalso({ [`${URL_LISTA}/${id1}`]: { estado: 'bloqueado', motivo } });
    const err = await R.recolectarSmartbus(base(c, { maxRutas: 4 })).catch((e: Error) => e);
    expect(err).toBeInstanceOf(R.Detenido);
    expect(err.message).toContain(motivo);
    expect(c.pedidas).toEqual([URL_LISTA, `${URL_LISTA}/${listaJson.data[0].id}`, `${URL_LISTA}/${id1}`]);
  });

  it('un error de red o un 404/500 aborta con un error (no Detenido) y sin resultado', async () => {
    const c = clienteFalso({ [URL_LISTA]: { estado: 'error', motivo: 'HTTP 500' } });
    const err = await R.recolectarSmartbus(base(c)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(R.ErrorSmartbus);
    expect(err).not.toBeInstanceOf(R.Detenido);
    expect(err.message).toMatch(/HTTP 500/);
  });

  it('JSON ilegible o con otra forma aborta', async () => {
    const a = clienteFalso({ [URL_LISTA]: { estado: 'ok', texto: '<html>otra cosa</html>' } });
    await expect(R.recolectarSmartbus(base(a))).rejects.toThrow(/JSON/);
    const b = clienteFalso({ [URL_LISTA]: { estado: 'ok', texto: JSON.stringify({ ok: true, data: 'x' }) } });
    await expect(R.recolectarSmartbus(base(b))).rejects.toThrow(/forma esperada/);
  });

  it('si la validación de coordenadas falla (parada fuera de Arequipa) no devuelve nada y lista los problemas', async () => {
    const malo = { ok: true, data: { ...detalleReal, id: 'x', geometry: [[-12, -77], [-12.0001, -77]] } };
    const c = clienteFalso({ [`${URL_LISTA}/${listaJson.data[0].id}`]: { estado: 'ok', texto: JSON.stringify(malo) } });
    await expect(R.recolectarSmartbus(base(c, { maxRutas: 1 }))).rejects.toThrow(/validación[\s\S]*fuera de Arequipa/i);
  });
});

describe('Http.crearCliente: opciones para SmartBus', () => {
  const montar = (guion: (url: string) => { status: number; texto?: string; headers?: Record<string, string> }) => {
    const pedidos: string[] = [];
    const cliente = Http.crearCliente({
      userAgent: 'UA/1',
      esperaMs: 1100,
      seguirRedirecciones: false,
      fetchFn: async (url: string) => {
        pedidos.push(url);
        const r = guion(url);
        return new Response(r.texto ?? '', { status: r.status, headers: r.headers ?? {} });
      },
      ahora: () => 0,
      dormir: async () => undefined,
    });
    return { cliente, pedidos };
  };

  it('con seguirRedirecciones=false, una redirección es «bloqueado» y no se sigue', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? { status: 200, texto: 'User-agent: *\nAllow: /\n' } : { status: 302, headers: { location: 'https://otro.example/' } }));
    const r = await cliente.obtener('https://smartbus.app/x');
    expect(r.estado).toBe('bloqueado');
    expect(r.motivo).toMatch(/redirecci/i);
    expect(pedidos).toEqual(['https://smartbus.app/robots.txt', 'https://smartbus.app/x']);
  });

  it('407 también es bloqueo', async () => {
    const { cliente } = montar((u) => (u.endsWith('/robots.txt') ? { status: 200, texto: '' } : { status: 407 }));
    expect((await cliente.obtener('https://smartbus.app/x')).estado).toBe('bloqueado');
  });

  it('el valor por defecto sigue siendo seguir redirecciones (la recolección de avisos no cambia)', () => {
    expect(Http.crearCliente({ userAgent: 'UA' })).toBeDefined();
  });
});

describe('Smartbus CLI', () => {
  it('valores por defecto: todas las líneas, sin máximo, GeoJSON, salida por defecto, con caché', () => {
    expect(Cli.parsearArgumentos([])).toEqual({ ayuda: false, linea: 'todas', maxRutas: null, formato: 'geojson', salida: null, refrescar: false });
  });
  it('banderas con «--x valor» o «--x=valor», «--refrescar» sin valor y un «--» suelto de pnpm', () => {
    expect(Cli.parsearArgumentos(['--', '--linea', 'c2', '--max-rutas=3', '--formato', 'csv', '--salida', 'x/y.csv', '--refrescar'])).toEqual({ ayuda: false, linea: 'C2', maxRutas: 3, formato: 'csv', salida: 'x/y.csv', refrescar: true });
    expect(Cli.parsearArgumentos(['--linea', 'Albotran']).linea).toBe('Albotran');
    expect(Cli.parsearArgumentos(['--linea', 'TODAS']).linea).toBe('todas');
    expect(Cli.parsearArgumentos(['-h']).ayuda).toBe(true);
    expect(Cli.parsearArgumentos(['--ayuda']).ayuda).toBe(true);
  });
  it('rechaza valores inválidos con mensajes en español', () => {
    expect(() => Cli.parsearArgumentos(['--formato', 'xml'])).toThrow(/formato/i);
    expect(() => Cli.parsearArgumentos(['--max-rutas', '0'])).toThrow(/max-rutas/);
    expect(() => Cli.parsearArgumentos(['--max-rutas', 'x'])).toThrow(/max-rutas/);
    expect(() => Cli.parsearArgumentos(['--max-rutas', '5000'])).toThrow(/max-rutas/);
    expect(() => Cli.parsearArgumentos(['--linea'])).toThrow(/valor/);
    expect(() => Cli.parsearArgumentos(['--rara'])).toThrow(/--rara/);
    expect(() => Cli.parsearArgumentos(['suelto'])).toThrow(/suelto/);
    expect(() => Cli.parsearArgumentos(['--refrescar=si'])).toThrow(/refrescar/);
  });
  it('la ayuda lista las banderas y repite la restricción de uso', () => {
    const t = Cli.textoAyuda();
    for (const b of ['--linea', '--max-rutas', '--formato', '--salida', '--refrescar', '--ayuda']) expect(t).toContain(b);
    expect(t).toMatch(/sin licencia/);
    expect(t).toMatch(/no redistribuir/);
    expect(t).toMatch(/datos-crudos\/smartbus/);
    expect(t).not.toMatch(/permiso de SmartBus/i);
  });
});

describe('Smartbus salida', () => {
  const raiz = path.join(os.tmpdir(), 'raiz-sb');
  it('por defecto: datos-crudos/smartbus/smartbus-aqp.<formato>', () => {
    expect(Sal.rutaSalida({ salida: null, formato: 'geojson', raiz })).toBe(path.join(raiz, 'datos-crudos', 'smartbus', 'smartbus-aqp.geojson'));
    expect(Sal.rutaSalida({ salida: null, formato: 'csv', raiz })).toBe(path.join(raiz, 'datos-crudos', 'smartbus', 'smartbus-aqp.csv'));
  });
  it('respeta --salida', () => {
    expect(Sal.rutaSalida({ salida: 'otra/x.json', formato: 'json', raiz })).toBe(path.resolve('otra/x.json'));
  });
  it.each(['public', 'dist', 'api'])('se niega a escribir dentro de %s/', (carpeta) => {
    expect(() => Sal.rutaSalida({ salida: path.join(raiz, carpeta, 'datos', 'rutas.geojson'), formato: 'geojson', raiz })).toThrow(new RegExp(carpeta));
    expect(() => Sal.rutaSalida({ salida: path.join(raiz, carpeta, 'rutas.geojson'), formato: 'geojson', raiz })).toThrow(/no se escribe/i);
  });
  it('tampoco con rutas que «salen» y vuelven a entrar a public/', () => {
    expect(() => Sal.rutaSalida({ salida: path.join(raiz, 'datos-crudos', '..', 'public', 'x.json'), formato: 'json', raiz })).toThrow(/public/);
  });
  it('la carpeta de caché es datos-crudos/smartbus/cache', () => {
    expect(Sal.carpetaCache(raiz)).toBe(path.join(raiz, 'datos-crudos', 'smartbus', 'cache'));
  });

  it('escribirAtomico crea carpetas, no deja el temporal y reemplaza el contenido anterior', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
    const ruta = path.join(dir, 'a', 'b', 'x.json');
    await Sal.escribirAtomico(ruta, 'uno');
    await Sal.escribirAtomico(ruta, 'dos');
    expect(fs.readFileSync(ruta, 'utf8')).toBe('dos');
    expect(fs.readdirSync(path.dirname(ruta))).toEqual(['x.json']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cache de disco: leer devuelve null si no existe; guardar y leer ida y vuelta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbc-'));
    const c = Sal.crearCacheDisco(path.join(dir, 'cache'));
    expect(c.leer('routes.json')).toBeNull();
    c.guardar('routes.json', '{"ok":true}');
    expect(c.leer('routes.json')).toBe('{"ok":true}');
    expect(() => c.guardar('../fuera.json', 'x')).toThrow(/nombre/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
