import { laBase } from '../../../lib/base.ts';
import { catalogoDeCapas } from '../../../lib/capas.ts';
import { clienteDe, crearLimitador } from '../../../lib/limite.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const permitido = crearLimitador(Number(process.env.CAPAS_LIMITE_HORA ?? 3000), 3_600_000);

/** GET /api/capas — las capas del mapa con su leyenda, su fuente, la fecha de sus datos y lo que no dicen. */
export async function GET(req: Request) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de consultas de capas por hora. Intenta más tarde.' }, { status: 429 });
  try {
    return Response.json({ capas: await catalogoDeCapas(await laBase()) });
  } catch (e) {
    console.error('Error al leer el catálogo de capas:', e);
    return Response.json({ error: 'No se pudo leer la lista de capas. Intenta de nuevo.' }, { status: 500 });
  }
}
