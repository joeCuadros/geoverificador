'use client';
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { CapaInfo, GrupoDeCapa } from '../../lib/capas.ts';
import { muestraDeLeyenda } from './dibujo.ts';
import { IconoAlerta, IconoCerrar, IconoInfo } from './Iconos.tsx';

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

/** Los iconos del panel: el mismo trazo que los del asistente (Iconos.tsx), ocultos a los lectores porque siempre acompañan a un texto. */
function Svg({ children, tamano = 16 }: { children: ReactNode; tamano?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={tamano} height={tamano} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const IconoCapas = () => (
  <Svg>
    <path d="M10 3l7.5 4-7.5 4-7.5-4z" />
    <path d="M2.5 11l7.5 4 7.5-4" />
    <path d="M2.5 14.5l7.5 4 7.5-4" />
  </Svg>
);
const IconoCheck = () => (
  <Svg tamano={14}>
    <path d="M4.5 10.5l3.7 3.7 7.3-8" />
  </Svg>
);
const IconoReloj = () => (
  <Svg>
    <circle cx="10" cy="10" r="8" />
    <path d="M10 5.5V10l3 2" />
  </Svg>
);
const IconoZoom = () => (
  <Svg>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M12.7 12.7L17 17M6 8.5h5M8.5 6v5" />
  </Svg>
);

function IconoDeEstado({ tipo }: { tipo: EstadoCapa['tipo'] }) {
  if (tipo === 'cargando') return <IconoReloj />;
  if (tipo === 'error') return <IconoAlerta />;
  if (tipo === 'lejos' || tipo === 'recortada') return <IconoZoom />;
  return <IconoInfo />;
}

/** La muestra de una entrada de la leyenda: la misma forma y color con que el mapa dibuja ese elemento (ver `muestraDeLeyenda`). Es decorativa: el texto va al lado. */
function Muestra({ capa, item }: { capa: CapaInfo; item: CapaInfo['leyenda'][number] }) {
  const m = muestraDeLeyenda(capa, item);
  const estilo: Record<string, string | number> = { '--m': m.color };
  if (m.tipo === 'linea') estilo['--g'] = `${m.grosor + 1}px`;
  if (m.tipo === 'area') {
    estilo['--g'] = `${Math.max(2, m.grosor)}px`;
    estilo['--r'] = m.relleno;
  }
  if (m.tipo === 'anillo') estilo['--r'] = m.relleno;
  return (
    <span className={`muestra muestra-${m.tipo}${m.tipo === 'area' && m.discontinuo ? ' muestra-discontinua' : ''}`} style={estilo as CSSProperties} aria-hidden="true">
      {m.tipo === 'icono' ? m.letra : ''}
    </span>
  );
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

/**
 * El control de capas: un botón que despliega el panel (cajón a la derecha del mapa; en un teléfono, una hoja desde abajo). Las capas van en grupos con nombre; de cada una
 * se ve si está activa (casilla marcada y la palabra «Activa», nunca solo un color) y, si lo está, su estado, su leyenda con las muestras del mapa, lo que no dice y su fuente
 * con la fecha de sus datos. Se maneja con el teclado: el botón avisa con aria-expanded, cada capa es una casilla y Esc pliega el panel y devuelve el foco al botón.
 */
export function PanelCapas({ capas, errorDeLista, activas, estados, abierto, onAbrir, onAlternar }: Props) {
  const n = activas.size;
  const boton = useRef<HTMLButtonElement>(null);
  const idTitulo = useId();

  const alTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onAbrir(false);
    boton.current?.focus();
  };

  return (
    <div className="capas">
      <button
        ref={boton}
        type="button"
        className="capas-boton boton-secundario"
        aria-expanded={abierto}
        aria-controls="capas-panel"
        aria-label={`Capas del mapa${n > 0 ? `, ${n} ${n === 1 ? 'activa' : 'activas'}` : ''}`}
        onClick={() => onAbrir(!abierto)}
      >
        <IconoCapas />
        <span>
          Capas<span className="solo-escritorio"> del mapa</span>
          {n > 0 ? ` (${n})` : ''}
        </span>
      </button>
      <div id="capas-panel" className="capas-panel" role="group" aria-labelledby={idTitulo} hidden={!abierto} onKeyDown={alTecla}>
        <div className="capas-cabecera">
          <h2 id={idTitulo} className="capas-titulo">
            Capas del mapa
          </h2>
          {n > 0 && (
            <button type="button" className="capas-quitar boton-secundario" onClick={() => {
                [...activas].forEach(onAlternar);
                boton.current?.focus(); // el botón desaparece al quedar sin capas: el foco no se pierde
              }}>
              Quitar todas
            </button>
          )}
          <button type="button" className="capas-cerrar boton-secundario" aria-label="Cerrar panel de capas" onClick={() => onAbrir(false)}>
            <IconoCerrar />
          </button>
        </div>
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
            const encendidas = delGrupo.filter((c) => activas.has(c.id)).length;
            return (
              <fieldset key={g} className="capas-grupo">
                <legend>
                  <span>{g}</span>
                  {encendidas > 0 && <span className="capas-grupo-cuenta">{encendidas === 1 ? '1 activa' : `${encendidas} activas`}</span>}
                </legend>
                {delGrupo.map((c) => {
                  const activa = activas.has(c.id);
                  const estado = estados[c.id];
                  return (
                    <div key={c.id} className={`capa${activa ? ' capa-activa' : ''}`}>
                      <div className="capa-fila">
                        <label>
                          <input type="checkbox" checked={activa} onChange={() => onAlternar(c.id)} />
                          <span>{c.titulo}</span>
                        </label>
                        {activa && (
                          <span className="capa-chip" aria-hidden="true">
                            <IconoCheck /> Activa
                          </span>
                        )}
                      </div>
                      {activa && (
                        <div className="capa-detalle">
                          {estado && (
                            <p className={`capa-estado capa-estado-${estado.tipo}`} role="status">
                              <IconoDeEstado tipo={estado.tipo} />
                              {textoDeEstado(estado)}
                            </p>
                          )}
                          <ul className="leyenda" aria-label={`Leyenda: ${c.titulo}`}>
                            {c.leyenda.map((l) => (
                              <li key={l.texto}>
                                <Muestra capa={c} item={l} />
                                <span>{l.texto}</span>
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
