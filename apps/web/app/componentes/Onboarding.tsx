'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { PASOS, almacenDelNavegador, anterior, esPrimero, esUltimo, marcarVisto, progreso, siguiente, textoDelModelo, yaVisto } from '../../lib/onboarding.ts';
import { IconoAlerta, IconoInfo } from './Iconos.tsx';
import { Ilustracion, tieneIlustracion } from './Ilustraciones.tsx';
import './ilustraciones.css';
import './onboarding.css';

/** El evento con que otra parte de la página (la portada del asistente) abre la guía en un paso: `detail` es el id del paso. */
const EVENTO_GUIA = 'geoverificador:guia';

/** Abre la guía en el paso `id` (o en el primero, si no existe). */
export function abrirGuiaEn(id: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENTO_GUIA, { detail: id }));
}

/** Dónde se ancla el cuadro: del lado opuesto al control que explica, para no taparlo; centrado si el paso no señala ninguno. */
type Lado = 'arriba' | 'abajo' | 'centro';

const ENFOCABLES = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * La guía de primera visita y el botón «Ayuda» que la reabre. Se abre sola la primera vez (si el navegador no recuerda haberla visto) y se puede omitir.
 * Es un diálogo modal: el foco queda dentro (Tab y Mayús+Tab dan la vuelta), Esc lo cierra y el foco vuelve a donde estaba. Mientras explica un control, ese control
 * lleva `data-onb-destacado` (un contorno; ver onboarding.css). El contenido y la memoria de «ya la vi» viven en lib/onboarding.ts.
 */
export function Onboarding() {
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState(0);
  const [lado, setLado] = useState<Lado>('centro');
  const [altoMax, setAltoMax] = useState<number | null>(null);
  const [modelo, setModelo] = useState<boolean | null>(null);
  const botonAyuda = useRef<HTMLButtonElement>(null);
  const dialogo = useRef<HTMLDivElement>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const previo = useRef<HTMLElement | null>(null);
  const idTitulo = useId();

  const abrir = useCallback((inicio = 0) => {
    previo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaso(inicio);
    setAbierto(true);
  }, []);

  // La portada del asistente abre la guía en el paso que explica cada una de sus miniaturas.
  useEffect(() => {
    const alPedir = (e: Event) => {
      const i = PASOS.findIndex((p) => p.id === (e as CustomEvent<string>).detail);
      abrir(i >= 0 ? i : 0);
    };
    window.addEventListener(EVENTO_GUIA, alPedir);
    return () => window.removeEventListener(EVENTO_GUIA, alPedir);
  }, [abrir]);

  /** Cerrar de cualquier modo (terminar, omitir o Esc) cuenta como «ya la vi». */
  const cerrar = useCallback(() => {
    marcarVisto(almacenDelNavegador());
    setAbierto(false);
  }, []);

  // La primera visita: se abre sola si el navegador no recuerda haberla visto (sin almacenamiento, se abre en cada carga).
  useEffect(() => {
    if (!yaVisto(almacenDelNavegador())) abrir();
  }, [abrir]);

  // Mientras está abierta: Esc cierra, el foco no sale del cuadro y, al cerrar, vuelve a donde estaba.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      cerrar();
    };
    const alEnfocar = (e: FocusEvent) => {
      if (dialogo.current && e.target instanceof Node && !dialogo.current.contains(e.target)) principal.current?.focus();
    };
    document.addEventListener('keydown', alTeclear);
    document.addEventListener('focusin', alEnfocar);
    principal.current?.focus();
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.removeEventListener('focusin', alEnfocar);
      const origen = previo.current;
      (origen && origen.isConnected && origen !== document.body ? origen : botonAyuda.current)?.focus();
    };
  }, [abierto, cerrar]);

  // El control que explica este paso: se resalta, se trae a la vista y el cuadro se ancla del lado contrario.
  useLayoutEffect(() => {
    if (!abierto) return;
    const selector = PASOS[paso].objetivo;
    const el = selector ? document.querySelector<HTMLElement>(selector) : null;
    const caja = el?.getBoundingClientRect();
    if (!el || !caja || (caja.width === 0 && caja.height === 0)) {
      setLado('centro');
      setAltoMax(null);
      return;
    }
    el.setAttribute('data-onb-destacado', '');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const debajo = r.top + r.height / 2 < window.innerHeight / 2;
    setLado(debajo ? 'abajo' : 'arriba');
    // El cuadro no pasa del espacio libre del lado contrario (menos el margen, el contorno y un respiro): si no cabe, se desplaza por dentro.
    setAltoMax(Math.max(160, Math.floor(debajo ? window.innerHeight - r.bottom - 24 : r.top - 24)));
    return () => el.removeAttribute('data-onb-destacado');
  }, [abierto, paso]);

  // El paso de privacidad dice si, en este servidor, el modelo está activo (lo mismo que consulta el asistente al abrirse).
  const enPrivacidad = abierto && PASOS[paso].privacidad === true;
  useEffect(() => {
    if (!enPrivacidad || modelo !== null) return;
    let vivo = true;
    fetch('/api/agente/estado')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && j && typeof j.modelo === 'boolean' && setModelo(j.modelo))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [enPrivacidad, modelo]);

  /** Tab y Mayús+Tab dan la vuelta dentro del cuadro. */
  const atrapar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogo.current) return;
    const lista = Array.from(dialogo.current.querySelectorAll<HTMLElement>(ENFOCABLES));
    if (lista.length === 0) return;
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === dialogo.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  const actual = PASOS[paso];
  const ultimo = esUltimo(paso);
  const estadoDelModelo = actual.privacidad ? textoDelModelo(modelo) : null;

  return (
    <>
      <button ref={botonAyuda} type="button" className="onb-ayuda" aria-haspopup="dialog" onClick={() => abrir()}>
        <IconoInfo />
        Ayuda
      </button>
      {abierto &&
        createPortal(
          <div className="onb-fondo" data-lado={lado} style={altoMax === null ? undefined : ({ '--onb-alto-max': `${altoMax}px` } as CSSProperties)}>
            <div ref={dialogo} className="onb-dialogo" role="dialog" aria-modal="true" aria-labelledby={idTitulo} data-testid="onboarding" onKeyDown={atrapar}>
              <p className="onb-progreso">
                <span className="onb-barra" aria-hidden="true">
                  {PASOS.map((p, i) => (
                    <span key={p.id} className={i <= paso ? 'onb-tramo onb-tramo-hecho' : 'onb-tramo'} />
                  ))}
                </span>
                <span>{progreso(paso)}</span>
              </p>
              <div className="onb-contenido" aria-live="polite">
                <h2 id={idTitulo} key={`t-${actual.id}`} className="onb-titulo">
                  {actual.titulo}
                </h2>
                <div key={actual.id}>
                  {tieneIlustracion(actual.id) && <Ilustracion id={actual.id} />}
                  <p className="onb-intro">{actual.intro}</p>
                  <ul className="onb-puntos">
                    {actual.puntos.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  {actual.aviso && (
                    <p className="onb-aviso" role="note">
                      <IconoAlerta />
                      <span>{actual.aviso}</span>
                    </p>
                  )}
                  {estadoDelModelo && (
                    <p className="onb-estado" data-testid="onboarding-modelo">
                      <IconoInfo />
                      <span>{estadoDelModelo}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="onb-acciones">
                {!ultimo && (
                  <button type="button" className="onb-omitir" onClick={cerrar}>
                    Omitir guía
                  </button>
                )}
                <div className="onb-navegacion">
                  {!esPrimero(paso) && (
                    <button type="button" className="boton-secundario" onClick={() => setPaso(anterior(paso))}>
                      Atrás
                    </button>
                  )}
                  <button ref={principal} type="button" onClick={ultimo ? cerrar : () => setPaso(siguiente(paso))}>
                    {ultimo ? 'Entendido' : 'Siguiente'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
