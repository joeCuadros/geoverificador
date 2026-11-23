import { capaRecortada, validarCaja, ErrorDeCapa } from '@geoverificador/datos/capas';
import { laBase } from '../../../../lib/base.ts';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ capa: string }> }) {
  const { capa } = await params;
  const u = new URL(req.url).searchParams;
  try {
    const caja = validarCaja((u.get('bbox') ?? '').split(',').map(Number));
    return Response.json(await capaRecortada(await laBase(), capa, caja, Number(u.get('zoom') ?? 12)), { headers: { 'Cache-Control': 'public, max-age=600' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'error' }, { status: e instanceof ErrorDeCapa ? 404 : 400 });
  }
}
