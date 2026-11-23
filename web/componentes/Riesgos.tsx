'use client';
import { useEffect, useMemo, useState } from 'react';
import Riesgos from '@geoverificador/dominio/nucleo/riesgos';
import ui from './ui.module.css';
import estilos from './Riesgos.module.css';
import type { Ficha, Etiquetado } from '../lib/tipos.ts';
import type { Contexto } from '../lib/contexto.ts';

interface Evaluacion { p?: number; i?: number; decision?: number; hechas?: number[] }
type Registro = Record<string, Evaluacion>;

const claseNivel = (cls?: string) => (cls === 'alto' ? ui.mal : cls === 'medio' ? ui.aviso : cls === 'bajo' ? ui.ok : ui.info);

function Escala({ valor, onCambiar, etiqueta }: { valor?: number; onCambiar: (v: number) => void; etiqueta: string }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className={estilos.escala}>
      {(Riesgos.ESCALA as { v: number; texto: string }[]).map((e) => (
        <button key={e.v} type="button" role="radio" aria-checked={valor === e.v} className={valor === e.v ? estilos.sel : undefined} onClick={() => onCambiar(e.v)}>{e.texto}</button>
      ))}
    </div>
  );
}

export default function PanelRiesgos({ punto, ficha, contexto, cargandoContexto }: { punto: Etiquetado | null; ficha: Ficha | null; contexto: Contexto | null; cargandoContexto: boolean }) {
  const [ev, setEv] = useState<Registro>({});
  const [filtro, setFiltro] = useState('Todos');
  const [lote, setLote] = useState('');

  useEffect(() => {
    if (!punto) return;
    try { setEv(Riesgos.leerEvaluacion(punto.lat, punto.lon) ?? {}); } catch { setEv({}); }
  }, [punto]);

  const riesgos = useMemo(() => {
    if (!ficha) return [];
    const n = Number(lote);
    return (Riesgos.identificar({
      zonaStatus: ficha.zona ? 'ok' : 'outside',
      zona: ficha.zona ? { codigo: ficha.zona.codigo, regla: ficha.zona.regla } : null,
      lote: n > 0 ? n : null,
      peligro: contexto?.peligro ?? null,
      distrito: contexto?.distrito ?? null,
      delito: contexto?.delito ?? null,
    }) as any[]);
  }, [ficha, contexto, lote]);

  const cambiar = (id: string, parte: Partial<Evaluacion>) => {
    if (!punto) return;
    const nuevo = { ...ev, [id]: { ...ev[id], ...parte } };
    setEv(nuevo);
    try { Riesgos.guardarEvaluacion(punto.lat, punto.lon, nuevo); } catch { /* sin almacenamiento */ }
  };

  if (!punto) return <div className={ui.vacio}><strong>Elige un punto primero</strong>El registro de riesgos se arma con los datos del punto: zonificación, peligros, zona sísmica y denuncias.</div>;
  if (!ficha) return <section className={ui.tarjeta} aria-busy="true"><div className={ui.esqueleto} style={{ width: '70%' }} /></section>;

  const categorias = ['Todos', ...new Set(riesgos.map((r) => r.categoria as string))];
  const evaluados = riesgos.filter((r) => Riesgos.nivel(ev[r.id]?.p, ev[r.id]?.i));
  const altos = evaluados.filter((r) => Riesgos.nivel(ev[r.id].p, ev[r.id].i)?.texto === 'Alto').length;
  const visibles = riesgos.filter((r) => filtro === 'Todos' || r.categoria === filtro);

  const descargar = () => {
    const csv = Riesgos.registroCsv(riesgos, ev, punto);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `registro-de-riesgos-${punto.lat.toFixed(4)}_${punto.lon.toFixed(4)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <section className={ui.tarjeta}>
        <p className={ui.tit}>Registro de riesgos del predio</p>
        <p className={ui.sub}>La herramienta identifica cada riesgo con un dato y su fuente. La probabilidad y el impacto los pones tú: no hay datos para asignarlos por ti.</p>
        <div className={estilos.kpis}>
          <div><b>{riesgos.length}</b><span>identificados</span></div>
          <div><b>{evaluados.length}</b><span>evaluados por ti</span></div>
          <div className={altos ? estilos.alto : undefined}><b>{altos}</b><span>de nivel alto</span></div>
        </div>
        <label className={estilos.lote}>Tamaño del lote (m²), si lo sabes
          <input className={ui.campo} inputMode="numeric" value={lote} onChange={(e) => setLote(e.target.value.replace(/[^\d]/g, ''))} placeholder="Ej. 120" />
        </label>
        {cargandoContexto && <p className={ui.nota} aria-busy="true">Cargando denuncias, peligros y zona sísmica…</p>}
      </section>

      <div className={estilos.filtros} role="group" aria-label="Filtrar por tipo de riesgo">
        {categorias.map((c) => (
          <button key={c} type="button" aria-pressed={filtro === c} onClick={() => setFiltro(c)}>{c}</button>
        ))}
      </div>

      {visibles.map((r) => {
        const e = ev[r.id] ?? {};
        const n = Riesgos.nivel(e.p, e.i);
        const hechas = (e.hechas ?? []).filter((k) => k < r.acciones.length).length;
        return (
          <article key={r.id} className={`${ui.tarjeta} ${estilos.riesgo}`}>
            <header className={estilos.cab}>
              <div>
                <p className={estilos.tag}>{r.categoria} · {r.id}</p>
                <h3>{r.titulo}</h3>
              </div>
              <span className={`${ui.chip} ${claseNivel(n?.cls)}`}>{n ? `Nivel ${String(n.texto).toLowerCase()}` : 'Sin evaluar'}</span>
            </header>
            <p className={estilos.evidencia}>{r.evidencia}</p>
            <p className={ui.nota}>Fuente del dato: {r.fuente}</p>
            <div className={estilos.eval}>
              <div><span>Probabilidad</span><Escala etiqueta={`Probabilidad de ${r.titulo}`} valor={e.p} onCambiar={(v) => cambiar(r.id, { p: v })} /></div>
              <div><span>Impacto</span><Escala etiqueta={`Impacto de ${r.titulo}`} valor={e.i} onCambiar={(v) => cambiar(r.id, { i: v })} /></div>
            </div>
            <details className={estilos.acciones}>
              <summary>Qué hacer · {hechas} de {r.acciones.length} hechas</summary>
              <ul>
                {r.acciones.map((a: { texto: string; fuente: string }, k: number) => (
                  <li key={k}>
                    <label>
                      <input type="checkbox" checked={(e.hechas ?? []).includes(k)} onChange={(x) => cambiar(r.id, { hechas: x.target.checked ? [...(e.hechas ?? []), k] : (e.hechas ?? []).filter((h) => h !== k) })} />
                      <span>{a.texto}<small>{a.fuente}</small></span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className={estilos.decision}>Mi decisión
                <select value={e.decision ?? ''} onChange={(x) => cambiar(r.id, { decision: x.target.value === '' ? undefined : Number(x.target.value) })}>
                  <option value="">Sin decidir</option>
                  {(Riesgos.DECISIONES as string[]).map((t, k) => <option key={k} value={k}>{t}</option>)}
                </select>
              </label>
            </details>
          </article>
        );
      })}
      <div className={estilos.pie}>
        <button type="button" className={ui.boton} onClick={descargar}>Descargar registro (CSV)</button>
        <button type="button" className={ui.boton} onClick={() => window.print()}>Imprimir reporte</button>
      </div>
      <p className={ui.nota}>El registro se guarda solo en este navegador. No es asesoría legal ni técnica: confirma con un Certificado de Zonificación y Vías y con un profesional.</p>
    </div>
  );
}
