'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import type { Marcador } from '../../lib/marcadores.ts';
import { Buscador } from './Buscador.tsx';
import { Chat } from './Chat.tsx';
import { Ficha } from './Ficha.tsx';
import { IconoCerrar } from './Iconos.tsx';
import { Mapa } from './Mapa.tsx';
import { Onboarding } from './Onboarding.tsx';
import { MAPA_VACIO, type PuntoElegido } from './tipos.ts';
import { useFicha } from './useFicha.ts';
import { useViaje } from './useViaje.ts';

export type { PuntoElegido } from './tipos.ts';

/** El foco se perdió si no está en ningún control, o está en uno que ya no se ve (el botón de un resultado que se cerró, el de la ficha que se cerró). */
function focoPerdido(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !a || a === document.body || !a.isConnected || a.getClientRects().length === 0;
}

const MENSAJE_FICHA = 'Se abrió la ficha del punto, junto al asistente.';
const MENSAJE_CIERRE = 'Se cerró la ficha del punto.';
const MENSAJE_AVISO = 'El aviso quedó resaltado en el asistente.';

/**
 * El espacio de trabajo: arriba la barra con el nombre y la ayuda; debajo, en columnas, el asistente, la ficha del punto elegido (solo cuando hay uno) y el mapa.
 * Se influyen entre sí:
 *  · una tarjeta de aviso enfoca su marcador y un marcador resalta su tarjeta;
 *  · una fila de la ficha resalta su lugar en el mapa y un lugar del mapa resalta su fila;
 *  · el trabajo, los sectores y el viaje que midió el asistente se dibujan en el mapa.
 * El asistente no se esconde nunca: la ficha se abre a su lado y se cierra con su botón, y el foco vuelve a donde estaba.
 */
export function Aplicacion() {
  const [punto, setPunto] = useState<PuntoElegido | null>(null);
  const [marcadores, setMarcadores] = useState<Marcador[]>([]);
  const [respuesta, setRespuesta] = useState<MapaDeRespuesta>(MAPA_VACIO);
  const [avisoActivo, setAvisoActivo] = useState<number | null>(null);
  const [enfocar, setEnfocar] = useState<{ id: number; n: number } | null>(null);
  const [lugarActivo, setLugarActivo] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  // Cuántas veces se eligió un punto: al cambiar, si el foco se perdió, se lleva al título de la ficha.
  const [elecciones, setElecciones] = useState(0);
  const atendida = useRef(0); // la última elección cuyo foco ya se llevó a la ficha mientras se armaba
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** El control que tenía el foco cuando se abrió la ficha: al cerrarla, el foco vuelve ahí. */
  const origenFicha = useRef<HTMLElement | null>(null);

  const { estado: ficha, reintentar } = useFicha(punto);
  const reporte = ficha.tipo === 'listo' ? ficha.reporte : null;

  const aviso = useMemo(() => marcadores.find((m) => m.id === avisoActivo) ?? null, [marcadores, avisoActivo]);
  const trabajo = respuesta.lugares.find((l) => l.rol === 'trabajo') ?? null;
  const viaje = useViaje(aviso, trabajo, respuesta.pideViaje);

  /** Anuncia una vez un cambio que no hizo la persona con el control que cambió (la ficha que se abre por un clic en el mapa, por ejemplo). */
  const anunciar = useCallback((mensaje: string) => {
    setAnuncio(mensaje);
    clearTimeout(temporizador.current);
    // Se vacía a los pocos segundos para que el mismo mensaje pueda repetirse.
    temporizador.current = setTimeout(() => setAnuncio(''), 5000);
  }, []);
  useEffect(() => () => clearTimeout(temporizador.current), []);

  // Si la ficha ya estaba abierta, elegir otro punto solo cambia su contenido: no se anuncia otra vez ni cambia a dónde vuelve el foco al cerrarla.
  const hayPunto = useRef(false);
  useEffect(() => {
    hayPunto.current = punto !== null;
  }, [punto]);

  const elegir = useCallback(
    (p: PuntoElegido) => {
      if (!hayPunto.current) {
        hayPunto.current = true;
        const a = document.activeElement;
        origenFicha.current = a instanceof HTMLElement && a !== document.body ? a : null;
        anunciar(MENSAJE_FICHA);
      }
      setPunto(p);
      setLugarActivo(null);
      setElecciones((n) => n + 1);
    },
    [anunciar],
  );

  const cerrarFicha = useCallback(() => {
    hayPunto.current = false;
    setPunto(null);
    setLugarActivo(null);
    anunciar(MENSAJE_CIERRE);
    const origen = origenFicha.current;
    origenFicha.current = null;
    // Después de quitar la columna: el foco vuelve al control que la abrió o, si ya no está, al asistente.
    requestAnimationFrame(() => {
      if (origen && origen.isConnected && origen.getClientRects().length > 0) origen.focus();
      else document.getElementById('panel')?.focus();
    });
  }, [anunciar]);

  const alResultado = useCallback((m: Marcador[], mapa: MapaDeRespuesta) => {
    setMarcadores(m);
    setRespuesta(mapa);
    // Ningún aviso queda elegido de antemano: el orden de la lista no es una recomendación. La ruta al trabajo se dibuja para el aviso que la persona elige
    // con su tarjeta o su marcador (mientras no elija, se le dice).
    setAvisoActivo(null);
    setEnfocar(null);
  }, []);

  // Al elegir un punto con el buscador (o con el aviso de un cuadro) el control que tenía el foco desaparece: sin esto el foco caería al inicio de la página.
  // Se lleva al título de la ficha; si el foco sigue en un control visible (el mapa, el botón del centro), no se toca. Al terminar de armarse, la ficha lo vuelve a poner en su título.
  // Se reintenta cada vez que cambia el estado de la ficha (vacío → armando → lista o error): el título que existe al elegir puede ser el de la ficha anterior, que se reemplaza.
  useEffect(() => {
    if (elecciones === 0 || ficha.tipo === 'vacio' || atendida.current === elecciones) return;
    const cuadro = requestAnimationFrame(() => {
      if (ficha.tipo === 'cargando' || ficha.tipo === 'error') atendida.current = elecciones;
      if (!focoPerdido()) return;
      const titulo = document.querySelector<HTMLElement>('#ficha-panel h2');
      if (!titulo) return;
      titulo.tabIndex = -1;
      titulo.focus();
    });
    return () => cancelAnimationFrame(cuadro);
  }, [elecciones, ficha.tipo]);

  return (
    <div className={`app${punto ? ' app-con-ficha' : ''}`}>
      <a className="saltar" href="#panel">Saltar al asistente</a>
      {punto && (
        <a className="saltar" href="#ficha-panel">
          Saltar a la ficha del punto
        </a>
      )}
      <a className="saltar" href="#zona-mapa">Saltar al mapa</a>
      <header className="banda">
        <span className="banda-marca" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11 12 4l9 7" />
            <path d="M5 10v10h14V10" />
            <path d="m9 15 2 2 4-4" />
          </svg>
        </span>
        <div className="banda-nombre">
          <h1>GeoVerificador</h1>
          <p>Predios de Arequipa</p>
        </div>
        <Onboarding />
      </header>

      {/* El nombre de la región no repite «Mapa»: el mapa mismo (grupo de Mapa.tsx) ya se llama «Mapa de Arequipa…». tabIndex -1 para que el enlace de salto mueva el foco también en Safari. */}
      <section id="zona-mapa" className="zona-mapa" aria-label="Buscar y elegir un punto" tabIndex={-1}>
        <Buscador onElegir={(lat, lon, etiqueta) => elegir({ lat, lon, origen: 'busqueda', etiqueta })} />
        <Mapa
          marcadores={marcadores}
          avisoActivo={avisoActivo}
          enfocar={enfocar}
          punto={punto}
          reporte={reporte}
          lugarActivo={lugarActivo}
          respuesta={respuesta}
          viaje={viaje}
          onElegir={(lat, lon, origen, etiqueta) => elegir({ lat, lon, origen, etiqueta })}
          onAviso={(m) => {
            // Un marcador resalta su tarjeta en el asistente.
            setAvisoActivo(m.id);
            anunciar(MENSAJE_AVISO);
          }}
          onVerFichaAviso={(m) => {
            setAvisoActivo(m.id);
            elegir({ lat: m.lat, lon: m.lon, origen: 'aviso', etiqueta: m.titulo });
          }}
          onLugar={setLugarActivo}
        />
      </section>

      <main id="panel" className="panel" tabIndex={-1} aria-label="Asistente">
        <div className="cuerpo-panel">
          {respuesta.pideViaje && trabajo && marcadores.length > 0 && avisoActivo === null && (
            <p className="viaje-estado nota-viaje">Para ver la ruta al trabajo en el mapa, elige un aviso: pulsa «Ver en el mapa» en su tarjeta o toca su marcador.</p>
          )}
          <Chat
            onResultado={alResultado}
            activo={avisoActivo}
            viaje={viaje}
            punto={punto}
            onEnfocar={(m) => {
              setAvisoActivo(m.id);
              setEnfocar((e) => ({ id: m.id, n: (e?.n ?? 0) + 1 }));
            }}
            onVerFicha={(m) => {
              setAvisoActivo(m.id);
              elegir({ lat: m.lat, lon: m.lon, origen: 'aviso', etiqueta: m.titulo });
            }}
          />
        </div>
      </main>

      {punto && (
        <section id="ficha-panel" className="panel-ficha" aria-label="Ficha del punto" tabIndex={-1}>
          <button type="button" className="ficha-cerrar" aria-label="Cerrar la ficha del punto" onClick={cerrarFicha}>
            <IconoCerrar />
          </button>
          <div className="cuerpo-ficha">
            <Ficha punto={punto} estado={ficha} onReintentar={reintentar} lugarActivo={lugarActivo} onLugar={setLugarActivo} />
          </div>
        </section>
      )}
      {/* Una sola región de estado, siempre presente (una que aparece con el texto ya puesto no siempre se lee). La ficha tiene la suya para «Armando…» y «… está lista». */}
      <p role="status" className="solo-lectores" data-testid="anuncio-de-pestana">
        {anuncio}
      </p>
    </div>
  );
}
