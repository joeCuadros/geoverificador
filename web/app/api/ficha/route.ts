import { fichaDePunto } from '@geoverificador/datos/ficha';
import { laBase } from '../../../lib/base.ts';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const lat = Number(u.get('lat'));
  const lon = Number(u.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: 'lat y lon son obligatorios' }, { status: 400 });
  try {
    return Response.json(await fichaDePunto(await laBase(), { lat, lon }), { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'error' }, { status: 422 });
  }
}
