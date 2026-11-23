'use client';
import { useEffect, useRef, useState } from 'react';
import ui from './ui.module.css';
import estilos from './Asistente.module.css';
import type { Aviso } from '../lib/tipos.ts';
import { fechaCorta, precio, soles } from '../lib/formato.ts';

interface Turno { quien: 'yo' | 'agente'; texto?: string; avisos?: Aviso[]; pregunta?: boolean }

const EJEMPLOS = [
  'Departamento en Cayma, cerca de un colegio, con agua y luz, hasta 400 mil soles',
  'Casa cerca de mi trabajo en el Parque Industrial hasta 120 mil dólares',
  '¿Dónde puedo vivir cerca de salud y transporte?',
];

function Tarjeta({ a, n, activo, onElegir, onVer }: { a: Aviso; n: number; activo: boolean; onElegir: () => void; onVer: () => void }) {
  return (
    <article className={`${estilos.aviso} ${activo ? estilos.activo : ''}`} onClick={onElegir}>
      <header>
        <span className={estilos.num}>{n}</span>
        <div>
          <h3>{a.titulo ?? 'Aviso sin título'}</h3>
          <p>{a.distrito ?? 'Distrito sin dato'}{a.areaM2 ? ` · ${Math.round(a.areaM2)} m²` : ''}{a.dormitorios ? ` · ${a.dormitorios} dorm.` : ''}</p>
        </div>
      </header>
      <p className={estilos.precio}>
        {precio(a.precio, a.moneda)}
        {a.moneda === 'USD' && a.precioPen != null && <small> ≈ {soles(a.precioPen)} (cambio {a.tipoCambio}, {fechaCorta(a.tipoCambioFecha)})</small>}
      </p>
      {a.pedidos > 0 && <p className={estilos.resumen}>Cumple <strong>{a.cumplidos} de {a.pedidos}</strong> criterios{a.sinDato ? ` · ${a.sinDato} sin dato` : ''}</p>}
      <ul className={estilos.criterios}>
        {a.criterios.map((c) => (
          <li key={c.id}>
            <span className={`${ui.chip} ${c.cumple === true ? ui.ok : c.cumple === false ? ui.mal : ui.aviso}`}>{c.cumple === true ? 'Cumple' : c.cumple === false ? 'No cumple' : 'Sin dato'}</span>
            <div>
              <strong>{c.etiqueta}</strong>: {c.valor}
              <small title={[c.fuente, c.fecha ? fechaCorta(c.fecha) : null, c.nota].filter(Boolean).join(' · ')}>{[c.fuente, c.fecha ? fechaCorta(c.fecha) : null].filter(Boolean).join(' · ')}{c.nota ? ` — ${c.nota}` : ''}</small>
            </div>
          </li>
        ))}
      </ul>
      <footer>
        <small>{a.fuente}{a.tambienEn.length ? ` + ${a.tambienEn.join(', ')}` : ''} · visto el {fechaCorta(a.vistoPorUltimaVez)}</small>
        <div className={estilos.botones}>
          <button type="button" className={ui.boton} onClick={(e) => { e.stopPropagation(); onVer(); }}>Ver entorno</button>
          <a className={`${ui.boton} ${ui.primario}`} href={a.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Abrir aviso ↗</a>
        </div>
      </footer>
    </article>
  );
}

export default function Asistente({ avisoActivo, onAvisos, onAvisoActivo, onVerAviso }: { avisoActivo: number | null; onAvisos: (a: Aviso[]) => void; onAvisoActivo: (id: number) => void; onVerAviso: (a: Aviso) => void }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [cargando, setCargando] = useState(false);
  const [texto, setTexto] = useState('');
  const estado = useRef<unknown>(null);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turnos, cargando]);

  // Enlace con la consulta ya escrita: ?q=departamento+en+cayma
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) void enviar(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar(mensaje: string) {
    const m = mensaje.trim();
    if (!m || cargando) return;
    setTexto('');
    setTurnos((t) => [...t, { quien: 'yo', texto: m }]);
    setCargando(true);
    try {
      const r = await fetch('/api/agente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mensaje: m, estado: estado.current ?? undefined }) });
      const j = await r.json();
      if (j.estado) estado.current = j.estado;
      const avisos: Aviso[] = j.avisos ?? [];
      onAvisos(avisos);
      setTurnos((t) => [...t, { quien: 'agente', avisos, texto: avisos.length ? resumirTexto(j.texto) : (j.texto ?? j.error ?? 'Algo salió mal.'), pregunta: j.tipo === 'pregunta' }]);
    } catch {
      setTurnos((t) => [...t, { quien: 'agente', texto: 'No pude conectar. Intenta de nuevo.' }]);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className={estilos.raiz}>
      <div className={estilos.hilo} aria-live="polite">
        {turnos.length === 0 && (
          <div className={estilos.bienvenida}>
            <h2 className={ui.h2}>¿Qué vivienda buscas?</h2>
            <p className={ui.sub}>Cuéntame el tipo, el distrito, tu presupuesto y qué quieres tener cerca. Te muestro avisos reales con cada criterio medido, su fuente y su fecha.</p>
            <div className={estilos.ejemplos}>
              {EJEMPLOS.map((e) => <button key={e} type="button" onClick={() => void enviar(e)}>{e}</button>)}
            </div>
          </div>
        )}
        {turnos.map((t, i) => (
          <div key={i} className={`${estilos.turno} ${t.quien === 'yo' ? estilos.yo : estilos.agente}`}>
            {t.texto && <p className={estilos.burbuja}>{t.texto}</p>}
            {t.avisos?.map((a, k) => <Tarjeta key={a.id} a={a} n={k + 1} activo={a.id === avisoActivo} onElegir={() => onAvisoActivo(a.id)} onVer={() => onVerAviso(a)} />)}
          </div>
        ))}
        {cargando && <div className={`${estilos.turno} ${estilos.agente}`}><p className={estilos.burbuja} aria-busy="true"><span className={estilos.puntos}><i /><i /><i /></span></p></div>}
        <div ref={fin} />
      </div>
      <form className={estilos.form} onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        <input className={ui.campo} aria-label="Tu consulta" placeholder="Quiero un departamento en Cayma…" value={texto} maxLength={600} onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
        <button type="submit" className={`${ui.boton} ${ui.primario}`} disabled={cargando || !texto.trim()}>Enviar</button>
      </form>
    </div>
  );
}

/** Del texto completo del agente deja solo la frase de encabezado y las notas de pie; las tarjetas ya muestran cada aviso. */
function resumirTexto(t?: string): string | undefined {
  if (!t) return undefined;
  const lineas = t.split('\n');
  const cab = lineas.find((l) => /^Encontré/.test(l));
  const pie = lineas.filter((l) => l && !/^\s/.test(l) && !/^\d+\./.test(l) && !/^Encontré/.test(l));
  return [cab, ...pie].filter(Boolean).join('\n');
}
