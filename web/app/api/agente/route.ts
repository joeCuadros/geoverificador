import { ESTADO_INICIAL, responder, type EstadoConversacion } from '@geoverificador/agente/agente';
import { laBase, publicar } from '../../../lib/base.ts';

export const runtime = 'nodejs';
const MAX_MENSAJE = 600;

/** Límite sencillo por IP y por hora (por proceso). En producción lo respalda la tabla conversacion_uso. */
const usos = new Map<string, { desde: number; n: number }>();
const LIMITE_POR_HORA = Number(process.env.AGENTE_LIMITE_HORA ?? 30);
function permitido(ip: string): boolean {
  const ahora = Date.now();
  const u = usos.get(ip);
  if (!u || ahora - u.desde > 3_600_000) { usos.set(ip, { desde: ahora, n: 1 }); return true; }
  return ++u.n <= LIMITE_POR_HORA;
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!permitido(ip)) return Response.json({ error: 'Llegaste al límite de consultas por hora. Intenta más tarde.' }, { status: 429 });
  let cuerpo: { mensaje?: unknown; estado?: EstadoConversacion };
  try { cuerpo = await req.json(); } catch { return Response.json({ error: 'Cuerpo inválido.' }, { status: 400 }); }
  const mensaje = typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje.trim().slice(0, MAX_MENSAJE) : '';
  if (!mensaje) return Response.json({ error: 'Escribe tu consulta.' }, { status: 400 });
  const r = await responder(mensaje, cuerpo.estado ?? ESTADO_INICIAL, { base: await laBase(), hoy: new Date().toISOString().slice(0, 10), publicar: publicar() });
  return Response.json({ texto: r.texto, tipo: r.tipo, estado: r.estado, avisos: r.avisos });
}
