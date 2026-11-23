import { laBase } from '../../../lib/base.ts';
import { clienteDe, crearLimitador } from '../../../lib/limite.ts';
import { leerPunto } from '../../../lib/punto.ts';
import { reporteDePunto } from '../../../lib/reporte.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const permitido = crearLimitador(Number(process.env.FICHA_LIMITE_HORA ?? 120), 3_600_000);

/** GET /api/ficha?lat=…&lon=… — la ficha de un punto de Arequipa: cada dato con su fuente y su fecha. */
export async function GET(req: Request) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de fichas por hora. Intenta más tarde.' }, { status: 429 });
  const lectura = leerPunto(new URL(req.url).searchParams);
  if (!lectura.ok) return Response.json({ error: lectura.error }, { status: 400 });
  try {
    return Response.json(await reporteDePunto(await laBase(), lectura.punto));
  } catch (e) {
    console.error('Error al armar la ficha:', e);
    return Response.json({ error: 'No se pudo armar la ficha de este punto. Intenta de nuevo.' }, { status: 500 });
  }
}
