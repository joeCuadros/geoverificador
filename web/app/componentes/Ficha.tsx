'use client';
import { useEffect, useRef, type MouseEvent } from 'react';
import type { GrupoDeFicha, ItemDeFicha, ReporteDePunto } from '../../lib/reporte.ts';
import '../ficha.css';
import { CuerpoDeItem, DetallesDeGrupo, EstadoChip, MasDeItem } from './FichaPartes.tsx';
import type { EstadoFicha, PuntoElegido } from './tipos.ts';

const grados = (n: number) => n.toFixed(5).replace('.', ',');

function fechaLarga(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-PE', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

/** Lleva a un grupo sin cambiar la dirección de la página y deja el foco en su título, para quien usa lector de pantalla o teclado. */
function irA(e: MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  const seccion = document.getElementById(id);
  if (!seccion) return;
  seccion.scrollIntoView({ block: 'start' });
  seccion.querySelector<HTMLElement>('h3, h2')?.focus({ preventScroll: true });
}

interface PropsItem {
  item: ItemDeFicha;
  activo: boolean;
  sinChipInformativo: boolean;
  onLugar: (id: string) => void;
}

/** Un elemento de la ficha. Si tiene lugar en el mapa, todo él es un solo botón que lo resalta allí; el detalle se despliega aparte. */
function Item({ item, activo, sinChipInformativo, onLugar }: PropsItem) {
  const nombreAccesible = `${item.titulo}${item.nombre ? `: ${item.nombre}` : ''}`;
  return (
    <li className={`f-item${activo ? ' f-item-activo' : ''}`} data-item={item.id} data-lugar={item.lugarId ?? undefined} aria-current={activo ? 'true' : undefined}>
      {item.lugarId ? (
        <button type="button" className="f-item-cuerpo f-item-boton" aria-pressed={activo} aria-label={`Ver en el mapa: ${nombreAccesible}`} onClick={() => onLugar(item.lugarId!)}>
          <CuerpoDeItem item={item} sinChipInformativo={sinChipInformativo} />
        </button>
      ) : (
        <div className="f-item-cuerpo">
          <CuerpoDeItem item={item} sinChipInformativo={sinChipInformativo} />
        </div>
      )}
      <MasDeItem item={item} />
    </li>
  );
}

function Grupo({ grupo, lugarActivo, onLugar }: { grupo: GrupoDeFicha; lugarActivo: string | null; onLugar: (id: string) => void }) {
  const idTitulo = `ficha-g-${grupo.id}-t`;
  return (
    <section id={`ficha-g-${grupo.id}`} className="f-grupo" aria-labelledby={idTitulo}>
      <div className="f-grupo-cab">
        <h3 id={idTitulo} tabIndex={-1}>
          {grupo.titulo}
        </h3>
        {grupo.soloInformativo && <EstadoChip estado="informativo" texto="Solo informativo" />}
      </div>
      {grupo.resumen && <p className="f-grupo-resumen">{grupo.resumen}</p>}
      {grupo.subgrupos.map((s, i) => (
        <div key={s.titulo ?? i} className="f-subgrupo">
          {s.titulo && <h4>{s.titulo}</h4>}
          <ul className="f-items">
            {s.items.map((it) => (
              <Item key={it.id} item={it} activo={Boolean(it.lugarId) && it.lugarId === lugarActivo} sinChipInformativo={s.informativo} onLugar={onLugar} />
            ))}
          </ul>
        </div>
      ))}
      <DetallesDeGrupo items={grupo.subgrupos.flatMap((s) => s.items)} />
    </section>
  );
}

/** Al imprimir se despliega todo lo plegado, y después se deja como estaba. */
function useDesplegarAlImprimir(raiz: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let abiertos: HTMLDetailsElement[] = [];
    const antes = () => {
      const todos = [...(raiz.current?.querySelectorAll('details') ?? [])] as HTMLDetailsElement[];
      abiertos = todos.filter((d) => !d.open);
      for (const d of abiertos) d.open = true;
    };
    const despues = () => {
      for (const d of abiertos) d.open = false;
      abiertos = [];
    };
    window.addEventListener('beforeprint', antes);
    window.addEventListener('afterprint', despues);
    return () => {
      window.removeEventListener('beforeprint', antes);
      window.removeEventListener('afterprint', despues);
    };
  }, [raiz]);
}

function FichaCompleta({ punto, r, lugarActivo, onLugar }: { punto: PuntoElegido; r: ReporteDePunto; lugarActivo: string | null; onLugar: (id: string) => void }) {
  const raiz = useRef<HTMLElement>(null);
  useDesplegarAlImprimir(raiz);
  const navegacion = [...r.grupos.map((g) => ({ id: `ficha-g-${g.id}`, texto: g.corto })), { id: 'ficha-pasos', texto: 'Antes de decidir' }];
  return (
    <article ref={raiz} className="ficha" aria-labelledby="ficha-titulo" data-testid="ficha">
      <header className="f-cabecera">
        <h2 id="ficha-titulo">Ficha del punto</h2>
        <p className="f-sub">
          {punto.etiqueta ? <strong>{punto.etiqueta} · </strong> : null}
          {r.distrito ? `Distrito de ${r.distrito} · ` : ''}
          <span data-testid="ficha-coordenadas">
            {grados(r.punto.lat)}; {grados(r.punto.lon)}
          </span>
        </p>
        <p className="f-fecha">Generada el {fechaLarga(r.generado)}</p>
      </header>

      <section className="f-esencial" aria-labelledby="ficha-esencial">
        <h3 id="ficha-esencial">Lo esencial de este punto</h3>
        <ul>
          {r.esencial.map((e) => {
            const g = r.grupos.find((x) => x.id === e.grupo)!;
            return (
              <li key={e.grupo}>
                <a href={`#ficha-g-${e.grupo}`} onClick={(ev) => irA(ev, `ficha-g-${e.grupo}`)}>
                  <span className="f-esencial-tema">{g.corto}</span>
                  <span className="f-esencial-texto">{e.texto}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="f-aviso" role="note">
        {r.aviso}
      </p>

      <nav className="f-nav" aria-label="Secciones de la ficha">
        <ul>
          {navegacion.map((n) => (
            <li key={n.id}>
              <a href={`#${n.id}`} onClick={(ev) => irA(ev, n.id)}>
                {n.texto}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {r.grupos.map((g) => (
        <Grupo key={g.id} grupo={g} lugarActivo={lugarActivo} onLugar={onLugar} />
      ))}

      <section id="ficha-pasos" className="f-grupo f-pasos" aria-labelledby="ficha-pasos-t">
        <h3 id="ficha-pasos-t" tabIndex={-1}>
          Antes de decidir
        </h3>
        <p className="f-grupo-resumen">Esta ficha es referencial: lo que sigue se comprueba fuera de ella.</p>
        <ul className="f-items">
          {r.pasos.map((p) => (
            <li key={p.id} className="f-item">
              <details className="f-paso">
                <summary>{p.titulo}</summary>
                <p>{p.detalle}</p>
                {p.enlaces.length > 0 && (
                  <ul className="f-lista">
                    {p.enlaces.map((e) => (
                      <li key={e.url}>
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.texto}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="f-grupo f-limites" aria-labelledby="ficha-limites">
        <h3 id="ficha-limites" tabIndex={-1}>
          Lo que conviene tener presente
        </h3>
        <ul className="f-lista">
          {r.limitacionesClave.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <details className="f-mas">
          <summary>Todas las limitaciones ({r.limitaciones.length})</summary>
          <ul className="f-lista">
            {r.limitaciones.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      </section>

      <div className="f-acciones">
        <button type="button" className="boton-secundario" onClick={() => window.print()}>
          Imprimir o guardar en PDF
        </button>
      </div>
    </article>
  );
}

/**
 * La ficha del punto elegido, ordenada por las preguntas de quien busca vivienda: lo esencial primero, cada elemento con su estado (cumple, no cumple, informativo
 * o sin dato), su fuente y la fecha de sus datos a la vista, y el método y los límites desplegables. Los datos vienen de GET /api/ficha (los pide `useFicha`).
 * Cada elemento con lugar en el mapa es un botón que lo resalta allí; el lugar activo se resalta aquí y en el mapa.
 */
export function Ficha({ punto, estado, onReintentar, lugarActivo, onLugar }: { punto: PuntoElegido | null; estado: EstadoFicha; onReintentar: () => void; lugarActivo: string | null; onLugar: (id: string) => void }) {
  // Si el lugar se eligió desde el mapa, su elemento entra en la vista.
  useEffect(() => {
    if (lugarActivo) document.querySelector(`[data-lugar="${CSS.escape(lugarActivo)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lugarActivo]);

  if (!punto || estado.tipo === 'vacio') {
    return (
      <div className="ficha-vacia">
        <h2>Ficha del punto</h2>
        <p>Elige un punto en el mapa para ver qué dicen los datos públicos de ese lugar: haz clic o toca el mapa, busca un lugar por su nombre, usa el centro del mapa o pulsa un aviso del asistente.</p>
      </div>
    );
  }

  const donde = punto.etiqueta ? `${punto.etiqueta} · ` : '';
  if (estado.tipo === 'cargando') {
    return (
      <div className="ficha-estado" role="status">
        <h2>Ficha del punto</h2>
        <p>
          Armando la ficha de {donde}
          {grados(punto.lat)}; {grados(punto.lon)}…
        </p>
      </div>
    );
  }
  if (estado.tipo === 'error') {
    return (
      <div className="ficha-estado" role="alert">
        <h2>Ficha del punto</h2>
        <p className="mensaje-error">{estado.mensaje}</p>
        <button type="button" onClick={onReintentar}>
          Reintentar
        </button>
      </div>
    );
  }
  return <FichaCompleta punto={punto} r={estado.reporte} lugarActivo={lugarActivo} onLugar={onLugar} />;
}
