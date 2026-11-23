/** Un error interno se responde con un mensaje claro: sin el texto del error, sin rutas de archivos y sin pila. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/base.ts', () => ({ laBase: async () => ({}), publicar: () => 'ninguna' }));
vi.mock('../lib/reporte.ts', () => ({ reporteDePunto: async () => { throw new Error('boom secreto en D:/ruta/interna/archivo.ts'); } }));
vi.mock('@geoverificador/agente/agente', () => ({ ESTADO_INICIAL: { consulta: null, pendiente: null }, responder: async () => { throw new Error('boom secreto en D:/ruta/interna/agente.ts'); } }));
vi.mock('@geoverificador/datos/geocodificar', () => ({ geocodificarLocal: async () => { throw new Error('boom secreto en D:/ruta/interna/geo.ts'); } }));

const { GET: fichaGET } = await import('../app/api/ficha/route.ts');
const { GET: buscarGET } = await import('../app/api/buscar/route.ts');
const { POST: agentePOST } = await import('../app/api/agente/route.ts');

async function sinFiltraciones(r: Response, mensaje: RegExp) {
  expect(r.status).toBe(500);
  const texto = await r.text();
  expect(JSON.parse(texto).error).toMatch(mensaje);
  expect(texto).not.toMatch(/boom|secreto|ruta\/interna|\.ts|\bat\s+\S+\s*\(|stack/i);
}

describe('errores internos', () => {
  it('la ficha responde 500 con un mensaje claro', async () => {
    await sinFiltraciones(await fichaGET(new Request('http://localhost/api/ficha?lat=-16.4&lon=-71.5')), /No se pudo armar la ficha/);
  });
  it('la búsqueda de lugares responde 500 con un mensaje claro', async () => {
    await sinFiltraciones(await buscarGET(new Request('http://localhost/api/buscar?q=cayma')), /No se pudo buscar el lugar/);
  });
  it('el agente responde 500 con un mensaje claro', async () => {
    await sinFiltraciones(
      await agentePOST(new Request('http://localhost/api/agente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mensaje: 'hola' }) })),
      /No pude procesar tu consulta/,
    );
  });
});
