import { ErrorDeCapa } from '@geoverificador/datos/capas';
import { laBase } from '../../../../lib/base.ts';
import { CAPAS_MAPA, capaParaMapa, leerCajaYZoom } from '../../../../lib/capas.ts';
import { clienteDe, crearLimitador } from '../../../../lib/limite.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const permitido = crearLimitador(Number(process.env.CAPAS_LIMITE_HORA ?? 3000), 3_600_000);

/**
 * GET /api/capas/<id>?bbox=oeste,sur,este,norte&zoom=Z — los elementos de una capa dentro de la ventana del mapa, simplificados según el zoom.
 * `recortada: true` dice que había más elementos que el máximo de la capa; `requiereZoom` que la ventana está demasiado lejos para pedirla.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de consultas de capas por hora. Intenta más tarde.' }, { status: 429 });
  const { id } = await params;
  if (!CAPAS_MAPA.some((c) => c.id === id)) return Response.json({ error: `La capa «${id.slice(0, 40)}» no existe.` }, { status: 404 });
  const lectura = leerCajaYZoom(new URL(req.url).searchParams);
  if (!lectura.ok) return Response.json({ error: lectura.error }, { status: 400 });
  try {
    return Response.json(await capaParaMapa(await laBase(), id, lectura.caja, lectura.zoom));
  } catch (e) {
    if (e instanceof ErrorDeCapa) return Response.json({ error: e.message }, { status: 400 });
    console.error('Error al servir la capa:', e);
    return Response.json({ error: 'No se pudo cargar la capa. Intenta de nuevo.' }, { status: 500 });
  }
}
