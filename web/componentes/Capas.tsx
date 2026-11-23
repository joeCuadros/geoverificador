'use client';
import ui from './ui.module.css';
import estilos from './Capas.module.css';
import { capasMeta } from '../lib/capasMeta.ts';

const GRUPOS = ['Ciudad', 'Entorno', 'Peligros'] as const;

export default function Capas({ activas, onCambiar }: { activas: string[]; onCambiar: (ids: string[]) => void }) {
  const alternar = (id: string) => onCambiar(activas.includes(id) ? activas.filter((x) => x !== id) : [...activas, id]);
  return (
    <div>
      {GRUPOS.map((g) => (
        <section key={g} className={ui.tarjeta}>
          <p className={ui.tit}>{g}</p>
          {Object.entries(capasMeta).filter(([, d]) => d.grupo === g).map(([id, d]) => (
            <label key={id} className={estilos.capa}>
              <input type="checkbox" checked={activas.includes(id)} onChange={() => alternar(id)} />
              <span className={estilos.muestra} style={{ background: d.color }} />
              <span className={estilos.texto}>
                <strong>{d.etiqueta}</strong>
                <small>{d.descripcion}</small>
              </span>
            </label>
          ))}
        </section>
      ))}
      <p className={ui.nota}>Las capas de puntos aparecen al acercarte (zoom 14 o más); las manzanas del censo, desde el zoom 15.</p>
    </div>
  );
}
