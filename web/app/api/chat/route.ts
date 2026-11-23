// La misma lógica de api/chat.js (Vercel), ahora servida por Next. No se duplica: se importa.
// @ts-ignore módulo CommonJS fuera de web/
import { manejarChat } from '../../../../api/_lib/gemini.js';

export const runtime = 'nodejs';
const ip = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida';

async function atender(req: Request) {
  let cuerpo: unknown = null;
  if (req.method === 'POST') cuerpo = await req.json().catch(() => null);
  const r = await manejarChat({ metodo: req.method, cuerpo, ip: ip(req) });
  return Response.json(r.cuerpo, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
}
export const GET = atender;
export const POST = atender;
