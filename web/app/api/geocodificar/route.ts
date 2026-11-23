import { ejecutar } from '@geoverificador/agente/herramientas';
import { laBase, publicar } from '../../../lib/base.ts';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 200);
  if (q.length < 2) return Response.json({ candidatos: [], nota: null });
  const ctx = { base: await laBase(), hoy: new Date().toISOString().slice(0, 10), publicar: publicar() };
  return Response.json(await ejecutar('geocodificar_lugar', { texto: q }, ctx));
}
