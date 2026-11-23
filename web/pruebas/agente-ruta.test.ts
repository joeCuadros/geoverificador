/**
 * POST /api/agente y GET /api/agente/estado: los datos estructurados que la interfaz dibuja, el ajuste y el punto del mapa, y el modelo de lenguaje solo con clave.
 * Se llaman las rutas directamente, contra la base de pruebas.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvisoRecolectado } from '@geoverificador/dominio/avisos';
import { ingerirCorrida } from '@geoverificador/datos/avisos';
import { laBase } from '../lib/base.ts';
import { POST as agentePOST } from '../app/api/agente/route.ts';
import { GET as estadoGET } from '../app/api/agente/estado/route.ts';

const AHORA = new Date();
const aviso = (extra: Partial<AvisoRecolectado> = {}): AvisoRecolectado => ({
  fuente: 'urbania', id_fuente: 'ar-1', url: 'https://portal.example/inmueble/ar-1', titulo: 'Departamento de prueba en Yanahuara', tipo_inmueble: 'departamento', tipo_portal: 'Departamento',
  es_proyecto: false, precio: 400000, precio_max: null, moneda: 'PEN', area_total_m2: 90, area_construida_m2: 90, dormitorios: 3, dormitorios_max: null, banos: 2, estacionamientos: 1,
  distrito: 'YANAHUARA', zona: 'Yanahuara', direccion: null, lat: -16.3905, lon: -71.5435, fecha_publicacion: '2026-11-01', fecha_captura: AHORA.toISOString(), ...extra,
});
let ip = 0;
const agente = (cuerpo: unknown) => agentePOST(new Request('http://localhost/api/agente', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ip}` }, body: JSON.stringify(cuerpo) }));
const estado = () => estadoGET(new Request('http://localhost/api/agente/estado', { headers: { 'x-forwarded-for': `10.8.0.${++ip}` } }));

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.BASE_DE_PRUEBA;
  const base = await laBase();
  await base.consulta('DELETE FROM aviso');
  await base.consulta('DELETE FROM corrida_avisos');
  await ingerirCorrida(base, [aviso(), aviso({ id_fuente: 'ar-2', url: 'https://portal.example/inmueble/ar-2', titulo: 'Departamento sin ubicación', lat: null, lon: null })], { ahora: AHORA, fuentes: ['urbania'], tipoCambio: null });
});
afterAll(async () => (await laBase()).cerrar());
beforeEach(() => {
  process.env.AVISOS_PUBLICAR = 'todas';
});
afterEach(() => {
  delete process.env.AVISOS_PUBLICAR;
  delete process.env.GEMINI_API_KEY;
  vi.unstubAllGlobals();
});

describe('POST /api/agente: datos para dibujar la conversación', () => {
  it('una búsqueda trae lo entendido, las tarjetas, las sugerencias y la cobertura, y sigue trayendo lo de siempre', async () => {
    const j = await (await agente({ mensaje: 'quiero un aprtamente en Yanahuara cerca de un colegio' })).json();
    expect(j).toMatchObject({ tipo: 'resultado', modo: 'reglas' });
    expect(j.texto).toContain('https://portal.example/inmueble/ar-1');
    expect(j.titular).toContain('Entendí «aprtamente» como «apartamento»');
    expect(j.entendido.map((c: any) => c.clave)).toEqual(['tipo', 'distrito', 'criterio:colegio']);
    expect(j.entendido[0]).toMatchObject({ valor: 'Departamento', corregido: true });
    expect(j.entendido[2].quitar).toEqual({ accion: 'quitar_criterio', id: 'colegio' });
    expect(j.resultados.tarjetas).toHaveLength(2);
    expect(j.resultados.tarjetas[0].criterios[0]).toMatchObject({ etiqueta: 'Colegio', estado: expect.stringMatching(/cumple|no_cumple|sin_dato/) });
    expect(j.resultados.limites.length).toBeGreaterThan(0);
    expect(j.sugerencias.length).toBeGreaterThan(0);
    expect(j.cobertura).toMatchObject({ vigentes: 2, publicacionActiva: true });
    expect(j.estado.ultimosAvisos).toHaveLength(2);
  });

  it('un ajuste tocado en la interfaz se aplica sobre el estado del turno anterior', async () => {
    const t1 = await (await agente({ mensaje: 'un departamento en Yanahuara cerca de un colegio' })).json();
    const t2 = await (await agente({ mensaje: 'Quitar colegio', estado: t1.estado, ajuste: { accion: 'quitar_criterio', id: 'colegio' } })).json();
    expect(t2.entendido.map((c: any) => c.clave)).toEqual(['tipo', 'distrito']);
    expect(t2.titular).toMatch(/Quité el criterio «Colegio»/);
  });

  it('el punto elegido en el mapa responde «¿qué hay en este punto?» con la ficha', async () => {
    const j = await (await agente({ mensaje: '¿qué hay en este punto?', punto: { lat: -16.39883, lon: -71.53697 } })).json();
    expect(j.tipo).toBe('info');
    expect(j.ficha.filas.find((f: any) => f.etiqueta === 'Salud')).toMatchObject({ fuente: expect.stringContaining('RENIPRESS') });
    const sin = await (await agente({ mensaje: '¿qué hay en este punto?', punto: { lat: 'x', lon: 1 } })).json();
    expect(sin.ficha).toBeNull();
  });

  it('un estado manipulado se ignora en vez de romper el turno', async () => {
    const r = await agente({ mensaje: 'hola', estado: { consulta: { criterios: 'no es una lista' }, pendiente: 7 } });
    expect(r.status).toBe(200);
    expect((await r.json()).tipo).toBe('info');
  });
});

describe('el modelo de lenguaje solo se usa con GEMINI_API_KEY', () => {
  const consulta = { mensaje: 'un departamento en Yanahuara' };

  it('sin clave no sale ninguna llamada al modelo', async () => {
    const llamada = vi.fn();
    vi.stubGlobal('fetch', llamada);
    const j = await (await agente(consulta)).json();
    expect(j.modo).toBe('reglas');
    expect(llamada).not.toHaveBeenCalled();
    expect((await (await estado()).json()).modelo).toBe(false);
  });

  it('con clave, el modelo escribe la frase de apertura y pasa la verificación; si falla, responde con reglas', async () => {
    process.env.GEMINI_API_KEY = 'clave-de-prueba';
    const llamada = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hay avisos de departamento en Yanahuara.' }] } }] }) }));
    vi.stubGlobal('fetch', llamada);
    const j = await (await agente(consulta)).json();
    expect(j.modo).toBe('modelo');
    expect(j.titular).toContain('Hay avisos de departamento en Yanahuara.');
    expect(j.texto).toContain('https://portal.example/inmueble/ar-1');
    const [url, init] = llamada.mock.calls[0] as unknown as [string, any];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).not.toContain('clave-de-prueba');
    expect(init.headers['x-goog-api-key']).toBe('clave-de-prueba');
    expect((await (await estado()).json()).modelo).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red'); }));
    const respaldo = await (await agente(consulta)).json();
    expect(respaldo.tipo).toBe('resultado');
    expect(respaldo.modo).toBe('reglas');
  });
});

describe('GET /api/agente/estado', () => {
  it('dice cuántos avisos hay, en qué distritos y de cuándo son', async () => {
    const r = await estado();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.cobertura).toMatchObject({ publicacionActiva: true, vigentes: 2, distritos: [{ nombre: 'YANAHUARA', total: 2 }] });
    expect(j.cobertura.ultimaVez).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('con la publicación apagada no cuenta ningún aviso', async () => {
    delete process.env.AVISOS_PUBLICAR;
    const j = await (await estado()).json();
    expect(j.cobertura).toMatchObject({ publicacionActiva: false, vigentes: 0, distritos: [] });
  });
});
