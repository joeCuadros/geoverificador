/**
 * Pruebas de la lectura de robots.txt (scripts/lib/avisos/robots.js) y del cliente HTTP cortés (scripts/lib/avisos/http.js):
 * reglas Allow/Disallow con comodines, robots.txt antes de cualquier otra solicitud, espera entre solicitudes al mismo sitio,
 * detección de bloqueos (403, 429, desafío anti-bot) sin reintentos y sin cabeceras que imiten un navegador. Sin red: se
 * inyectan un fetch falso y un reloj falso.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const R = require('../scripts/lib/avisos/robots.js');
const H = require('../scripts/lib/avisos/http.js');

// Fragmento real de https://www.adondevivir.com/robots.txt (consultado el 2026-11-12).
const ROBOTS_ADONDEVIVIR = `Sitemap: https://www.adondevivir.com/sitemaps_https.xml

User-agent: *
Disallow: /favoritos.bum
Disallow: /panel/
Disallow: /avisos-api/
Disallow: /*-map.html
Disallow: /*-ubicado-en-*
Allow: /propiedades/*-ubicado-en-*

Allow: /*pagina-2.html$
Allow: /*pagina-3.html$
Allow: /*pagina-4.html$
Allow: /*pagina-5.html$
Disallow: /*pagina-*.html
Allow: *pagina=2
Disallow: *pagina=*

Disallow: *?*utm_*
Disallow: *gclid=*
`;

// Fragmento real de https://urbania.pe/robots.txt (consultado el 2026-11-12).
const ROBOTS_URBANIA = `User-agent: Scrapy
Disallow: /

User-agent: wget
Disallow: /

User-agent: rogerbot
Crawl-delay: 10

User-agent: *
Allow: ?sort=low_price
Disallow: ?sort=*
Disallow: /users-api/
Allow: *page=2
Allow: *page=3
Allow: *page=4
Allow: *page=5
Disallow: *page=*
`;

const ROBOTS_NEXO = `User-Agent: *
Disallow:

Sitemap: https://nexoinmobiliario.pe/sitemap.xml
`;

const ROBOTS_NEGADO = `User-agent: *
Disallow: /
`;

const UA = 'GeoVerificador-avisos/1.0 (prueba)';
const permitido = (robots: string, ruta: string, ua = UA) => R.permitido(R.reglasPara(R.parsearRobots(robots), ua), ruta);

describe('Robots.permitido', () => {
  it('Nexo: «Disallow:» vacío no prohíbe nada', () => {
    expect(permitido(ROBOTS_NEXO, '/venta-de-inmuebles/arequipa')).toBe(true);
  });

  it('un «Disallow: /» para * lo prohíbe todo (como Facebook)', () => {
    expect(permitido(ROBOTS_NEGADO, '/marketplace/arequipa/propertyforsale')).toBe(false);
    expect(permitido(ROBOTS_NEGADO, '/')).toBe(false);
  });

  it('Adondevivir: la primera página y la lista por tipo están permitidas', () => {
    expect(permitido(ROBOTS_ADONDEVIVIR, '/departamentos-en-venta-en-arequipa.html')).toBe(true);
    expect(permitido(ROBOTS_ADONDEVIVIR, '/casas-en-venta-en-cayma.html')).toBe(true);
  });

  it('Adondevivir: las páginas 2 a 5 se permiten y la 6 no (gana la regla más larga)', () => {
    for (const n of [2, 3, 4, 5]) expect(permitido(ROBOTS_ADONDEVIVIR, `/departamentos-en-venta-en-arequipa-pagina-${n}.html`)).toBe(true);
    expect(permitido(ROBOTS_ADONDEVIVIR, '/departamentos-en-venta-en-arequipa-pagina-6.html')).toBe(false);
    expect(permitido(ROBOTS_ADONDEVIVIR, '/departamentos-en-venta-en-arequipa-pagina-12.html')).toBe(false);
  });

  it('Adondevivir: respeta rutas internas, mapas y parámetros de seguimiento', () => {
    expect(permitido(ROBOTS_ADONDEVIVIR, '/panel/mis-avisos')).toBe(false);
    expect(permitido(ROBOTS_ADONDEVIVIR, '/avisos-api/x')).toBe(false);
    expect(permitido(ROBOTS_ADONDEVIVIR, '/departamentos-en-venta-en-arequipa-map.html')).toBe(false);
    expect(permitido(ROBOTS_ADONDEVIVIR, '/departamentos-en-venta-en-arequipa.html?utm_source=x')).toBe(false);
  });

  it('Urbania: ?page=2 a 5 se permite y ?page=6 no; el comodín * del parámetro cuenta', () => {
    expect(permitido(ROBOTS_URBANIA, '/buscar/venta-de-departamentos-en-arequipa--arequipa')).toBe(true);
    expect(permitido(ROBOTS_URBANIA, '/buscar/venta-de-departamentos-en-arequipa--arequipa?page=2')).toBe(true);
    expect(permitido(ROBOTS_URBANIA, '/buscar/venta-de-departamentos-en-arequipa--arequipa?page=5')).toBe(true);
    expect(permitido(ROBOTS_URBANIA, '/buscar/venta-de-departamentos-en-arequipa--arequipa?page=6')).toBe(false);
  });

  it('Urbania: nuestro agente cae en el grupo * y no en los de bots con nombre', () => {
    expect(permitido(ROBOTS_URBANIA, '/buscar/x', 'GeoVerificador-avisos/1.0')).toBe(true);
    expect(permitido(ROBOTS_URBANIA, '/buscar/x', 'Scrapy/2.0')).toBe(false);
  });

  it('un grupo con el nombre de nuestro agente tiene prioridad sobre *', () => {
    const t = 'User-agent: *\nDisallow: /\n\nUser-agent: geoverificador-avisos\nAllow: /\n';
    expect(permitido(t, '/algo')).toBe(true);
  });

  it('el signo $ ancla el final y los comentarios y mayúsculas no importan', () => {
    const t = '# comentario\nUSER-AGENT: *\nDISALLOW: /*.pdf$ # no PDF\n';
    expect(permitido(t, '/a/b.pdf')).toBe(false);
    expect(permitido(t, '/a/b.pdf?x=1')).toBe(true);
    expect(permitido(t, '/a/b.html')).toBe(true);
  });

  it('en un empate entre Allow y Disallow gana Allow', () => {
    const t = 'User-agent: *\nDisallow: /a\nAllow: /a\n';
    expect(permitido(t, '/abc')).toBe(true);
  });

  it('sin reglas todo está permitido', () => {
    expect(permitido('', '/lo-que-sea')).toBe(true);
  });
});

describe('Robots.retardo', () => {
  it('lee Crawl-delay del grupo que corresponde', () => {
    const grupos = R.parsearRobots(ROBOTS_URBANIA);
    expect(R.reglasPara(grupos, 'rogerbot').retardo).toBe(10);
    expect(R.reglasPara(grupos, UA).retardo).toBeNull();
  });
});

describe('Http.detectarBloqueo', () => {
  const cab = (o: Record<string, string> = {}) => new Headers(o);

  it('403 y 429 son bloqueo', () => {
    expect(H.detectarBloqueo({ status: 403, headers: cab(), texto: '' })).toMatch(/403/);
    expect(H.detectarBloqueo({ status: 429, headers: cab(), texto: '' })).toMatch(/429/);
  });

  it('la cabecera cf-mitigated de Cloudflare es un desafío', () => {
    expect(H.detectarBloqueo({ status: 200, headers: cab({ 'cf-mitigated': 'challenge' }), texto: '<html></html>' })).toMatch(/anti-bot/i);
  });

  it('páginas de desafío conocidas, aunque respondan 200 o 503', () => {
    const desafio = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><form id="challenge-form"></form></body></html>';
    expect(H.detectarBloqueo({ status: 503, headers: cab(), texto: desafio })).toMatch(/anti-bot/i);
    expect(H.detectarBloqueo({ status: 200, headers: cab(), texto: desafio })).toMatch(/anti-bot/i);
    expect(H.detectarBloqueo({ status: 200, headers: cab(), texto: '<title>Attention Required! | Cloudflare</title>' })).toMatch(/anti-bot/i);
    expect(H.detectarBloqueo({ status: 200, headers: cab(), texto: '<title>Verifying you are human</title>' })).toMatch(/anti-bot/i);
  });

  it('una página normal que solo carga el script pasivo de Cloudflare NO es bloqueo', () => {
    const normal = '<html><head><title>160 Departamentos en venta</title></head><body><script>var s=document.createElement("script");s.src="/cdn-cgi/challenge-platform/scripts/jsd/main.js";</script> captcha en el formulario de contacto</body></html>';
    expect(H.detectarBloqueo({ status: 200, headers: cab(), texto: normal })).toBeNull();
  });

  it('200 normal, 404 y 500 no son bloqueo', () => {
    expect(H.detectarBloqueo({ status: 200, headers: cab(), texto: 'ok' })).toBeNull();
    expect(H.detectarBloqueo({ status: 404, headers: cab(), texto: 'no existe' })).toBeNull();
    expect(H.detectarBloqueo({ status: 500, headers: cab(), texto: 'error' })).toBeNull();
  });
});

/** Cliente con fetch y reloj falsos. `respuestas`: función (url) → { status, texto, headers? }. */
function montar(respuestas: (url: string) => { status: number; texto?: string; headers?: Record<string, string> }, opciones = {}) {
  const pedidos: { url: string; ua: string | undefined; cabeceras: string[]; t: number }[] = [];
  const reloj = { t: 1_000_000 };
  const esperas: number[] = [];
  const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
    pedidos.push({ url, ua: init.headers['User-Agent'], cabeceras: Object.keys(init.headers), t: reloj.t });
    const r = respuestas(url);
    return new Response(r.texto ?? '', { status: r.status, headers: r.headers ?? {} });
  };
  const cliente = H.crearCliente({
    userAgent: UA,
    esperaMs: 3000,
    fetchFn,
    ahora: () => reloj.t,
    dormir: async (ms: number) => {
      esperas.push(ms);
      reloj.t += ms;
    },
    ...opciones,
  });
  return { cliente, pedidos, esperas, reloj };
}

describe('Http.crearCliente', () => {
  const ok = (texto = '<html>ok</html>') => ({ status: 200, texto });

  it('pide robots.txt antes que la página y envía el User-Agent honesto, sin otras cabeceras de navegador', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : ok('<p>hola</p>')));
    const r = await cliente.obtener('https://nexoinmobiliario.pe/venta-de-inmuebles/arequipa');
    expect(r).toMatchObject({ estado: 'ok', status: 200, texto: '<p>hola</p>' });
    expect(pedidos.map((p) => p.url)).toEqual(['https://nexoinmobiliario.pe/robots.txt', 'https://nexoinmobiliario.pe/venta-de-inmuebles/arequipa']);
    expect(pedidos.every((p) => p.ua === UA)).toBe(true);
    expect(pedidos.flatMap((p) => p.cabeceras).sort()).toEqual(['Accept', 'Accept', 'User-Agent', 'User-Agent']);
  });

  it('lee robots.txt una sola vez por sitio', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : ok()));
    await cliente.obtener('https://nexoinmobiliario.pe/a');
    await cliente.obtener('https://nexoinmobiliario.pe/b');
    expect(pedidos.filter((p) => p.url.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('una ruta prohibida por robots.txt no se solicita y se informa', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_ADONDEVIVIR) : ok()));
    const r = await cliente.obtener('https://www.adondevivir.com/departamentos-en-venta-en-arequipa-pagina-6.html');
    expect(r.estado).toBe('robots');
    expect(r.motivo).toMatch(/robots\.txt/);
    expect(pedidos.map((p) => p.url)).toEqual(['https://www.adondevivir.com/robots.txt']);
  });

  it('permitido() solo consulta robots.txt, nunca la página', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEGADO) : ok()));
    const r = await cliente.permitido('https://www.facebook.com/marketplace/arequipa/propertyforsale');
    expect(r.estado).toBe('robots');
    expect(pedidos.map((p) => p.url)).toEqual(['https://www.facebook.com/robots.txt']);
  });

  it('espera al menos esperaMs entre solicitudes al mismo sitio, también entre robots.txt y la primera página', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : ok()));
    await cliente.obtener('https://nexoinmobiliario.pe/a');
    await cliente.obtener('https://nexoinmobiliario.pe/b');
    const t = pedidos.map((p) => p.t);
    expect(t[1] - t[0]).toBeGreaterThanOrEqual(3000);
    expect(t[2] - t[1]).toBeGreaterThanOrEqual(3000);
  });

  it('no espera entre sitios distintos', async () => {
    const { cliente, esperas } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : ok()));
    await cliente.permitido('https://uno.example/a');
    await cliente.permitido('https://dos.example/a');
    expect(esperas).toEqual([]);
  });

  it('usa el Crawl-delay del sitio si es mayor que la espera por defecto', async () => {
    const robots = 'User-agent: *\nCrawl-delay: 10\n';
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(robots) : ok()));
    await cliente.obtener('https://lento.example/a');
    expect(pedidos[1].t - pedidos[0].t).toBeGreaterThanOrEqual(10000);
  });

  it('un 403 de la página es «bloqueado»: no reintenta y no vuelve a pedir a ese sitio', async () => {
    const { cliente, pedidos } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : { status: 403, texto: 'denegado' }));
    const r1 = await cliente.obtener('https://urbania.pe/a');
    expect(r1.estado).toBe('bloqueado');
    expect(r1.motivo).toMatch(/403/);
    const antes = pedidos.length;
    const r2 = await cliente.obtener('https://urbania.pe/b');
    expect(r2.estado).toBe('bloqueado');
    expect(pedidos.length).toBe(antes);
    expect(pedidos.filter((p) => p.url === 'https://urbania.pe/a')).toHaveLength(1);
  });

  it('un 429 también detiene el sitio', async () => {
    const { cliente } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : { status: 429 }));
    expect((await cliente.obtener('https://x.example/a')).estado).toBe('bloqueado');
  });

  it('una página de desafío con 200 se detecta como bloqueo', async () => {
    const { cliente } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : ok('<title>Just a moment...</title>')));
    const r = await cliente.obtener('https://x.example/a');
    expect(r.estado).toBe('bloqueado');
    expect(r.motivo).toMatch(/anti-bot/i);
  });

  it('robots.txt con 403 es bloqueo; con 404 se entiende que no hay restricciones; con 500 no se continúa', async () => {
    const a = montar((u) => (u.endsWith('/robots.txt') ? { status: 403 } : ok()));
    expect((await a.cliente.obtener('https://x.example/a')).estado).toBe('bloqueado');
    const b = montar((u) => (u.endsWith('/robots.txt') ? { status: 404 } : ok('contenido')));
    expect(await b.cliente.obtener('https://x.example/a')).toMatchObject({ estado: 'ok', texto: 'contenido' });
    const c = montar((u) => (u.endsWith('/robots.txt') ? { status: 500 } : ok()));
    const rc = await c.cliente.obtener('https://x.example/a');
    expect(rc.estado).toBe('error');
    expect(c.pedidos.map((p) => p.url)).toEqual(['https://x.example/robots.txt']);
  });

  it('un 404 o un 500 de la página es error, no bloqueo, y el sitio sigue disponible', async () => {
    const { cliente } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : u.endsWith('/no') ? { status: 404 } : ok()));
    expect(await cliente.obtener('https://x.example/no')).toMatchObject({ estado: 'error', status: 404 });
    expect((await cliente.obtener('https://x.example/si')).estado).toBe('ok');
  });

  it('un error de red se informa como error sin lanzar', async () => {
    const cliente = H.crearCliente({
      userAgent: UA,
      esperaMs: 0,
      fetchFn: async () => {
        throw new Error('ECONNRESET');
      },
      dormir: async () => undefined,
    });
    const r = await cliente.obtener('https://x.example/a');
    expect(r.estado).toBe('error');
    expect(r.motivo).toMatch(/ECONNRESET/);
  });

  it('sigue redirecciones, comprobando robots.txt y la espera en cada salto', async () => {
    const { cliente, pedidos } = montar((u) => {
      if (u.endsWith('/robots.txt')) return ok(ROBOTS_NEXO);
      if (u === 'https://nexoinmobiliario.pe/busqueda/x') return { status: 301, headers: { location: 'https://nexoinmobiliario.pe/venta-de-inmuebles' } };
      return ok('destino');
    });
    const r = await cliente.obtener('https://nexoinmobiliario.pe/busqueda/x');
    expect(r).toMatchObject({ estado: 'ok', texto: 'destino', url: 'https://nexoinmobiliario.pe/venta-de-inmuebles' });
    expect(pedidos.map((p) => p.url)).toEqual(['https://nexoinmobiliario.pe/robots.txt', 'https://nexoinmobiliario.pe/busqueda/x', 'https://nexoinmobiliario.pe/venta-de-inmuebles']);
    expect(pedidos[2].t - pedidos[1].t).toBeGreaterThanOrEqual(3000);
  });

  it('una redirección hacia una ruta prohibida por robots.txt se detiene', async () => {
    const { cliente } = montar((u) => {
      if (u === 'https://x.example/robots.txt') return ok('User-agent: *\nDisallow: /privado\n');
      if (u === 'https://x.example/a') return { status: 302, headers: { location: '/privado/x' } };
      return ok();
    });
    expect((await cliente.obtener('https://x.example/a')).estado).toBe('robots');
  });

  it('no sigue más de 3 redirecciones', async () => {
    const { cliente } = montar((u) => (u.endsWith('/robots.txt') ? ok(ROBOTS_NEXO) : { status: 302, headers: { location: '/otra' } }));
    const r = await cliente.obtener('https://x.example/a');
    expect(r.estado).toBe('error');
    expect(r.motivo).toMatch(/redirecciones/);
  });
});
