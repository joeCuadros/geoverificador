import type { Respuesta, Ajuste } from '@geoverificador/agente/agente';
import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import type { AvisoApi, Marcador } from '../../lib/marcadores.ts';

/** Lo que devuelve POST /api/agente: el estado de la conversación y los datos con los que se dibuja cada respuesta (sin leer texto). */
export type RespuestaApi = Pick<Respuesta, 'texto' | 'titular' | 'tipo' | 'estado' | 'modo' | 'entendido' | 'correcciones' | 'sugerencias' | 'resultados' | 'ficha' | 'comparacion' | 'cobertura'> & {
  avisos: AvisoApi[];
  mapa: MapaDeRespuesta;
};

/** Lo que devuelve GET /api/agente/estado. */
export interface EstadoDelAgente {
  resumen: string;
  ejemplos: Respuesta['sugerencias'];
  modelo: boolean;
}

export interface Turno {
  id: number;
  quien: 'yo' | 'agente';
  texto: string;
  error?: boolean;
  /** La respuesta completa del asistente (tarjetas, lo entendido, sugerencias…). */
  r?: RespuestaApi;
  /** Avisos de esta respuesta que tienen ubicación en el mapa. */
  ubicados?: Marcador[];
}

export interface Envio {
  mensaje: string;
  ajuste?: Ajuste;
}
