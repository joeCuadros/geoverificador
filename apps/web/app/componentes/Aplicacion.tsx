'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import type { Marcador } from '../../lib/marcadores.ts';
import { Buscador } from './Buscador.tsx';
import { Chat } from './Chat.tsx';
import { Ficha } from './Ficha.tsx';
import { Mapa } from './Mapa.tsx';
import { Onboarding } from './Onboarding.tsx';
import { MAPA_VACIO, type PuntoElegido } from './tipos.ts';
import { useFicha } from './useFicha.ts';
import { useViaje } from './useViaje.ts';

export type { PuntoElegido } from './tipos.ts';

type Pestana = 'asistente' | 'ficha';

/** El foco se perdió si no está en ningún control, o está en uno que ya no se ve (el botón de un resultado que se cerró, el del asistente que se ocultó). */
function focoPerdido(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !a || a === document.body || !a.isConnected || a.getClientRects().length === 0;
}

const MENSAJE_FICHA = 'Se abrió la pestaña «Ficha del punto».';
const MENSAJE_ASISTENTE = 'Se abrió la pestaña «Asistente»: el aviso quedó resaltado.';

/**
 * El espacio de trabajo: el mapa y, junto a él, el asistente y la ficha del punto elegido, que se influyen entre sí:
 *  · una tarjeta de aviso enfoca su marcador y un marcador resalta su tarjeta;
 *  · una fila de la ficha resalta su lugar en el mapa y un lugar del mapa resalta su fila;
 *  · el trabajo, los sectores y el viaje que midió el asistente se dibujan en el mapa.
 */
export function Aplicacion() {
  const [punto, setPunto] = useState<PuntoElegido | null>(null);
  const [marcadores, setMarcadores] = useState<Marcador[]>([]);
  const [respuesta, setRespuesta] = useState<MapaDeRespuesta>(MAPA_VACIO);
  const [avisoActivo, setAvisoActivo] = useState<number | null>(null);
  const [enfocar, setEnfocar] = useState<{ id: number; n: number } | null>(null);
  const [lugarActivo, setLugarActivo] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('asistente');
  const [anuncio, setAnuncio] = useState('');
  // Cuántas veces se eligió un punto: al cambiar, si el foco se perdió, se lleva al título de la ficha.
  const [elecciones, setElecciones] = useState(0);
  // El motivo de un cambio de pestaña que no hizo la persona con las pestañas (un clic en el mapa, una búsqueda): se anuncia una vez.
  const motivo = useRef<string | null>(null);
  const pestanaActual = useRef(pestana);
  const atendida = useRef(0); // la última elección cuyo foco ya se llevó a la ficha mientras se armaba
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  const { estado: ficha, reintentar } = useFicha(punto);
  const reporte = ficha.tipo === 'listo' ? ficha.reporte : null;

  const aviso = useMemo(() => marcadores.find((m) => m.id === avisoActivo) ?? null, [marcadores, avisoActivo]);
  const trabajo = respuesta.lugares.find((l) => l.rol === 'trabajo') ?? null;
  const viaje = useViaje(aviso, trabajo, respuesta.pideViaje);

  /** Cambia de pestaña por una acción en otra parte de la página y deja el motivo para anunciarlo (el cambio mismo no mueve el foco ni lo dice nadie). */
  const mostrar = useCallback((destino: Pestana, mensaje: string) => {
    motivo.current = destino === pestanaActual.current ? null : mensaje;
    setPestana(destino);
  }, []);

  const elegir = useCallback((p: PuntoElegido) => {
    setPunto(p);
    setLugarActivo(null);
    setElecciones((n) => n + 1);
    mostrar('ficha', MENSAJE_FICHA);
  }, [mostrar]);

  const alResultado = useCallback((m: Marcador[], mapa: MapaDeRespuesta) => {
    setMarcadores(m);
    setRespuesta(mapa);
    // Ningún aviso queda elegido de antemano: el orden de la lista no es una recomendación. La ruta al trabajo se dibuja para el aviso que la persona elige
    // con su tarjeta o su marcador (mientras no elija, se le dice).
    setAvisoActivo(null);
    setEnfocar(null);
  }, []);

  const elegirLugar = useCallback((lugar: string) => {
    setLugarActivo(lugar);
    mostrar('ficha', MENSAJE_FICHA);
  }, [mostrar]);

  // Anuncia el cambio de pestaña que hizo una acción del mapa o del buscador. Un solo texto fijo, aparte del de la ficha («Armando la ficha…», «… está lista»), que dice
  // la propia ficha: así no se oye dos veces lo mismo. Se vacía a los pocos segundos para que el mismo mensaje pueda repetirse.
  useEffect(() => {
    pestanaActual.current = pestana;
    if (!motivo.current) return;
    setAnuncio(motivo.current);
    motivo.current = null;
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setAnuncio(''), 5000);
  }, [pestana]);
  useEffect(() => () => clearTimeout(temporizador.current), []);

  // Al elegir un punto con el buscador (o con el aviso de un cuadro) el control que tenía el foco desaparece: sin esto el foco caería al inicio de la página.
  // Se lleva al título de la ficha; si el foco sigue en un control visible (el mapa, el botón del centro), no se toca. Al terminar de armarse, la ficha lo vuelve a poner en su título.
  // Se reintenta cada vez que cambia el estado de la ficha (vacío → armando → lista o error): el título que existe al elegir puede ser el de la ficha anterior o el vacío, que se reemplazan.
  useEffect(() => {
    if (elecciones === 0 || ficha.tipo === 'vacio' || atendida.current === elecciones) return;
    const cuadro = requestAnimationFrame(() => {
      if (ficha.tipo === 'cargando' || ficha.tipo === 'error') atendida.current = elecciones;
      if (!focoPerdido()) return;
      const titulo = document.querySelector<HTMLElement>(`[id="${id}-panel-ficha"] h2`);
      if (!titulo) return;
      titulo.tabIndex = -1;
      titulo.focus();
    });
    return () => cancelAnimationFrame(cuadro);
  }, [elecciones, ficha.tipo, id]);

  const pestanas: { id: Pestana; texto: string }[] = [
    { id: 'asistente', texto: 'Asistente' },
    { id: 'ficha', texto: 'Ficha del punto' },
  ];

  return (
    <div className="app">
      <a className="saltar" href="#panel">Saltar al asistente y la ficha</a>
      <a className="saltar" href="#zona-mapa">Saltar al mapa</a>
      <header className="banda">
        <h1>GeoVerificador</h1>
        <p>Predios de Arequipa</p>
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
            mostrar('asistente', MENSAJE_ASISTENTE);
          }}
          onVerFichaAviso={(m) => {
            setAvisoActivo(m.id);
            elegir({ lat: m.lat, lon: m.lon, origen: 'aviso', etiqueta: m.titulo });
          }}
          onLugar={elegirLugar}
        />
      </section>

      <main id="panel" className="panel" tabIndex={-1}>
        <div className="pestanas" role="tablist" aria-label="Asistente y ficha">
          {pestanas.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`${id}-pestana-${p.id}`}
              aria-selected={pestana === p.id}
              aria-controls={`${id}-panel-${p.id}`}
              tabIndex={pestana === p.id ? 0 : -1}
              className="pestana"
              onClick={() => setPestana(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const otra = p.id === 'asistente' ? 'ficha' : 'asistente';
                  setPestana(otra);
                  document.getElementById(`${id}-pestana-${otra}`)?.focus();
                }
              }}
            >
              {p.texto}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-panel-asistente`} aria-labelledby={`${id}-pestana-asistente`} hidden={pestana !== 'asistente'} className="cuerpo-panel">
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
        <div role="tabpanel" id={`${id}-panel-ficha`} aria-labelledby={`${id}-pestana-ficha`} hidden={pestana !== 'ficha'} className="cuerpo-panel">
          <Ficha punto={punto} estado={ficha} onReintentar={reintentar} lugarActivo={lugarActivo} onLugar={elegirLugar} />
        </div>
      </main>
      {/* Una sola región de estado, siempre presente (una que aparece con el texto ya puesto no siempre se lee). La ficha tiene la suya para «Armando…» y «… está lista». */}
      <p role="status" className="solo-lectores" data-testid="anuncio-de-pestana">
        {anuncio}
      </p>
    </div>
  );
}
