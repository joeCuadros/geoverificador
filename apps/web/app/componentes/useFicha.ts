'use client';
import { useEffect, useState } from 'react';
import type { ReporteDePunto } from '../../lib/reporte.ts';
import type { EstadoFicha, PuntoElegido } from './tipos.ts';

/**
 * Pide la ficha del punto elegido (GET /api/ficha) y cancela la anterior si se elige otro. `reintentar` vuelve a pedir la misma.
 * Los errores no tienen sujeto («No se pudo…»): el mensaje del servidor se muestra tal cual y la ficha agrega el paso siguiente (Reintentar).
 */
export function useFicha(punto: PuntoElegido | null): { estado: EstadoFicha; reintentar: () => void } {
  const [estado, setEstado] = useState<EstadoFicha>({ tipo: 'vacio' });
  const [intento, setIntento] = useState(0);
  const lat = punto?.lat;
  const lon = punto?.lon;

  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const control = new AbortController();
    setEstado({ tipo: 'cargando' });
    (async () => {
      try {
        const r = await fetch(`/api/ficha?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { signal: control.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) setEstado({ tipo: 'error', mensaje: j.error ?? 'No se pudo armar la ficha de este punto.' });
        else setEstado({ tipo: 'listo', reporte: j as ReporteDePunto });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setEstado({ tipo: 'error', mensaje: 'No se pudo conectar con el servidor. Revisa tu conexión.' });
      }
    })();
    return () => control.abort();
  }, [lat, lon, intento]);

  return { estado, reintentar: () => setIntento((n) => n + 1) };
}
