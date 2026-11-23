import { CRITERIOS } from '@geoverificador/agente/criterios';
import { enArequipa } from '@geoverificador/dominio/avisos';
import { radioValido } from './radio.ts';

export interface LugarDeRespuesta {
  rol: 'trabajo' | 'lugar';
  nombre: string;
  lat: number;
  lon: number;
  /**
   * Solo el «lugar pedido» con su criterio «cerca de» activo: la distancia de «cerca», en metros (la que la persona dijo o, si no dijo ninguna, la de referencia).
   * El mapa dibuja con ella el círculo de preferencia. El trabajo no la lleva: se mide en tiempo de viaje, no en distancia.
   */
  radioM?: number;
}

export interface SectorDeRespuesta {
  n: number;
  nombre: string | null;
  distrito: string | null;
  hectareas: number;
  lat: number;
  lon: number;
}

/** Lo que la respuesta del asistente tiene para dibujar además de los avisos: los lugares que ubicó, los sectores de la búsqueda de zonas y si hay un viaje que medir. */
export interface MapaDeRespuesta {
  lugares: LugarDeRespuesta[];
  sectores: SectorDeRespuesta[];
  /** El asistente midió el tiempo al trabajo (criterio «trabajo» con un lugar ubicado): el mapa puede pedir el trazado de cada aviso. */
  pideViaje: boolean;
}

interface Llamada {
  nombre: string;
  entrada: unknown;
  salida: unknown;
}

const esPunto = (p: any): p is { lat: number; lon: number; nombre: string } => Boolean(p) && Number.isFinite(p.lat) && Number.isFinite(p.lon) && enArequipa(p.lat, p.lon);

/**
 * Saca de las llamadas a herramientas lo que ya está calculado y se puede dibujar: el trabajo y el otro lugar tal como el asistente los ubicó (la entrada de
 * `buscar_avisos`) y los sectores de `buscar_zonas`. No calcula ni inventa geometría.
 */
export function mapaDeRespuesta(llamadas: Llamada[], consulta: { criterios?: { id: string }[] } | null): MapaDeRespuesta {
  const lugares: LugarDeRespuesta[] = [];
  const sectores: SectorDeRespuesta[] = [];
  for (const h of llamadas) {
    if (h.nombre === 'buscar_avisos') {
      const e = (h.entrada ?? {}) as { trabajo?: unknown; lugar?: unknown; criterios?: { id?: string; metros?: unknown }[] };
      if (esPunto(e.trabajo)) lugares.push({ rol: 'trabajo', nombre: e.trabajo.nombre, lat: e.trabajo.lat, lon: e.trabajo.lon });
      if (esPunto(e.lugar)) {
        const pedido = e.criterios?.find((c) => c.id === 'lugar');
        // Sin el criterio «lugar» (la persona lo quitó) el lugar sigue ubicado pero ya no hay una distancia de «cerca» que dibujar.
        lugares.push({ rol: 'lugar', nombre: e.lugar.nombre, lat: e.lugar.lat, lon: e.lugar.lon, ...(pedido ? { radioM: radioValido(pedido.metros) ? pedido.metros : CRITERIOS.lugar.omision } : {}) });
      }
    } else if (h.nombre === 'buscar_zonas') {
      const lista = ((h.salida ?? {}) as { sectores?: any[] }).sectores ?? [];
      for (const s of lista) if (Number.isFinite(s?.lat) && Number.isFinite(s?.lon)) sectores.push({ n: sectores.length + 1, nombre: s.nombre ?? null, distrito: s.distrito ?? null, hectareas: Number(s.hectareas) || 0, lat: s.lat, lon: s.lon });
    }
  }
  const pideViaje = lugares.some((l) => l.rol === 'trabajo') && Boolean(consulta?.criterios?.some((c) => c.id === 'trabajo'));
  return { lugares, sectores, pideViaje };
}
