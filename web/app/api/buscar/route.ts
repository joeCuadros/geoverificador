import { geocodificarLocal } from '@geoverificador/datos/geocodificar';
import { laBase } from '../../../lib/base.ts';
import { clienteDe, crearLimitador } from '../../../lib/limite.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN = 2;
const MAX = 100;
const permitido = crearLimitador(Number(process.env.BUSCAR_LIMITE_HORA ?? 300), 3_600_000);

/**
 * GET /api/buscar?q=… — ubica un lugar por su nombre con los datos locales (destinos conocidos, colegios, malls, salud, distritos…), sin consultar servicios
 * externos. Cada resultado dice de dónde sale y con qué precisión: un distrito, por ejemplo, es solo una referencia dentro del distrito.
 */
export async function GET(req: Request) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de búsquedas por hora. Intenta más tarde.' }, { status: 429 });
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < MIN) return Response.json({ error: `Escribe al menos ${MIN} letras del lugar que buscas.` }, { status: 400 });
  if (q.length > MAX) return Response.json({ error: `Escribe menos de ${MAX} caracteres.` }, { status: 400 });
  try {
    const hallados = await geocodificarLocal(await laBase(), q, { limite: 6 });
    return Response.json({ resultados: hallados.map(({ nombre, lat, lon, precisionM, origen, categoria, distrito }) => ({ nombre, lat, lon, precisionM, origen, categoria, distrito })) });
  } catch (e) {
    console.error('Error al buscar el lugar:', e);
    return Response.json({ error: 'No se pudo buscar el lugar. Intenta de nuevo.' }, { status: 500 });
  }
}
