/**
 * Pruebas del cliente de Apify (scripts/lib/avisos/apify.js): flujo asíncrono (iniciar la ejecución, consultar hasta que termine,
 * leer el dataset paginado), tope de gasto, autenticación solo por cabecera, manejo de 401, 402 y 429, y que el token nunca
 * aparezca en URL ni en mensajes. NUNCA hacen una llamada real a Apify: se inyectan un fetch falso y una espera falsa.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Apify = require('../scripts/lib/avisos/apify.js');

const TOKEN = 'apify_api_TOKEN_DE_PRUEBA_123';
const ACTOR = 'scrapers_lat/urbania-scraper';
const BASE = 'https://api.apify.com';

type Llamada = { metodo: string; url: string; cabeceras: Record<string, string>; cuerpo: string | null };
type Resp = { status: number; json?: unknown };
const respuesta = (r: Resp) => new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
const run = (estado: string, extra = {}) => ({ status: 200, json: { data: { id: 'RUN1', status: estado, defaultDatasetId: 'DS1', ...extra } } });

/** Cliente con fetch/espera/reloj falsos. `guion`: función (llamada, n) → Resp (n = número de llamada, desde 0). */
function montar(guion: (l: Llamada, n: number) => Resp | Error, opciones: Record<string, unknown> = {}) {
  const llamadas: Llamada[] = [];
  const esperas: number[] = [];
  const reloj = { t: 0 };
  const fetchFn = async (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => {
    const l = { metodo: init.method || 'GET', url, cabeceras: init.headers, cuerpo: init.body ?? null };
    llamadas.push(l);
    const r = guion(l, llamadas.length - 1);
    if (r instanceof Error) throw r;
    return respuesta(r);
  };
  const cliente = Apify.crearClienteApify({
    token: TOKEN,
    fetchFn,
    dormir: async (ms: number) => {
      esperas.push(ms);
      reloj.t += ms;
    },
    ahora: () => reloj.t,
    ...opciones,
  });
  return { cliente, llamadas, esperas, reloj };
}

describe('Apify.leerToken', () => {
  it('lee APIFY_TOKEN del entorno y quita espacios', () => {
    expect(Apify.leerToken({ APIFY_TOKEN: `  ${TOKEN}\n` })).toBe(TOKEN);
  });
  it('sin token, o vacío, es null (la decisión de fallar es del llamador)', () => {
    expect(Apify.leerToken({})).toBeNull();
    expect(Apify.leerToken({ APIFY_TOKEN: '   ' })).toBeNull();
  });
});

describe('Apify.crearClienteApify', () => {
  it('sin token no se puede crear', () => {
    expect(() => Apify.crearClienteApify({ token: '' })).toThrow(/APIFY_TOKEN/);
  });
});

describe('Apify: iniciar una ejecución', () => {
  it('POST a /v2/actors/{usuario}~{actor}/runs con el tope de gasto, waitForFinish=60, el input como JSON y el token SOLO en la cabecera', async () => {
    const { cliente, llamadas } = montar(() => run('SUCCEEDED'));
    const r = await cliente.ejecutarActor(ACTOR, { startUrls: [{ url: 'https://urbania.pe/x' }], maxListings: 30 }, { topeUsd: 0.5 });
    expect(r).toEqual({ runId: 'RUN1', estado: 'SUCCEEDED', datasetId: 'DS1' });
    expect(llamadas).toHaveLength(1);
    const l = llamadas[0];
    expect(l.metodo).toBe('POST');
    expect(l.url).toBe(`${BASE}/v2/actors/scrapers_lat~urbania-scraper/runs?maxTotalChargeUsd=0.5&waitForFinish=60`);
    expect(l.cabeceras.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(l.cabeceras['Content-Type']).toBe('application/json');
    expect(JSON.parse(l.cuerpo as string)).toEqual({ startUrls: [{ url: 'https://urbania.pe/x' }], maxListings: 30 });
    expect(l.url).not.toContain(TOKEN);
    expect(l.cuerpo).not.toContain(TOKEN);
  });

  it('acepta el id del actor con «~» o con «/»', async () => {
    const { cliente, llamadas } = montar(() => run('SUCCEEDED'));
    await cliente.ejecutarActor('apify~facebook-marketplace-scraper', {}, { topeUsd: 1 });
    expect(llamadas[0].url).toContain('/v2/actors/apify~facebook-marketplace-scraper/runs?');
  });

  it('rechaza un id de actor mal formado y un tope no válido sin llamar a la red', async () => {
    const { cliente, llamadas } = montar(() => run('SUCCEEDED'));
    await expect(cliente.ejecutarActor('sin-usuario', {}, { topeUsd: 1 })).rejects.toThrow(/actor/i);
    await expect(cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0 })).rejects.toThrow(/tope/i);
    await expect(cliente.ejecutarActor(ACTOR, {}, {})).rejects.toThrow(/tope/i);
    expect(llamadas).toHaveLength(0);
  });
});

describe('Apify: esperar a que termine', () => {
  it('consulta GET /v2/actor-runs/{id}?waitForFinish=60 mientras siga en ejecución y devuelve el dataset al SUCCEEDED', async () => {
    const estados = ['RUNNING', 'RUNNING', 'SUCCEEDED'];
    const { cliente, llamadas } = montar((l, n) => (n === 0 ? run('READY') : run(estados[n - 1])));
    const r = await cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 });
    expect(r.estado).toBe('SUCCEEDED');
    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toEqual([
      expect.stringMatching(/^POST .*\/runs\?/),
      `GET ${BASE}/v2/actor-runs/RUN1?waitForFinish=60`,
      `GET ${BASE}/v2/actor-runs/RUN1?waitForFinish=60`,
      `GET ${BASE}/v2/actor-runs/RUN1?waitForFinish=60`,
    ]);
    expect(llamadas.slice(1).every((l) => l.cabeceras.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it.each([
    ['FAILED', /falló/],
    ['TIMED-OUT', /tiempo/],
    ['ABORTED', /abort/],
  ])('el estado %s es un error con mensaje claro en español', async (estado, patron) => {
    const { cliente } = montar((l, n) => (n === 0 ? run('RUNNING') : run(estado)));
    const err = await cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(patron);
    expect(err.message).toContain('RUN1');
    expect(err.message).not.toContain(TOKEN);
  });

  it('si se pasa del tiempo total, falla, intenta abortar la ejecución para no seguir gastando y lo dice', async () => {
    const { cliente, llamadas, reloj } = montar((l) => {
      if (l.metodo === 'POST' && l.url.endsWith('/abort')) return run('ABORTING');
      reloj.t += 60000; // cada consulta con waitForFinish=60 tarda 60 s
      return run('RUNNING');
    }, { timeoutMs: 150000 });
    const err = await cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 }).catch((e: Error) => e);
    expect(err.message).toMatch(/tiempo máximo/i);
    expect(llamadas[llamadas.length - 1]).toMatchObject({ metodo: 'POST', url: `${BASE}/v2/actor-runs/RUN1/abort` });
  });

  it('un fallo al abortar no tapa el error principal', async () => {
    const { cliente } = montar((l) => {
      if (l.url.endsWith('/abort')) return { status: 500 };
      return run('RUNNING');
    }, { timeoutMs: 0 });
    await expect(cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 })).rejects.toThrow(/tiempo máximo/i);
  });
});

describe('Apify: errores de la API', () => {
  it('401: token inválido, sin reintentos', async () => {
    const { cliente, llamadas } = montar(() => ({ status: 401, json: { error: { type: 'user-or-token-not-found' } } }));
    const err = await cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 }).catch((e: Error) => e);
    expect(err.message).toMatch(/token.*(inválido|no válido)/i);
    expect(err.message).not.toContain(TOKEN);
    expect(llamadas).toHaveLength(1);
  });

  it('402: sin crédito, sin reintentos', async () => {
    const { cliente, llamadas } = montar(() => ({ status: 402 }));
    await expect(cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 })).rejects.toThrow(/crédito/i);
    expect(llamadas).toHaveLength(1);
  });

  it('429: reintenta con espera creciente desde 500 ms y sigue si se recupera', async () => {
    const { cliente, esperas, llamadas } = montar((l, n) => (n < 3 ? { status: 429 } : run('SUCCEEDED')));
    const r = await cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 });
    expect(r.estado).toBe('SUCCEEDED');
    expect(esperas).toEqual([500, 1000, 2000]);
    expect(llamadas).toHaveLength(4);
  });

  it('429 persistente: se rinde tras pocos reintentos con un mensaje claro', async () => {
    const { cliente, llamadas } = montar(() => ({ status: 429 }));
    await expect(cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 })).rejects.toThrow(/límite de solicitudes/i);
    expect(llamadas).toHaveLength(4); // 1 intento + 3 reintentos
  });

  it('otros códigos (500, 404) se informan con el código HTTP', async () => {
    const a = montar(() => ({ status: 500 }));
    await expect(a.cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 })).rejects.toThrow(/HTTP 500/);
    const b = montar(() => ({ status: 404 }));
    await expect(b.cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 })).rejects.toThrow(/HTTP 404/);
  });

  it('el token nunca aparece en un mensaje de error, ni siquiera si lo trae el error de red', async () => {
    const { cliente } = montar(() => new Error(`fallo de red con ${TOKEN} dentro`));
    const err = await cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 }).catch((e: Error) => e);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toMatch(/red/);
  });

  it('una respuesta sin los datos esperados es un error claro', async () => {
    const { cliente } = montar(() => ({ status: 200, json: { cosa: 1 } }));
    await expect(cliente.ejecutarActor(ACTOR, {}, { topeUsd: 0.5 })).rejects.toThrow(/respuesta inesperada/i);
  });
});

describe('Apify: leer el dataset', () => {
  const items = (desde: number, n: number) => Array.from({ length: n }, (_, i) => ({ n: desde + i }));
  const delDataset = (todos: unknown[]) => (l: Llamada): Resp => {
    const u = new URL(l.url);
    const off = Number(u.searchParams.get('offset'));
    const lim = Number(u.searchParams.get('limit'));
    return { status: 200, json: todos.slice(off, off + lim) };
  };

  it('GET /v2/datasets/{id}/items con format=json, clean=1, limit y offset, paginando hasta que una página venga corta', async () => {
    const { cliente, llamadas } = montar(delDataset(items(0, 5)));
    const r = await cliente.leerDataset('DS1', { tamanoPagina: 2 });
    expect(r).toEqual(items(0, 5));
    expect(llamadas.map((l) => l.url)).toEqual([
      `${BASE}/v2/datasets/DS1/items?format=json&clean=1&limit=2&offset=0`,
      `${BASE}/v2/datasets/DS1/items?format=json&clean=1&limit=2&offset=2`,
      `${BASE}/v2/datasets/DS1/items?format=json&clean=1&limit=2&offset=4`,
    ]);
    expect(llamadas.every((l) => l.cabeceras.Authorization === `Bearer ${TOKEN}` && !l.url.includes(TOKEN))).toBe(true);
  });

  it('respeta un máximo de ítems: no pide de más', async () => {
    const { cliente, llamadas } = montar(delDataset(items(0, 100)));
    const r = await cliente.leerDataset('DS1', { tamanoPagina: 4, maxItems: 6 });
    expect(r).toHaveLength(6);
    expect(llamadas.map((l) => new URL(l.url).searchParams.get('limit'))).toEqual(['4', '2']);
  });

  it('un dataset vacío da lista vacía', async () => {
    const { cliente } = montar(delDataset([]));
    expect(await cliente.leerDataset('DS1')).toEqual([]);
  });

  it('si la respuesta no es una lista, error claro', async () => {
    const { cliente } = montar(() => ({ status: 200, json: { no: 'lista' } }));
    await expect(cliente.leerDataset('DS1')).rejects.toThrow(/respuesta inesperada/i);
  });
});

describe('Apify.ejecutar (ejecutar + leer)', () => {
  it('devuelve los ítems del dataset de la ejecución y limita la lectura a maxItems', async () => {
    const { cliente, llamadas } = montar((l) => (l.metodo === 'POST' ? run('SUCCEEDED') : { status: 200, json: [{ a: 1 }, { a: 2 }] }));
    const r = await cliente.ejecutar(ACTOR, {}, { topeUsd: 0.5, maxItems: 10 });
    expect(r).toEqual([{ a: 1 }, { a: 2 }]);
    expect(llamadas[1].url).toBe(`${BASE}/v2/datasets/DS1/items?format=json&clean=1&limit=10&offset=0`);
  });
});
