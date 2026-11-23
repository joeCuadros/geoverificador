import { ejecutar } from '@geoverificador/agente/herramientas';
import { laBase, publicar } from '../../../lib/base.ts';
import { clienteDe, crearLimitador } from '../../../lib/limite.ts';
import { leerPunto } from '../../../lib/punto.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const permitido = crearLimitador(Number(process.env.VIAJE_LIMITE_HORA ?? 600), 3_600_000);

/**
 * GET /api/viaje?origenLat=&origenLon=&destinoLat=&destinoLon= — la mejor combi o bus entre dos puntos (directo o con un trasbordo), con su trazado para dibujarlo.
 * Es la misma herramienta `tiempo_de_viaje` del asistente; si no hay ruta en los datos, `trazado` es null y no se dibuja nada.
 */
export async function GET(req: Request) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de consultas de viaje por hora. Intenta más tarde.' }, { status: 429 });
  const params = new URL(req.url).searchParams;
  const origen = leerPunto(params, 'origenLat', 'origenLon');
  if (!origen.ok) return Response.json({ error: origen.error }, { status: 400 });
  const destino = leerPunto(params, 'destinoLat', 'destinoLon');
  if (!destino.ok) return Response.json({ error: destino.error }, { status: 400 });
  try {
    const r = await ejecutar('tiempo_de_viaje', { origen: origen.punto, destino: destino.punto, trazado: true }, { base: await laBase(), hoy: new Date().toISOString().slice(0, 10), publicar: publicar() });
    return Response.json(r);
  } catch (e) {
    console.error('Error al medir el viaje:', e);
    return Response.json({ error: 'No se pudo medir el viaje. Intenta de nuevo.' }, { status: 500 });
  }
}
