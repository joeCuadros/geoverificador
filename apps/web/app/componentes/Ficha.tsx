'use client';
import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import type { GrupoDeFicha, ItemDeFicha, ReporteDePunto } from '../../lib/reporte.ts';
import '../ficha.css';
import { ConteoDeGrupo, CuerpoDeItem, DetallesDeGrupo, EstadoChip, MasDeItem } from './FichaPartes.tsx';
import type { EstadoFicha, PuntoElegido } from './tipos.ts';

/** Un punto como «-16.39883, -71.53697»: latitud y longitud con punto decimal (es-PE), separadas por coma. */
const coordenadas = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

const AVISO_PESTANA_NUEVA = ' (abre en otra pestaña)';

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

/**
 * Un elemento de la ficha. Si tiene lugar en el mapa, todo él es un solo botón que lo resalta allí; el detalle se despliega aparte.
 * El nombre del botón es corto («Ver en el mapa: …») y el estado, la distancia y la fuente le llegan como descripción, para que quien usa lector de pantalla los oiga también.
 */
function Item({ item, activo, sinChipInformativo, onLugar }: PropsItem) {
  const nombreAccesible = `${item.titulo}${item.nombre ? `: ${item.nombre}` : ''}`;
  const idDatos = `ficha-i-${item.id}-datos`;
  const cuerpo = (
    <span id={idDatos} className="f-item-datos">
      <CuerpoDeItem item={item} sinChipInformativo={sinChipInformativo} />
    </span>
  );
  return (
    <li className={`f-item${activo ? ' f-item-activo' : ''}`} data-item={item.id} data-estado={item.estado ?? undefined} data-lugar={item.lugarId ?? undefined} aria-current={activo ? 'true' : undefined}>
      {item.lugarId ? (
        <button type="button" className="f-item-cuerpo f-item-boton" aria-pressed={activo} aria-label={`Ver en el mapa: ${nombreAccesible}`} aria-describedby={idDatos} onClick={() => onLugar(item.lugarId!)}>
          {cuerpo}
        </button>
      ) : (
        <div className="f-item-cuerpo">{cuerpo}</div>
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
      {grupo.resumen && <p className="f-prosa f-grupo-resumen">{grupo.resumen}</p>}
      <ConteoDeGrupo conteo={grupo.conteo} />
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

/**
 * Cuando la ficha aparece y el foco se quedó sin lugar (se pulsó un botón del asistente que ya no se ve, o «Reintentar», que desapareció), lo lleva al título de la ficha
 * para que quien usa teclado o lector de pantalla empiece a leer ahí. Si el foco está en otro control visible (el mapa, el botón del centro), no se lo quita.
 */
function useEnfocarAlAbrir(titulo: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const a = document.activeElement as HTMLElement | null;
    const perdido = !a || a === document.body || !a.isConnected || a.getClientRects().length === 0;
    if (perdido) titulo.current?.focus();
  }, [titulo]);
}

function FichaCompleta({ punto, r, lugarActivo, onLugar }: { punto: PuntoElegido; r: ReporteDePunto; lugarActivo: string | null; onLugar: (id: string) => void }) {
  const raiz = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  useDesplegarAlImprimir(raiz);
  useEnfocarAlAbrir(titulo);
  const navegacion = [...r.grupos.map((g) => ({ id: `ficha-g-${g.id}`, texto: g.corto })), { id: 'ficha-pasos', texto: 'Qué comprobar' }, { id: 'ficha-limites', texto: 'Límites' }];
  return (
    <article ref={raiz} className="ficha" aria-labelledby="ficha-titulo" data-testid="ficha">
      <header className="f-cabecera">
        <h2 id="ficha-titulo" ref={titulo} tabIndex={-1}>
          Ficha del punto
        </h2>
        <p className="f-sub">
          {punto.etiqueta ? <strong>{punto.etiqueta} · </strong> : null}
          {r.distrito ? `Distrito de ${r.distrito} · ` : ''}
          <span data-testid="ficha-coordenadas">
            {coordenadas(r.punto.lat, r.punto.lon)}
          </span>
        </p>
        <p className="f-fecha">
          Generada el <time dateTime={r.generado}>{fechaLarga(r.generado)}</time>
          <span className="f-fecha-nota">Cada dato dice su fuente y la fecha de sus datos.</span>
        </p>
      </header>

      <section className="f-esencial" aria-labelledby="ficha-esencial">
        <h3 id="ficha-esencial">Lo esencial de este punto</h3>
        <p className="f-esencial-nota">Cada línea resume un grupo y cuenta cuántas distancias de referencia quedan dentro de la referencia, fuera de ella o sin dato.</p>
        <ul>
          {r.esencial.map((e) => {
            const g = r.grupos.find((x) => x.id === e.grupo)!;
            return (
              <li key={e.grupo}>
                <a href={`#ficha-g-${e.grupo}`} onClick={(ev) => irA(ev, `ficha-g-${e.grupo}`)}>
                  <span className="f-esencial-frase">
                    <span className="f-esencial-tema">{g.corto}</span> <span className="f-esencial-texto">{e.texto}</span>
                  </span>
                  <ConteoDeGrupo conteo={g.conteo} />
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="f-prosa f-aviso" role="note">
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
          Qué comprobar antes de decidir
        </h3>
        <p className="f-prosa f-grupo-resumen">Esta ficha es referencial: lo que sigue se comprueba fuera de ella.</p>
        <ul className="f-items">
          {r.pasos.map((p) => (
            <li key={p.id} className="f-item">
              <details className="f-paso">
                <summary>{p.titulo}</summary>
                <p className="f-prosa">{p.detalle}</p>
                {p.enlaces.length > 0 && (
                  <ul className="f-lista">
                    {p.enlaces.map((e) => (
                      <li key={e.url}>
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.texto}
                          <span className="solo-lectores">{AVISO_PESTANA_NUEVA}</span>
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
          Límites de estos datos
        </h3>
        <ul className="f-lista">
          {r.limitacionesClave.map((l, i) => (
            <li key={i} className="f-prosa">{l}</li>
          ))}
        </ul>
        <details className="f-mas">
          <summary>Todos los límites ({r.limitaciones.length})</summary>
          <ul className="f-lista">
            {r.limitaciones.map((l, i) => (
              <li key={i} className="f-prosa">{l}</li>
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
 * La ficha del punto elegido, ordenada por las preguntas de quien busca vivienda: lo esencial primero, cada elemento con su estado (dentro de la referencia, fuera de ella,
 * informativo o sin dato), su fuente y la fecha de sus datos a la vista, y el método y los límites desplegables. Los datos vienen de GET /api/ficha (los pide `useFicha`).
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
        <p className="f-prosa">Elige un punto en el mapa para ver qué dicen los datos públicos de ese lugar: haz clic o toca el mapa, busca un lugar por su nombre, usa el centro del mapa o pulsa un aviso del asistente.</p>
      </div>
    );
  }

  const donde = punto.etiqueta ? `${punto.etiqueta} · ` : '';
  const lugar = `${donde}${coordenadas(punto.lat, punto.lon)}`;
  // El anuncio vive fuera de los estados para que el lector de pantalla lo diga al pasar de uno a otro (un aviso que aparece ya armado no siempre se lee).
  const anuncio = estado.tipo === 'cargando' ? `Armando la ficha de ${lugar}.` : estado.tipo === 'listo' ? `La ficha de ${lugar} está lista.` : '';
  return (
    <>
      <p role="status" className="solo-lectores">
        {anuncio}
      </p>
      {estado.tipo === 'cargando' ? (
        <div className="ficha-estado" aria-busy="true">
          <h2>Ficha del punto</h2>
          <p className="f-prosa">Armando la ficha de {lugar}…</p>
        </div>
      ) : estado.tipo === 'error' ? (
        <div className="ficha-estado" role="alert">
          <h2>Ficha del punto</h2>
          <p className="mensaje-error">{estado.mensaje}</p>
          <p className="f-prosa">Pulsa Reintentar o elige otro punto en el mapa.</p>
          <button type="button" onClick={onReintentar}>
            Reintentar
          </button>
        </div>
      ) : (
        <FichaCompleta punto={punto} r={estado.reporte} lugarActivo={lugarActivo} onLugar={onLugar} />
      )}
    </>
  );
}
