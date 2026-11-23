'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import estilos from './Aplicacion.module.css';
import Asistente from './Asistente.tsx';
import Buscador from './Buscador.tsx';
import Capas from './Capas.tsx';
import Comparar, { type Guardado } from './Comparar.tsx';
import PanelPunto from './PanelPunto.tsx';
import type { Aviso, Etiquetado, Ficha, Punto } from '../lib/tipos.ts';

const Mapa = dynamic(() => import('./Mapa.tsx'), { ssr: false, loading: () => <div style={{ position: 'absolute', inset: 0, background: 'var(--superficie-2)' }} /> });

type Pestana = 'asistente' | 'punto' | 'capas' | 'comparar';
const RADIO_M = 500;

const Icono = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICONOS: Record<Pestana, string> = {
  asistente: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z',
  punto: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  capas: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  comparar: 'M4 6h7M4 12h7M4 18h7M15 6h5M15 12h5M15 18h5',
};
const NOMBRES: Record<Pestana, string> = { asistente: 'Asistente', punto: 'Punto', capas: 'Capas', comparar: 'Comparar' };

export default function Aplicacion() {
  const [pestana, setPestana] = useState<Pestana>('asistente');
  const [abierto, setAbierto] = useState(true);
  const [punto, setPunto] = useState<Etiquetado | null>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destino, setDestino] = useState<Etiquetado | null>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [avisoActivo, setAvisoActivo] = useState<number | null>(null);
  const [capas, setCapas] = useState<string[]>(['distritos']);
  const [guardados, setGuardados] = useState<Guardado[]>([]);
  const [vista, setVista] = useState<{ lat: number; lon: number; zoom?: number; n: number } | null>(null);
  const pedido = useRef(0);

  const elegirPunto = useCallback(async (p: Etiquetado, { enfocar = false, abrir = true } = {}) => {
    const n = ++pedido.current;
    setPunto(p);
    setFicha(null);
    setError(null);
    setCargando(true);
    if (abrir) { setPestana('punto'); setAbierto(true); }
    if (enfocar) setVista({ lat: p.lat, lon: p.lon, zoom: 16, n });
    try {
      const r = await fetch(`/api/ficha?lat=${p.lat}&lon=${p.lon}`);
      const j = await r.json();
      if (n !== pedido.current) return;
      if (!r.ok) setError(j.error ?? 'No pude armar la ficha de este punto.');
      else setFicha(j);
    } catch {
      if (n === pedido.current) setError('No pude conectar con el servidor.');
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, []);

  // Enlace compartible: ?lat=-16.4&lon=-71.5 abre ese punto; ?pestana=capas&capas=zonas,rutas fija la vista.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get('lat'));
    const lon = Number(q.get('lon'));
    const c = q.get('capas');
    if (c) setCapas(c.split(',').filter(Boolean));
    if (Number.isFinite(lat) && Number.isFinite(lon) && q.get('lat') && q.get('lon')) void elegirPunto({ lat, lon }, { enfocar: true });
    else if (['asistente', 'punto', 'capas', 'comparar'].includes(q.get('pestana') ?? '')) setPestana(q.get('pestana') as Pestana);
  }, [elegirPunto]);

  const guardar = () => {
    if (!punto || !ficha) return;
    const id = `${punto.lat.toFixed(5)},${punto.lon.toFixed(5)}`;
    setGuardados((g) => (g.some((x) => x.id === id) ? g.filter((x) => x.id !== id) : [...g, { id, punto, ficha }].slice(-3)));
  };
  const idActual = punto ? `${punto.lat.toFixed(5)},${punto.lon.toFixed(5)}` : '';

  const verAviso = (a: Aviso) => {
    if (a.lat == null || a.lon == null) return;
    void elegirPunto({ lat: a.lat, lon: a.lon, nombre: a.titulo ?? 'Aviso' }, { enfocar: true });
  };

  const pestanas: Pestana[] = ['asistente', 'punto', 'capas', 'comparar'];
  const cuerpo = {
    asistente: <Asistente avisoActivo={avisoActivo} onAvisos={(a) => { setAvisos(a); setAvisoActivo(null); }} onAvisoActivo={setAvisoActivo} onVerAviso={verAviso} />,
    punto: <PanelPunto punto={punto} ficha={ficha} cargando={cargando} error={error} destino={destino} onDestino={setDestino} guardado={guardados.some((g) => g.id === idActual)} onGuardar={guardar} onElegir={(p) => void elegirPunto(p, { enfocar: true })} />,
    capas: <Capas activas={capas} onCambiar={setCapas} />,
    comparar: <Comparar items={guardados} onQuitar={(id) => setGuardados((g) => g.filter((x) => x.id !== id))} onVer={(g) => void elegirPunto(g.punto, { enfocar: true })} />,
  }[pestana];

  return (
    <div className={estilos.raiz}>
      <aside className={estilos.lateral} data-abierto={abierto} aria-label="Panel">
        <button type="button" className={estilos.asa} aria-label={abierto ? 'Bajar el panel' : 'Subir el panel'} onClick={() => setAbierto((a) => !a)} />
        <header className={estilos.cab}>
          <div className={estilos.marca}>
            <span className={estilos.logo}><Icono d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM9 10l2 2 4-4" /></span>
            <div>
              <div className={estilos.nombre}>GeoVerificador</div>
              <div className={estilos.lema}>Vivienda en Arequipa, con datos medidos</div>
            </div>
          </div>
        </header>
        <div className={estilos.buscar}>
          <Buscador onElegir={(p) => void elegirPunto(p, { enfocar: true })} />
        </div>
        <div className={estilos.pestanas} role="tablist" aria-label="Secciones">
          {pestanas.map((p) => (
            <button key={p} type="button" role="tab" id={`tab-${p}`} aria-selected={pestana === p} aria-controls="cuerpo" className={estilos.pestana} onClick={() => { setPestana(p); setAbierto(true); }}>
              <Icono d={ICONOS[p]} />
              {NOMBRES[p]}
              {p === 'comparar' && guardados.length > 0 && <span className={estilos.insignia}>{guardados.length}</span>}
              {p === 'asistente' && avisos.length > 0 && <span className={estilos.insignia}>{avisos.length}</span>}
            </button>
          ))}
        </div>
        <div className={estilos.cuerpo} id="cuerpo" role="tabpanel" aria-labelledby={`tab-${pestana}`}>{cuerpo}</div>
      </aside>

      <main className={estilos.mapa}>
        <Mapa punto={punto} radioM={RADIO_M} avisos={avisos} avisoActivo={avisoActivo} destino={destino} capas={capas} vista={vista} onElegir={(p: Punto) => void elegirPunto(p)} onAviso={(id) => { setAvisoActivo(id); setPestana('asistente'); setAbierto(true); }} />
        <div className={estilos.pistaMapa}><span className={`${estilos.flotante}`}>Toca el mapa para ver el entorno de un punto</span></div>
      </main>
    </div>
  );
}

