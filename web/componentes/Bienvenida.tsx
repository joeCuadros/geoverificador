'use client';
import { useEffect, useRef, useState } from 'react';
import ui from './ui.module.css';
import estilos from './Bienvenida.module.css';

const CLAVE = 'geoverificador.bienvenidaVista';
const PASOS = [
  { t: 'Pregúntale al asistente', d: 'Cuéntale qué vivienda buscas: tipo, distrito, presupuesto y qué quieres tener cerca. Te muestra avisos reales con cada criterio medido, su fuente y su fecha.' },
  { t: 'Toca un punto del mapa', d: 'Mira qué hay a tu alrededor: colegios, salud, paraderos, servicios de la manzana, zonificación y peligros. Cada número dice de dónde sale.' },
  { t: 'Guarda, compara y registra riesgos', d: 'Guarda hasta 3 puntos para compararlos, evalúa los riesgos del predio y descarga o imprime tu reporte.' },
];

/** Introducción de tres pasos, la primera vez. Se puede reabrir desde el botón de ayuda. */
export default function Bienvenida({ abrir, onCerrar }: { abrir: boolean; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [paso, setPaso] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abrir && !d.open) { setPaso(0); d.showModal(); }
    if (!abrir && d.open) d.close();
  }, [abrir]);

  const cerrar = () => {
    try { localStorage.setItem(CLAVE, '1'); } catch { /* sin almacenamiento */ }
    onCerrar();
  };
  const ultimo = paso === PASOS.length - 1;

  return (
    <dialog ref={ref} className={estilos.dialogo} aria-labelledby="bienvenida-t" onClose={cerrar}>
      <p className={ui.tit}>Paso {paso + 1} de {PASOS.length}</p>
      <h2 id="bienvenida-t" className={ui.h2}>{PASOS[paso].t}</h2>
      <p className={estilos.texto}>{PASOS[paso].d}</p>
      <div className={estilos.puntos} aria-hidden="true">{PASOS.map((_, i) => <i key={i} className={i === paso ? estilos.on : undefined} />)}</div>
      <div className={estilos.botones}>
        <button type="button" className={ui.boton} onClick={cerrar}>Saltar</button>
        <button type="button" className={`${ui.boton} ${ui.primario}`} onClick={() => (ultimo ? cerrar() : setPaso(paso + 1))}>{ultimo ? 'Empezar' : 'Siguiente'}</button>
      </div>
    </dialog>
  );
}

export const bienvenidaVista = () => {
  try { return localStorage.getItem(CLAVE) === '1'; } catch { return true; }
};
