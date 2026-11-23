'use client';
import { useCallback, useId, useMemo, useState } from 'react';
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
  const id = useId();

  const { estado: ficha, reintentar } = useFicha(punto);
  const reporte = ficha.tipo === 'listo' ? ficha.reporte : null;

  const aviso = useMemo(() => marcadores.find((m) => m.id === avisoActivo) ?? null, [marcadores, avisoActivo]);
  const trabajo = respuesta.lugares.find((l) => l.rol === 'trabajo') ?? null;
  const viaje = useViaje(aviso, trabajo, respuesta.pideViaje);

  const elegir = useCallback((p: PuntoElegido) => {
    setPunto(p);
    setLugarActivo(null);
    setPestana('ficha');
  }, []);

  const alResultado = useCallback((m: Marcador[], mapa: MapaDeRespuesta) => {
    setMarcadores(m);
    setRespuesta(mapa);
    // El viaje se dibuja para el primer aviso (el que mejor cumple); la persona cambia de aviso con su tarjeta o su marcador.
    setAvisoActivo(m[0]?.id ?? null);
    setEnfocar(null);
  }, []);

  const elegirLugar = useCallback((lugar: string) => {
    setLugarActivo(lugar);
    setPestana('ficha');
  }, []);

  const pestanas: { id: Pestana; texto: string }[] = [
    { id: 'asistente', texto: 'Asistente' },
    { id: 'ficha', texto: 'Ficha del punto' },
  ];

  return (
    <div className="app">
      <a className="saltar" href="#panel">Saltar al asistente y la ficha</a>
      <header className="banda">
        <h1>GeoVerificador</h1>
        <p>Predios de Arequipa</p>
        <Onboarding />
      </header>

      <section className="zona-mapa" aria-label="Mapa">
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
            setPestana('asistente');
          }}
          onVerFichaAviso={(m) => {
            setAvisoActivo(m.id);
            elegir({ lat: m.lat, lon: m.lon, origen: 'aviso', etiqueta: m.titulo });
          }}
          onLugar={elegirLugar}
        />
      </section>

      <main id="panel" className="panel">
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
    </div>
  );
}
