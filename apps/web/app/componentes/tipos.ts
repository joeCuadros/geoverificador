import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import type { ReporteDePunto } from '../../lib/reporte.ts';

export interface PuntoElegido {
  lat: number;
  lon: number;
  /** Cómo se eligió: un clic en el mapa, una búsqueda, un aviso o el centro del mapa. */
  origen: 'mapa' | 'busqueda' | 'aviso' | 'centro';
  etiqueta: string | null;
}

export type EstadoFicha = { tipo: 'vacio' } | { tipo: 'cargando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; reporte: ReporteDePunto };

/** El trazado de la combi o bus que lleva de un aviso al trabajo (GET /api/viaje). */
export interface DatosDeViaje {
  hayRuta: boolean;
  distanciaM: number;
  mejor: { minutos: number | null; trasbordos: number; lineas: string[]; caminarM: number } | null;
  trazado: {
    tramos: { nombre: string; linea: string; color: string | null; segmento: [number, number][]; subida: { lat: number; lon: number }; bajada: { lat: number; lon: number }; caminarOrigenM: number; caminarDestinoM: number }[];
    trasbordos: { lat: number; lon: number; nombre: string | null }[];
  } | null;
  nota: string;
}

export type EstadoViaje = { tipo: 'ninguno' } | { tipo: 'cargando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; avisoId: number; datos: DatosDeViaje };

export const MAPA_VACIO: MapaDeRespuesta = { lugares: [], sectores: [], pideViaje: false };

/** Un color tomado de los datos solo se usa si tiene forma de color hexadecimal. */
export const colorSeguro = (c: unknown, alternativa: string): string => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : alternativa);
