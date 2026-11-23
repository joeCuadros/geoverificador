// Inicio de sesión con Google: la lógica sigue en api/_lib/auth.js; aquí solo se adapta la solicitud.
// @ts-ignore módulo CommonJS fuera de web/
import { manejarAuth } from '../../../../../api/_lib/auth.js';

export const runtime = 'nodejs';
const ACCIONES = new Set(['google', 'callback', 'logout', 'me']);

async function atender(req: Request, { params }: { params: Promise<{ accion: string }> }) {
  const { accion } = await params;
  if (!ACCIONES.has(accion)) return new Response('No encontrado', { status: 404 });
  const consulta = Object.create(null);
  for (const [k, v] of new URL(req.url).searchParams) if (!(k in consulta)) consulta[k] = v;
  const cabeceras: Record<string, string> = {};
  req.headers.forEach((v, k) => (cabeceras[k.toLowerCase()] = v));
  const r = await manejarAuth({ accion, metodo: req.method, consulta, cabeceras }, {});
  const h = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  for (const c of r.cookies ?? []) h.append('Set-Cookie', c);
  if (r.ubicacion) { h.set('Location', r.ubicacion); return new Response(null, { status: r.status, headers: h }); }
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(r.cuerpo), { status: r.status, headers: h });
}
export const GET = atender;
export const POST = atender;
