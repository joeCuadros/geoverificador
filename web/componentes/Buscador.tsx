'use client';
import { useEffect, useRef, useState } from 'react';
import ui from './ui.module.css';
import estilos from './Buscador.module.css';
import type { Etiquetado } from '../lib/tipos.ts';

interface Candidato { nombre: string; lat: number; lon: number; precisionM: number; categoria: string | null; distrito: string | null; sirveParaMedir: boolean }

export default function Buscador({ onElegir, placeholder = 'Busca un lugar o dirección en Arequipa' }: { onElegir: (p: Etiquetado) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<Candidato[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [activo, setActivo] = useState(-1);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(reloj.current);
    if (q.trim().length < 2) { setLista([]); setNota(null); return; }
    reloj.current = setTimeout(async () => {
      const r = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`).then((x) => x.json()).catch(() => null);
      setLista(r?.candidatos ?? []);
      setNota(r?.nota ?? null);
      setActivo(-1);
    }, 250);
    return () => clearTimeout(reloj.current);
  }, [q]);

  const elegir = (c: Candidato) => {
    setQ(c.nombre);
    setAbierto(false);
    onElegir({ lat: c.lat, lon: c.lon, nombre: c.nombre });
  };

  return (
    <div className={estilos.caja}>
      <input
        className={ui.campo}
        role="combobox"
        aria-expanded={abierto && lista.length > 0}
        aria-controls="resultados-busqueda"
        aria-label="Buscar un lugar"
        placeholder={placeholder}
        value={q}
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, lista.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && lista.length) { e.preventDefault(); elegir(lista[Math.max(activo, 0)]); }
          else if (e.key === 'Escape') setAbierto(false);
        }}
      />
      {abierto && (lista.length > 0 || nota) && (
        <ul id="resultados-busqueda" role="listbox" className={estilos.lista}>
          {lista.map((c, i) => (
            <li key={`${c.nombre}-${i}`} role="option" aria-selected={i === activo} className={i === activo ? estilos.activo : undefined} onMouseDown={() => elegir(c)}>
              <strong>{c.nombre}</strong>
              <span>{[c.categoria, c.distrito].filter(Boolean).join(' · ')}{!c.sirveParaMedir ? ' · zona amplia' : ''}</span>
            </li>
          ))}
          {lista.length === 0 && nota && <li className={estilos.nota}>{nota}</li>}
        </ul>
      )}
    </div>
  );
}
