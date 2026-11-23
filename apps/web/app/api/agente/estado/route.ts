import { textoDeCobertura } from '@geoverificador/agente/agente';
import { ejecutar } from '@geoverificador/agente/herramientas';
import { ejemplos } from '@geoverificador/agente/presentacion';
import { proveedorDesdeEntorno } from '@geoverificador/agente/gemini';
import { laBase, publicar } from '../../../../lib/base.ts';
import { clienteDe, crearLimitador } from '../../../../lib/limite.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const permitido = crearLimitador(Number(process.env.AGENTE_ESTADO_LIMITE_HORA ?? 240), 3_600_000);

/**
 * GET /api/agente/estado — lo que el asistente cubre hoy: cuántos avisos vigentes hay, en qué distritos y de cuándo son (los que dejó el recolector de avisos),
 * y si hay un modelo de lenguaje activo. La interfaz lo muestra al abrir el chat. Respeta la regla de publicación (ADR 0002): con la publicación apagada no cuenta nada.
 */
export async function GET(req: Request) {
  if (!permitido(clienteDe(req))) return Response.json({ error: 'Llegaste al límite de consultas por hora. Intenta más tarde.' }, { status: 429 });
  try {
    const cobertura = await ejecutar('cobertura_avisos', {}, { base: await laBase(), hoy: new Date().toISOString().slice(0, 10), publicar: publicar() });
    return Response.json({ cobertura, resumen: textoDeCobertura(cobertura), ejemplos: ejemplos(cobertura, false), modelo: proveedorDesdeEntorno(process.env) !== null });
  } catch (e) {
    console.error('Error al leer la cobertura de avisos:', e);
    return Response.json({ error: 'No pude leer qué avisos hay. Intenta de nuevo.' }, { status: 500 });
  }
}
