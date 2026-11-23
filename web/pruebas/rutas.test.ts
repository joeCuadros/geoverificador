/**
 * Las rutas de la API se llaman directamente (sin servidor), contra la base de pruebas que arma packages/datos/pruebas/preparar-base.ts.
 * Se usa la misma conexión que abren las rutas (`laBase`): PGlite admite un solo proceso por carpeta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AvisoRecolectado } from '@geoverificador/dominio/avisos';
import { ingerirCorrida } from '@geoverificador/datos/avisos';
import { laBase, publicar } from '../lib/base.ts';
import { GET as fichaGET } from '../app/api/ficha/route.ts';
import { GET as buscarGET } from '../app/api/buscar/route.ts';
import { POST as agentePOST } from '../app/api/agente/route.ts';
import { GET as capasGET } from '../app/api/capas/route.ts';
import { GET as viajeGET } from '../app/api/viaje/route.ts';
import { GET as capaGET } from '../app/api/capas/[id]/route.ts';

const AHORA = new Date();
const aviso = (extra: Partial<AvisoRecolectado> = {}): AvisoRecolectado => ({
  fuente: 'urbania', id_fuente: 'rutas-1', url: 'https://portal.example/inmueble/rutas-1', titulo: 'Departamento de prueba en Yanahuara', tipo_inmueble: 'departamento', tipo_portal: 'Departamento',
  es_proyecto: false, precio: 400000, precio_max: null, moneda: 'PEN', area_total_m2: 90, area_construida_m2: 90, dormitorios: 3, dormitorios_max: null, banos: 2, estacionamientos: 1,
  distrito: 'YANAHUARA', zona: 'Yanahuara', direccion: null, lat: -16.3905, lon: -71.5435, fecha_publicacion: '2026-11-01', fecha_captura: AHORA.toISOString(), ...extra,
});

const pedir = (ruta: string, consulta = '') => new Request(`http://localhost${ruta}${consulta}`);
const agente = (cuerpo: unknown, ip = '10.0.0.1') =>
  agentePOST(new Request('http://localhost/api/agente', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }));

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.BASE_DE_PRUEBA;
  const base = await laBase();
  await base.consulta('DELETE FROM aviso');
  await base.consulta('DELETE FROM corrida_avisos');
  await ingerirCorrida(base, [aviso(), aviso({ id_fuente: 'rutas-2', url: 'https://portal.example/inmueble/rutas-2', lat: null, lon: null, titulo: 'Departamento sin ubicación' })], { ahora: AHORA, fuentes: ['urbania'], tipoCambio: null });
});
afterAll(async () => {
  const base = await laBase();
  await base.consulta('DELETE FROM aviso');
  await base.consulta('DELETE FROM corrida_avisos');
  await base.cerrar();
});
beforeEach(() => {
  delete process.env.AVISOS_PUBLICAR;
});

describe('GET /api/ficha', () => {
  it('devuelve la ficha del punto por grupos, con la fuente de cada elemento', async () => {
    const r = await fichaGET(pedir('/api/ficha', '?lat=-16.39883&lon=-71.53697'));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.punto).toEqual({ lat: -16.39883, lon: -71.53697 });
    expect(j.distrito).toBe('Arequipa');
    expect(j.grupos.map((g: any) => g.id)).toEqual(['construir', 'cerca', 'moverse', 'servicios', 'riesgos']);
    expect(j.esencial.length).toBeGreaterThanOrEqual(3);
    for (const g of j.grupos) for (const s of g.subgrupos) for (const i of s.items) expect(i.fuente.texto, i.id).toBeTruthy();
    expect(j.aviso).toMatch(/no es una recomendaci[oó]n de compra/i);
  });
  it.each([
    ['sin parámetros', ''],
    ['sin longitud', '?lat=-16.4'],
    ['con texto', '?lat=abc&lon=-71.5'],
  ])('responde 400 y dice qué falta (%s)', async (_n, consulta) => {
    const r = await fichaGET(pedir('/api/ficha', consulta));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/lat y lon/i);
  });
  it('responde 400 para un punto fuera de Arequipa', async () => {
    const r = await fichaGET(pedir('/api/ficha', '?lat=-12.0464&lon=-77.0428'));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/fuera de Arequipa/i);
  });
});

describe('GET /api/buscar', () => {
  it('encuentra un lugar conocido en los datos locales y dice de dónde sale', async () => {
    const r = await buscarGET(pedir('/api/buscar', '?q=Plaza%20de%20Armas'));
    expect(r.status).toBe(200);
    const { resultados } = await r.json();
    expect(resultados.length).toBeGreaterThan(0);
    expect(resultados[0]).toMatchObject({ nombre: 'Plaza de Armas' });
    expect(Math.abs(resultados[0].lat - -16.39883)).toBeLessThan(0.01);
    expect(resultados[0].origen).toBeTruthy();
    expect(resultados[0].precisionM).toBeGreaterThan(0);
  });
  it('no inventa resultados: un texto sin coincidencias da una lista vacía', async () => {
    const r = await buscarGET(pedir('/api/buscar', '?q=zzzxqwv'));
    expect(r.status).toBe(200);
    expect((await r.json()).resultados).toEqual([]);
  });
  it.each([['sin q', ''], ['vacío', '?q='], ['una letra', '?q=a'], ['solo espacios', '?q=%20%20%20']])('responde 400 si el texto es muy corto (%s)', async (_n, consulta) => {
    const r = await buscarGET(pedir('/api/buscar', consulta));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/al menos 2/i);
  });
  it('responde 400 si el texto es demasiado largo', async () => {
    const r = await buscarGET(pedir('/api/buscar', `?q=${'a'.repeat(200)}`));
    expect(r.status).toBe(400);
  });
});

describe('POST /api/agente', () => {
  it('ADR 0002: sin activar la publicación no devuelve ningún aviso', async () => {
    expect(publicar()).toBe('ninguna');
    const r = await agente({ mensaje: 'un departamento en Yanahuara hasta 450 mil soles' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.avisos).toEqual([]);
    expect(j.tipo).toBe('vacio');
  });
  it('con AVISOS_PUBLICAR=todas devuelve los avisos con coordenadas, enlace y datos para el mapa', async () => {
    process.env.AVISOS_PUBLICAR = 'todas';
    const r = await agente({ mensaje: 'un departamento en Yanahuara hasta 450 mil soles' });
    const j = await r.json();
    expect(j.tipo).toBe('resultado');
    const conUbicacion = j.avisos.find((a: any) => a.url === 'https://portal.example/inmueble/rutas-1');
    expect(conUbicacion).toMatchObject({ lat: -16.3905, lon: -71.5435, titulo: 'Departamento de prueba en Yanahuara', precio: 400000, moneda: 'PEN', distrito: 'YANAHUARA' });
    const sinUbicacion = j.avisos.find((a: any) => a.url.endsWith('rutas-2'));
    expect(sinUbicacion.lat).toBeNull();
    expect(j.texto).toContain('https://portal.example/inmueble/rutas-1');
  });
  it('recorta el mensaje a 600 caracteres: lo que queda después del límite no se interpreta', async () => {
    process.env.AVISOS_PUBLICAR = 'todas';
    const cola = ' un departamento en Yanahuara hasta 450 mil soles';
    const completo = await (await agente({ mensaje: cola.trim() })).json();
    expect(completo.tipo).toBe('resultado');
    const recortado = await (await agente({ mensaje: `${'x'.repeat(600)}${cola}` })).json();
    expect(recortado.tipo).toBe('info');
    expect(recortado.avisos).toEqual([]);
  });
  it('no devuelve fotos, descripción ni datos del vendedor (ADR 0002): solo los campos del inmueble', async () => {
    process.env.AVISOS_PUBLICAR = 'todas';
    const j = await (await agente({ mensaje: 'un departamento en Yanahuara hasta 450 mil soles' })).json();
    const permitidos = ['id', 'titulo', 'url', 'lat', 'lon', 'cumplidos', 'pedidos', 'precio', 'moneda', 'distrito'];
    expect(j.avisos.length).toBeGreaterThan(0);
    for (const a of j.avisos) expect(Object.keys(a).sort()).toEqual([...permitidos].sort());
  });
  it('responde 400 si el mensaje falta, está vacío o el cuerpo no es JSON', async () => {
    for (const cuerpo of [{}, { mensaje: '   ' }, { mensaje: 42 }, 'esto no es json']) {
      const r = await agente(cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect((await r.json()).error).toBeTruthy();
    }
  });
});

describe('GET /api/capas', () => {
  const ventana = '?bbox=-71.56,-16.42,-71.51,-16.38';
  const pedirCapa = (id: string, consulta: string) => capaGET(pedir(`/api/capas/${id}`, consulta), { params: Promise.resolve({ id }) });

  it('lista las capas con su leyenda, su fuente y la fecha de sus datos', async () => {
    const r = await capasGET(pedir('/api/capas'));
    expect(r.status).toBe(200);
    const { capas } = await r.json();
    expect(capas.map((c: any) => c.id)).toEqual(expect.arrayContaining(['colegios', 'salud', 'zonificacion', 'volcan', 'quebradas', 'sismos', 'rutas']));
    for (const c of capas) {
      expect(c.fuente.nombre).toBeTruthy();
      expect(c.leyenda.length).toBeGreaterThan(0);
      expect(c.nota).toBeTruthy();
    }
  });
  it('sirve los elementos de una capa en la ventana', async () => {
    const r = await pedirCapa('colegios', `${ventana}&zoom=15`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.capa).toBe('colegios');
    expect(j.features.length).toBeGreaterThan(0);
    expect(j.features[0].properties.titulo).toBeTruthy();
  });
  it('lejos de lo que la capa admite, pide acercar el mapa', async () => {
    const j = await (await pedirCapa('geologicos', `${ventana}&zoom=8`)).json();
    expect(j).toMatchObject({ requiereZoom: 11, features: [] });
  });
  it('responde 404 para una capa que no existe y 400 para una ventana o un zoom no válidos', async () => {
    expect((await pedirCapa('no-existe', `${ventana}&zoom=15`)).status).toBe(404);
    for (const consulta of ['', '?bbox=1,2,3&zoom=15', `${ventana}&zoom=abc`, `${ventana}&zoom=99`, '?bbox=-75,-20,-70,-15&zoom=15']) {
      const r = await pedirCapa('colegios', consulta);
      expect(r.status, consulta).toBe(400);
      expect((await r.json()).error).toBeTruthy();
    }
  });
});

describe('GET /api/viaje y el mapa de la respuesta del agente', () => {
  const viaje = (consulta: string) => viajeGET(pedir('/api/viaje', consulta));
  const ORIGEN = 'origenLat=-16.3905&origenLon=-71.5435';

  it('devuelve el trazado de la mejor opción hacia un destino con ruta', async () => {
    const r = await viaje(`?${ORIGEN}&destinoLat=-16.4179&destinoLon=-71.5497`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.hayRuta).toBe(true);
    expect(j.trazado.tramos.length).toBe(j.mejor.trasbordos + 1);
    expect(j.trazado.tramos[0].segmento.length).toBeGreaterThan(1);
    expect(j.trazado.tramos.map((t: any) => t.linea)).toEqual(j.mejor.lineas);
  });
  it('sin ruta en los datos dice que no hay y no inventa un trazado', async () => {
    const j = await (await viaje(`?${ORIGEN}&destinoLat=-16.2&destinoLon=-71.3`)).json();
    expect(j.hayRuta).toBe(false);
    expect(j.trazado).toBeNull();
  });
  it('responde 400 si falta o no es válido un extremo, y si cae fuera de Arequipa', async () => {
    for (const [consulta, texto] of [
      ['', /origenLat y origenLon/],
      [`?${ORIGEN}`, /destinoLat y destinoLon/],
      [`?${ORIGEN}&destinoLat=abc&destinoLon=-71.5`, /destinoLat y destinoLon/],
      [`?${ORIGEN}&destinoLat=-12.04&destinoLon=-77.04`, /fuera de Arequipa/],
    ] as const) {
      const r = await viaje(consulta);
      expect(r.status, consulta).toBe(400);
      expect((await r.json()).error).toMatch(texto);
    }
  });
  it('la respuesta del agente trae el trabajo que ubicó y pide el viaje cuando midió el tiempo al trabajo', async () => {
    process.env.AVISOS_PUBLICAR = 'todas';
    const j = await (await agente({ mensaje: 'un departamento en Yanahuara cerca de mi trabajo en el Parque Industrial hasta 450 mil soles' })).json();
    expect(j.tipo).toBe('resultado');
    expect(j.mapa.lugares).toEqual([expect.objectContaining({ rol: 'trabajo', nombre: 'Parque Industrial' })]);
    expect(j.mapa.pideViaje).toBe(true);
    expect(j.mapa.sectores).toEqual([]);
  });
  it('sin lugares que dibujar, mapa viene vacío', async () => {
    process.env.AVISOS_PUBLICAR = 'todas';
    const j = await (await agente({ mensaje: 'un departamento en Yanahuara hasta 450 mil soles' })).json();
    expect(j.mapa).toEqual({ lugares: [], sectores: [], pideViaje: false });
  });
});
