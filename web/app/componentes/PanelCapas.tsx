'use client';
import type { CapaInfo, GrupoDeCapa } from '../../lib/capas.ts';

export type EstadoCapa = { tipo: 'cargando' } | { tipo: 'ok'; n: number } | { tipo: 'recortada'; n: number } | { tipo: 'lejos'; zoomMin: number; ventana: boolean } | { tipo: 'error' };

const GRUPOS: GrupoDeCapa[] = ['Servicios', 'Zonificación', 'Riesgo', 'Movilidad', 'Límites'];

export function textoDeEstado(e: EstadoCapa): string {
  switch (e.tipo) {
    case 'cargando':
      return 'Cargando…';
    case 'ok':
      return e.n === 0 ? 'Sin elementos en esta vista.' : e.n === 1 ? '1 elemento en esta vista.' : `${e.n} elementos en esta vista.`;
    case 'recortada':
      return `Se muestran los primeros ${e.n}: acerca el mapa para ver el resto.`;
    case 'lejos':
      return e.ventana ? 'La vista abarca demasiado terreno: acerca el mapa para ver esta capa.' : `Acerca el mapa (zoom ${e.zoomMin} o más) para ver esta capa.`;
    case 'error':
      return 'No se pudo cargar esta capa. Se vuelve a intentar al mover el mapa.';
  }
}

interface Props {
  capas: CapaInfo[] | null;
  errorDeLista: boolean;
  activas: ReadonlySet<string>;
  estados: Readonly<Record<string, EstadoCapa>>;
  abierto: boolean;
  onAbrir: (abierto: boolean) => void;
  onAlternar: (id: string) => void;
}

/** El control de capas: casillas por grupo, y de cada capa activa su estado, su leyenda, lo que no dice y su fuente con la fecha de sus datos. */
export function PanelCapas({ capas, errorDeLista, activas, estados, abierto, onAbrir, onAlternar }: Props) {
  const n = activas.size;
  return (
    <div className="capas">
      <button type="button" className="capas-boton boton-secundario" aria-expanded={abierto} aria-controls="capas-panel" onClick={() => onAbrir(!abierto)}>
        Capas del mapa{n > 0 ? ` (${n})` : ''}
      </button>
      <div id="capas-panel" className="capas-panel" role="group" aria-label="Capas del mapa" hidden={!abierto}>
        {errorDeLista && (
          <p className="mensaje-error" role="alert">
            No se pudo cargar la lista de capas. Cierra y vuelve a abrir este panel para reintentar.
          </p>
        )}
        {!capas && !errorDeLista && <p role="status">Cargando las capas…</p>}
        {capas &&
          GRUPOS.map((g) => {
            const delGrupo = capas.filter((c) => c.grupo === g);
            if (!delGrupo.length) return null;
            return (
              <fieldset key={g} className="capas-grupo">
                <legend>{g}</legend>
                {delGrupo.map((c) => {
                  const activa = activas.has(c.id);
                  const estado = estados[c.id];
                  return (
                    <div key={c.id} className="capa">
                      <label>
                        <input type="checkbox" checked={activa} onChange={() => onAlternar(c.id)} />
                        <span>{c.titulo}</span>
                      </label>
                      {activa && (
                        <div className="capa-detalle">
                          {estado && <p className={`capa-estado capa-estado-${estado.tipo}`}>{textoDeEstado(estado)}</p>}
                          <ul className="leyenda" aria-label={`Leyenda: ${c.titulo}`}>
                            {c.leyenda.map((l) => (
                              <li key={l.texto}>
                                <span className={`muestra${c.forma === 'punto' ? ' muestra-punto' : ''}`} style={{ background: l.color }} aria-hidden="true">
                                  {l.letra ?? ''}
                                </span>
                                {l.texto}
                              </li>
                            ))}
                          </ul>
                          <p className="capa-nota">{c.nota}</p>
                          <p className="capa-fuente">
                            Fuente: {c.fuente.nombre} · {c.fuente.fecha ? `datos del ${c.fuente.fecha}` : 'la base no registra la fecha de los datos'}
                            {c.fuente.licencia ? ` · licencia ${c.fuente.licencia}` : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
      </div>
    </div>
  );
}
