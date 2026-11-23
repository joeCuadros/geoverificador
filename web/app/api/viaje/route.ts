import { ejecutar } from '@geoverificador/agente/herramientas';
import { laBase, publicar } from '../../../lib/base.ts';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const cuerpo = await req.json();
    const ctx = { base: await laBase(), hoy: new Date().toISOString().slice(0, 10), publicar: publicar() };
    return Response.json(await ejecutar('tiempo_de_viaje', cuerpo, ctx));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'error' }, { status: 400 });
  }
}
