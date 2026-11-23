'use client';
import { useEffect, useState } from 'react';
import type { DatosDeViaje, EstadoViaje } from './tipos.ts';

interface Extremo {
  lat: number;
  lon: number;
}

/**
 * Pide el trazado de la combi o bus del aviso enfocado al trabajo (GET /api/viaje) cuando el asistente midió ese viaje. Sin aviso, sin trabajo o sin
 * que se haya pedido el viaje, no pide nada.
 */
export function useViaje(activo: { id: number; lat: number; lon: number } | null, trabajo: Extremo | null, pide: boolean): EstadoViaje {
  const [estado, setEstado] = useState<EstadoViaje>({ tipo: 'ninguno' });
  const id = activo?.id;
  const olat = activo?.lat;
  const olon = activo?.lon;
  const dlat = trabajo?.lat;
  const dlon = trabajo?.lon;

  useEffect(() => {
    if (!pide || id === undefined || olat === undefined || olon === undefined || dlat === undefined || dlon === undefined) {
      setEstado({ tipo: 'ninguno' });
      return;
    }
    const control = new AbortController();
    setEstado({ tipo: 'cargando' });
    (async () => {
      try {
        const q = new URLSearchParams({ origenLat: olat.toFixed(6), origenLon: olon.toFixed(6), destinoLat: dlat.toFixed(6), destinoLon: dlon.toFixed(6) });
        const r = await fetch(`/api/viaje?${q}`, { signal: control.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) setEstado({ tipo: 'error', mensaje: j.error ?? 'No se pudo medir el viaje.' });
        else setEstado({ tipo: 'listo', avisoId: id, datos: j as DatosDeViaje });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setEstado({ tipo: 'error', mensaje: 'No pude conectar para medir el viaje.' });
      }
    })();
    return () => control.abort();
  }, [id, olat, olon, dlat, dlon, pide]);

  return estado;
}
