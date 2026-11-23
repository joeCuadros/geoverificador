import { ESTADO_INICIAL, responder } from '@geoverificador/agente/agente';
import { proveedorDesdeEntorno } from '@geoverificador/agente/gemini';
import { laBase, publicar } from '../../../lib/base.ts';
import { clienteDe, crearLimitador } from '../../../lib/limite.ts';
import { mapaDeRespuesta } from '../../../lib/mapa-respuesta.ts';

export const runtime = 'nodejs';
const MAX_MENSAJE = 600;

/** Límite sencillo por IP y por hora (por proceso). En producción lo respalda la tabla conversacion_uso. */
const permitido = crearLimitador(Number(process.env.AGENTE_LIMITE_HORA ?? 30), 3_600_000);

/** El punto elegido en el mapa, si viene bien formado; cualquier otra cosa se ignora. */
function leerPunto(v: unknown): { lat: number; lon: number; etiqueta: string | null } | null {
  const p = v as { lat?: unknown; lon?: unknown; etiqueta?: unknown } | null;
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  return { lat: p.lat, lon: p.lon, etiqueta: typeof p.etiqueta === 'string' ? p.etiqueta.slice(0, 120) : null };
}

/**
 * POST /api/agente — un turno de la conversación.
 *
 * Entrada: `mensaje` (obligatorio, hasta 600 caracteres), `estado` (el que devolvió el turno anterior), `ajuste` (opcional: un cambio tocado en la interfaz, por ejemplo
 * quitar un criterio) y `punto` (opcional: el punto elegido en el mapa, para «¿qué hay en este punto?»).
 *
 * Salida: lo de siempre (`texto`, `tipo`, `estado`, `avisos`, `mapa`) más datos estructurados para dibujar la conversación sin leer texto: `titular`, `entendido`
 * (lo que se entendió, con cómo quitar o cambiar cada dato), `correcciones`, `sugerencias` (respuestas rápidas), `resultados` (tarjetas), `ficha`, `comparacion`,
 * `cobertura` y `modo` («reglas» o «modelo»: el modelo de lenguaje solo se usa si el servidor tiene GEMINI_API_KEY).
 */
export async function POST(req: Request) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de consultas por hora. Intenta más tarde.' }, { status: 429 });
  let cuerpo: { mensaje?: unknown; estado?: unknown; ajuste?: unknown; punto?: unknown } | null;
  try { cuerpo = await req.json(); } catch { return Response.json({ error: 'Cuerpo inválido.' }, { status: 400 }); }
  const mensaje = typeof cuerpo?.mensaje === 'string' ? cuerpo.mensaje.trim().slice(0, MAX_MENSAJE) : '';
  if (!mensaje) return Response.json({ error: 'Escribe tu consulta.' }, { status: 400 });
  try {
    const r = await responder(mensaje, cuerpo?.estado ?? ESTADO_INICIAL, { base: await laBase(), hoy: new Date().toISOString().slice(0, 10), publicar: publicar() }, proveedorDesdeEntorno(process.env), { ajuste: cuerpo?.ajuste, punto: leerPunto(cuerpo?.punto) });
    // Además de lo que ya devolvía, el precio y el distrito (el cuadro de cada marcador) y `mapa`: los lugares y sectores que la respuesta ubicó, para dibujarlos.
    return Response.json({
      texto: r.texto,
      titular: r.titular,
      tipo: r.tipo,
      estado: r.estado,
      avisos: r.avisos.map((a) => ({ id: a.id, titulo: a.titulo, url: a.url, lat: a.lat, lon: a.lon, cumplidos: a.cumplidos, pedidos: a.pedidos, precio: a.precio, moneda: a.moneda, distrito: a.distrito })),
      mapa: mapaDeRespuesta(r.herramientas, r.consulta),
      modo: r.modo,
      entendido: r.entendido,
      correcciones: r.correcciones,
      sugerencias: r.sugerencias,
      resultados: r.resultados,
      ficha: r.ficha,
      comparacion: r.comparacion,
      cobertura: r.cobertura,
    });
  } catch (e) {
    console.error('Error en el agente:', e);
    return Response.json({ error: 'No pude procesar tu consulta. Intenta de nuevo.' }, { status: 500 });
  }
}
