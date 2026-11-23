import { expect, test } from '@playwright/test';

const PUNTOS = [
  { nombre: 'Plaza de Armas', lat: -16.39883, lon: -71.53697 },
  { nombre: 'Cerro Colorado (tierra agrícola)', lat: -16.3715, lon: -71.578 },
  { nombre: 'Yura', lat: -16.2447, lon: -71.6727 },
  { nombre: 'Parque Industrial', lat: -16.4179, lon: -71.5497 },
];

test.describe('GET /api/ficha', () => {
  for (const p of PUNTOS) {
    test(`devuelve una ficha completa para ${p.nombre}`, async ({ request }) => {
      const r = await request.get(`/api/ficha?lat=${p.lat}&lon=${p.lon}`);
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toContain('application/json');
      const j = await r.json();
      expect(j.punto).toEqual({ lat: p.lat, lon: p.lon });
      expect(j.aviso).toMatch(/No es una recomendación de compra/);
      expect(j.grupos.map((g: any) => g.id)).toEqual(['construir', 'cerca', 'moverse', 'servicios', 'riesgos']);
      const items = j.grupos.flatMap((g: any) => g.subgrupos.flatMap((s: any) => s.items));
      expect(items.length).toBeGreaterThanOrEqual(12);
      for (const i of items) {
        expect(i.fuente.texto, i.id).toBeTruthy();
        expect(['cumple', 'no_cumple', 'informativo', 'sin_dato', null]).toContain(i.estado);
      }
      expect(j.esencial.length).toBeGreaterThanOrEqual(3);
      expect(j.pasos.length).toBeGreaterThanOrEqual(3);
      expect(j.limitaciones.length).toBeGreaterThan(j.limitacionesClave.length);
      expect(JSON.stringify(j.limitacionesClave)).toMatch(/no significa que el lugar sea seguro/);
    });
  }

  test('la Plaza de Armas está en la zona ZRE-CH del distrito de Arequipa y trae su fuente con fecha', async ({ request }) => {
    const j = await (await request.get('/api/ficha?lat=-16.39883&lon=-71.53697')).json();
    expect(j.distrito).toBe('Arequipa');
    const items = j.grupos.flatMap((g: any) => g.subgrupos.flatMap((s: any) => s.items));
    expect(items.find((i: any) => i.id === 'zona').nombre).toBe('ZRE-CH');
    const salud = items.find((i: any) => i.id === 'salud');
    expect(salud.fuente.texto).toMatch(/RENIPRESS/);
    expect(salud.fuente.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const volcan = items.find((i: any) => i.id === 'peligro-volcanico');
    expect(volcan.fuente.texto).toMatch(/IGP/);
    expect(volcan.fuente.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('acepta la coma decimal', async ({ request }) => {
    const r = await request.get('/api/ficha?lat=-16,39883&lon=-71,53697');
    expect(r.status()).toBe(200);
    expect((await r.json()).punto).toEqual({ lat: -16.39883, lon: -71.53697 });
  });

  for (const [nombre, consulta] of [
    ['sin parámetros', ''],
    ['sin longitud', '?lat=-16.4'],
    ['sin latitud', '?lon=-71.5'],
    ['con texto en lugar de números', '?lat=abc&lon=def'],
    ['con valores vacíos', '?lat=&lon='],
    ['con una latitud imposible', '?lat=120&lon=-71.5'],
    ['con un valor repetido', '?lat=-16.4&lat=-16.5&lon=-71.5'],
    ['con notación científica', '?lat=1e1&lon=-71.5'],
  ] as const) {
    test(`responde 400 ${nombre}`, async ({ request }) => {
      const r = await request.get(`/api/ficha${consulta}`);
      expect(r.status()).toBe(400);
      expect((await r.json()).error).toMatch(/lat y lon/);
    });
  }

  test('responde 400 con el motivo para un punto fuera de Arequipa (Lima)', async ({ request }) => {
    const r = await request.get('/api/ficha?lat=-12.0464&lon=-77.0428');
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/fuera de Arequipa/);
  });

  test('solo acepta GET', async ({ request }) => {
    expect((await request.post('/api/ficha?lat=-16.4&lon=-71.5')).status()).toBe(405);
  });
});

test.describe('GET /api/buscar', () => {
  test('encuentra la Plaza de Armas con su origen y su precisión', async ({ request }) => {
    const r = await request.get('/api/buscar?q=Plaza%20de%20Armas');
    expect(r.status()).toBe(200);
    const { resultados } = await r.json();
    expect(resultados[0]).toMatchObject({ nombre: 'Plaza de Armas', origen: 'destino' });
    expect(resultados[0].precisionM).toBeGreaterThan(0);
    expect(Math.abs(resultados[0].lat + 16.39883)).toBeLessThan(0.01);
  });

  test('ubica un distrito como una referencia de baja precisión', async ({ request }) => {
    const { resultados } = await (await request.get('/api/buscar?q=Cayma')).json();
    const distrito = resultados.find((x: any) => x.origen === 'distrito');
    expect(distrito).toBeTruthy();
    expect(distrito.precisionM).toBeGreaterThan(500);
  });

  test('un texto sin coincidencias da una lista vacía, no un error', async ({ request }) => {
    const r = await request.get('/api/buscar?q=zzzxqwv');
    expect(r.status()).toBe(200);
    expect((await r.json()).resultados).toEqual([]);
  });

  for (const [nombre, consulta] of [
    ['sin q', ''],
    ['con q vacío', '?q='],
    ['con una sola letra', '?q=a'],
    ['con solo espacios', '?q=%20%20%20'],
    ['con un texto de más de 100 caracteres', `?q=${'a'.repeat(101)}`],
  ] as const) {
    test(`responde 400 ${nombre}`, async ({ request }) => {
      const r = await request.get(`/api/buscar${consulta}`);
      expect(r.status()).toBe(400);
      expect((await r.json()).error).toBeTruthy();
    });
  }
});

test.describe('POST /api/agente', () => {
  const enviar = (request: any, data: unknown) => request.post('/api/agente', { data });

  test('un saludo devuelve el texto de ayuda y ningún aviso', async ({ request }) => {
    const r = await enviar(request, { mensaje: 'hola' });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ tipo: 'info', avisos: [] });
    expect(j.texto).toMatch(/Puedo buscar avisos/);
  });

  test('una búsqueda devuelve los avisos de prueba con ubicación, enlace, precio y criterios', async ({ request }) => {
    const j = await (await enviar(request, { mensaje: 'un departamento en Yanahuara cerca de un colegio hasta 450 mil soles' })).json();
    expect(j.tipo).toBe('resultado');
    expect(j.avisos).toHaveLength(3);
    const uno = j.avisos.find((a: any) => a.url.endsWith('e2e-yanahuara-1'));
    expect(uno).toMatchObject({ lat: -16.3905, lon: -71.5435, precio: 400000, moneda: 'PEN', distrito: 'YANAHUARA', pedidos: 1, cumplidos: 1 });
    expect(j.avisos.find((a: any) => a.url.endsWith('e2e-yanahuara-3')).lat).toBeNull();
    for (const a of j.avisos) expect(j.texto).toContain(a.url);
  });

  test('guarda el estado de la conversación y lo devuelve para el turno siguiente', async ({ request }) => {
    const primero = await (await enviar(request, { mensaje: 'Quiero un departamento cerca de mi trabajo y que no cueste más de medio millón' })).json();
    expect(primero.tipo).toBe('pregunta');
    expect(primero.estado.pendiente).toBe('trabajo');
    const segundo = await (await enviar(request, { mensaje: 'Parque Industrial', estado: primero.estado })).json();
    expect(segundo.texto).not.toMatch(/¿Dónde queda tu trabajo\?/);
  });

  for (const [nombre, data] of [
    ['sin mensaje', {}],
    ['con un mensaje vacío', { mensaje: '' }],
    ['con solo espacios', { mensaje: '    ' }],
    ['con un mensaje que no es texto', { mensaje: 42 }],
  ] as const) {
    test(`responde 400 ${nombre}`, async ({ request }) => {
      const r = await enviar(request, data);
      expect(r.status()).toBe(400);
      expect((await r.json()).error).toBe('Escribe tu consulta.');
    });
  }

  test('responde 400 si el cuerpo no es JSON', async ({ request }) => {
    const r = await request.post('/api/agente', { headers: { 'content-type': 'application/json' }, data: Buffer.from('esto no es json') });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBe('Cuerpo inválido.');
  });

  test('responde 400 si el cuerpo es null', async ({ request }) => {
    const r = await request.post('/api/agente', { headers: { 'content-type': 'application/json' }, data: Buffer.from('null') });
    expect(r.status()).toBe(400);
  });

  test('recorta un mensaje muy largo en vez de fallar', async ({ request }) => {
    const r = await enviar(request, { mensaje: `hola ${'x'.repeat(5000)}` });
    expect(r.status()).toBe(200);
  });

  test('solo acepta POST', async ({ request }) => {
    expect((await request.get('/api/agente')).status()).toBe(405);
  });
});

test('una ruta que no existe responde 404', async ({ request }) => {
  expect((await request.get('/api/no-existe')).status()).toBe(404);
});

test.describe('GET /api/capas', () => {
  const VENTANA = 'bbox=-71.56,-16.42,-71.51,-16.38';

  test('lista las capas con su fuente, la fecha de sus datos, su leyenda y lo que no dicen', async ({ request }) => {
    const r = await request.get('/api/capas');
    expect(r.status()).toBe(200);
    const { capas } = await r.json();
    expect(capas).toHaveLength(21);
    for (const c of capas) {
      expect(c.fuente.nombre, c.id).toBeTruthy();
      expect(c.nota, c.id).toBeTruthy();
      expect(c.leyenda.length, c.id).toBeGreaterThan(0);
      expect(c.zoomMin).toBeGreaterThanOrEqual(0);
      if (c.id !== 'zonificacion') expect(c.fuente.fecha, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(capas.find((c: any) => c.id === 'zonificacion').fuente.fecha).toBeNull();
  });

  test('sirve una capa por ventana con título y detalle de cada elemento', async ({ request }) => {
    const j = await (await request.get(`/api/capas/salud?${VENTANA}&zoom=14`)).json();
    expect(j.recortada).toBe(false);
    expect(j.features.length).toBeGreaterThan(0);
    for (const f of j.features) expect(f.properties.titulo).toBeTruthy();
  });

  test('pide acercar el mapa cuando la ventana está demasiado lejos para la capa', async ({ request }) => {
    expect(await (await request.get(`/api/capas/geologicos?${VENTANA}&zoom=9`)).json()).toMatchObject({ requiereZoom: 11, features: [] });
  });

  for (const [nombre, ruta, estado] of [
    ['404 para una capa que no existe', `/api/capas/no-existe?${VENTANA}&zoom=14`, 404],
    ['400 sin ventana', '/api/capas/salud?zoom=14', 400],
    ['400 sin zoom', `/api/capas/salud?${VENTANA}`, 400],
    ['400 con una ventana invertida', '/api/capas/salud?bbox=-71.5,-16.38,-71.56,-16.42&zoom=14', 400],
    ['400 con una ventana enorme', '/api/capas/salud?bbox=-75,-20,-70,-15&zoom=14', 400],
    ['400 con un zoom fuera de rango', `/api/capas/salud?${VENTANA}&zoom=40`, 400],
  ] as const) {
    test(`responde ${nombre}`, async ({ request }) => {
      const r = await request.get(ruta);
      expect(r.status()).toBe(estado);
      expect((await r.json()).error).toBeTruthy();
    });
  }
});

test.describe('GET /api/viaje', () => {
  const ORIGEN = 'origenLat=-16.3905&origenLon=-71.5435';

  test('devuelve la mejor opción con su trazado', async ({ request }) => {
    const j = await (await request.get(`/api/viaje?${ORIGEN}&destinoLat=-16.4179&destinoLon=-71.5497`)).json();
    expect(j.hayRuta).toBe(true);
    expect(j.trazado.tramos.length).toBe(j.mejor.trasbordos + 1);
    expect(j.trazado.tramos.map((t: any) => t.linea)).toEqual(j.mejor.lineas);
  });

  test('sin ruta en los datos no inventa un trazado', async ({ request }) => {
    const j = await (await request.get(`/api/viaje?${ORIGEN}&destinoLat=-16.2&destinoLon=-71.3`)).json();
    expect(j).toMatchObject({ hayRuta: false, mejor: null, trazado: null });
  });

  for (const [nombre, consulta] of [
    ['sin parámetros', ''],
    ['sin destino', `?${ORIGEN}`],
    ['con un destino fuera de Arequipa', `?${ORIGEN}&destinoLat=-12.04&destinoLon=-77.04`],
    ['con texto en lugar de números', '?origenLat=a&origenLon=b&destinoLat=c&destinoLon=d'],
  ] as const) {
    test(`responde 400 ${nombre}`, async ({ request }) => {
      const r = await request.get(`/api/viaje${consulta}`);
      expect(r.status()).toBe(400);
      expect((await r.json()).error).toBeTruthy();
    });
  }
});

test('POST /api/agente: la respuesta trae el trabajo que ubicó y pide el viaje; sin trabajo, el mapa viene vacío', async ({ request }) => {
  const con = await (await request.post('/api/agente', { data: { mensaje: 'un departamento en Yanahuara cerca de mi trabajo en el Parque Industrial hasta 450 mil soles' } })).json();
  expect(con.mapa.lugares).toEqual([expect.objectContaining({ rol: 'trabajo', nombre: 'Parque Industrial' })]);
  expect(con.mapa.pideViaje).toBe(true);
  const sin = await (await request.post('/api/agente', { data: { mensaje: 'un departamento en Yanahuara hasta 450 mil soles' } })).json();
  expect(sin.mapa).toEqual({ lugares: [], sectores: [], pideViaje: false });
});
