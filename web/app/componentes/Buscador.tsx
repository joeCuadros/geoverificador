'use client';
import { useState, type FormEvent } from 'react';

interface Resultado {
  nombre: string;
  lat: number;
  lon: number;
  precisionM: number;
  origen: 'destino' | 'lugar' | 'distrito' | 'nominatim';
  categoria: string | null;
  distrito: string | null;
}

type Estado = { tipo: 'quieto' } | { tipo: 'buscando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; texto: string; resultados: Resultado[] };

const ORIGEN: Record<Resultado['origen'], string> = { destino: 'lugar de referencia', lugar: 'lugar de los datos', distrito: 'referencia dentro del distrito', nominatim: 'dirección' };

/** Busca un lugar por su nombre en los datos locales (sin servicios externos) y deja elegir uno para ver su ficha. */
export function Buscador({ onElegir }: { onElegir: (lat: number, lon: number, etiqueta: string) => void }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'quieto' });

  async function buscar(f: FormEvent<HTMLFormElement>) {
    f.preventDefault();
    const q = (new FormData(f.currentTarget).get('q') as string).trim();
    if (q.length < 2) {
      setEstado({ tipo: 'error', mensaje: 'Escribe al menos 2 letras del lugar que buscas.' });
      return;
    }
    setEstado({ tipo: 'buscando' });
    try {
      const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEstado({ tipo: 'error', mensaje: j.error ?? 'No se pudo buscar el lugar. Intenta de nuevo.' });
        return;
      }
      const resultados: Resultado[] = j.resultados ?? [];
      setEstado({ tipo: 'listo', texto: q, resultados });
    } catch {
      setEstado({ tipo: 'error', mensaje: 'No pude conectar. Revisa tu conexión e intenta de nuevo.' });
    }
  }

  return (
    <div className="buscador">
      <form onSubmit={buscar} role="search" aria-label="Buscar un lugar">
        <label htmlFor="buscar-lugar">Buscar un lugar</label>
        <div className="buscador-fila">
          <input id="buscar-lugar" name="q" type="search" autoComplete="off" maxLength={100} placeholder="Plaza de Armas, Real Plaza, Cayma…" />
          <button type="submit" disabled={estado.tipo === 'buscando'}>
            Buscar
          </button>
        </div>
      </form>
      <div aria-live="polite" className="buscador-estado">
        {estado.tipo === 'buscando' && <p role="status">Buscando…</p>}
        {estado.tipo === 'error' && (
          <p role="alert" className="mensaje-error">
            {estado.mensaje}
          </p>
        )}
        {estado.tipo === 'listo' && estado.resultados.length === 0 && (
          <p className="mensaje-vacio">No encontré «{estado.texto}» en los datos. Prueba con el nombre de un colegio, un mall, un distrito, o haz clic en el mapa.</p>
        )}
        {estado.tipo === 'listo' && estado.resultados.length > 0 && (
          <ul className="resultados" aria-label="Resultados de la búsqueda">
            {estado.resultados.map((r, i) => (
              <li key={`${r.nombre}-${i}`}>
                <button
                  type="button"
                  className="resultado"
                  onClick={() => {
                    onElegir(r.lat, r.lon, r.nombre);
                    setEstado({ tipo: 'quieto' });
                  }}
                >
                  <span className="resultado-nombre">{r.nombre}</span>
                  <span className="resultado-detalle">
                    {ORIGEN[r.origen]}
                    {r.distrito && r.origen !== 'distrito' ? ` · ${r.distrito}` : ''} · precisión de unos {r.precisionM} m
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
