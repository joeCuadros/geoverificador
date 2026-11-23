'use client';
import ui from './ui.module.css';
import estilos from './Comparar.module.css';
import type { Etiquetado, Ficha } from '../lib/tipos.ts';
import { metros } from '../lib/formato.ts';

export interface Guardado { id: string; punto: Etiquetado; ficha: Ficha }

const FILAS: { clave: string; etiqueta: string }[] = [
  { clave: 'salud', etiqueta: 'Salud' },
  { clave: 'educacion.primaria', etiqueta: 'Colegio primaria' },
  { clave: 'educacion.secundaria', etiqueta: 'Colegio secundaria' },
  { clave: 'transporte', etiqueta: 'Paradero' },
  { clave: 'areaVerde', etiqueta: 'Área verde' },
  { clave: 'compras_ocio', etiqueta: 'Mall' },
  { clave: 'abastecimiento', etiqueta: 'Mercado' },
];
const leer = (o: any, r: string) => r.split('.').reduce((a, k) => (a ? a[k] : undefined), o);

export default function Comparar({ items, onQuitar, onVer }: { items: Guardado[]; onQuitar: (id: string) => void; onVer: (g: Guardado) => void }) {
  if (items.length === 0) {
    return (
      <div className={ui.vacio}>
        <strong>Nada para comparar todavía</strong>
        Elige un punto en el mapa y pulsa «Guardar para comparar». Puedes guardar hasta 3 y verlos lado a lado.
      </div>
    );
  }
  return (
    <div>
      <section className={ui.tarjeta}>
        <div className={estilos.scroll}>
          <table className={estilos.tabla}>
            <thead>
              <tr>
                <th scope="col" />
                {items.map((g, i) => (
                  <th scope="col" key={g.id}>
                    <button type="button" className={estilos.nombre} onClick={() => onVer(g)}>{String.fromCharCode(65 + i)}. {g.punto.nombre ?? 'Punto'}</button>
                    <button type="button" className={estilos.quitar} aria-label={`Quitar ${g.punto.nombre ?? 'punto'}`} onClick={() => onQuitar(g.id)}>×</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Distrito</th>
                {items.map((g) => <td key={g.id}>{g.ficha.distrito?.nombre ?? '—'}</td>)}
              </tr>
              <tr>
                <th scope="row">Zonificación</th>
                {items.map((g) => <td key={g.id}>{g.ficha.zona?.codigo ?? '—'}</td>)}
              </tr>
              {FILAS.map((f) => {
                const vals = items.map((g) => leer(g.ficha.entorno, f.clave)?.distanciaM as number | null | undefined);
                const mejor = Math.min(...vals.filter((v): v is number => typeof v === 'number'));
                return (
                  <tr key={f.clave}>
                    <th scope="row">{f.etiqueta}</th>
                    {vals.map((v, i) => <td key={items[i].id} className={v === mejor && items.length > 1 ? estilos.mejor : undefined}>{v == null ? '—' : metros(v)}</td>)}
                  </tr>
                );
              })}
              <tr>
                <th scope="row">Luz</th>
                {items.map((g) => <td key={g.id}>{g.ficha.entorno.censo?.luz?.pct != null ? `${Math.round(g.ficha.entorno.censo.luz.pct)} %` : '—'}</td>)}
              </tr>
              <tr>
                <th scope="row">Agua</th>
                {items.map((g) => <td key={g.id}>{g.ficha.entorno.censo?.agua?.pct != null ? `${Math.round(g.ficha.entorno.censo.agua.pct)} %` : '—'}</td>)}
              </tr>
              <tr>
                <th scope="row">Peligros a 500 m</th>
                {items.map((g) => <td key={g.id}>{g.ficha.peligros.length}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className={ui.nota}>En verde, la distancia más corta de cada fila. No hay un puntaje total: tú decides qué pesa más. «—» significa sin dato, no cero.</p>
      </section>
      <button type="button" className={ui.boton} onClick={() => window.print()}>Imprimir comparación</button>
    </div>
  );
}
