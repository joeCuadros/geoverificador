'use client';
import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import type { GrupoDeFicha, ItemDeFicha, ReporteDePunto } from '../../lib/reporte.ts';
import '../ficha.css';
import { ConteoCorto, ConteoDeGrupo, CuerpoDeItem, DetallesDeGrupo, EstadoChip, MarcaDeEstado, MasDeItem, estadoDeGrupo } from './FichaPartes.tsx';
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

/**
 * Lleva a un tema sin cambiar la dirección de la página: lo despliega (los temas se abren de a uno) y deja el foco en su fila, para quien usa lector de pantalla
 * o teclado.
 */
function irA(e: MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  const seccion = document.getElementById(id);
  if (!seccion) return;
  if (seccion instanceof HTMLDetailsElement) seccion.open = true;
  seccion.scrollIntoView({ block: 'start' });
  seccion.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
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

/**
 * Un tema de la ficha, plegado: la fila dice su estado, su nombre, su resumen y cuántas distancias de referencia quedan dentro. Al desplegarlo (de a uno: los
 * `details` comparten nombre) aparecen sus datos, cada uno con su estado, su distancia, su barra y su fuente; el método y los límites quedan plegados aparte.
 */
function Grupo({ grupo, lugarActivo, onLugar }: { grupo: GrupoDeFicha; lugarActivo: string | null; onLugar: (id: string) => void }) {
  const idTitulo = `ficha-g-${grupo.id}-t`;
  const estado = estadoDeGrupo(grupo.conteo);
  return (
    <details id={`ficha-g-${grupo.id}`} className="f-tema" name="ficha-temas" data-estado={estado}>
      <summary>
        <MarcaDeEstado estado={estado} />
        <span className="f-tema-textos">
          <span id={idTitulo} className="f-tema-titulo">
            {grupo.titulo}
          </span>
          {grupo.resumen && <span className="f-tema-resumen">{grupo.resumen}</span>}
        </span>
        <ConteoCorto conteo={grupo.conteo} />
        <span className="f-tema-flecha" aria-hidden="true" />
      </summary>
      <div className="f-tema-cuerpo">
        {grupo.soloInformativo ? <EstadoChip estado="informativo" texto="Solo informativo" /> : <ConteoDeGrupo conteo={grupo.conteo} />}
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
      </div>
    </details>
  );
}

/** Cuántas distancias de referencia de toda la ficha quedan dentro, fuera o sin dato: una línea de pastillas bajo el título, sin total ni puntaje. */
function RecuentoTotal({ grupos }: { grupos: GrupoDeFicha[] }) {
  const t = grupos.reduce((a, g) => ({ cumple: a.cumple + g.conteo.cumple, noCumple: a.noCumple + g.conteo.noCumple, sinDato: a.sinDato + g.conteo.sinDato }), { cumple: 0, noCumple: 0, sinDato: 0 });
  if (!t.cumple && !t.noCumple && !t.sinDato) return null;
  return (
    <p className="f-recuento" data-testid="ficha-recuento">
      <span className="solo-lectores">Distancias de referencia de esta ficha: </span>
      <EstadoChip estado="cumple" texto={`${t.cumple} dentro`} />
      <EstadoChip estado="no_cumple" texto={`${t.noCumple} fuera`} />
      <EstadoChip estado="sin_dato" texto={`${t.sinDato} sin dato`} />
    </p>
  );
}

/** Al imprimir se despliega todo lo plegado, y después se deja como estaba. */
function useDesplegarAlImprimir(raiz: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let abiertos: HTMLDetailsElement[] = [];
    let agrupados: [HTMLDetailsElement, string][] = [];
    const antes = () => {
      const todos = [...(raiz.current?.querySelectorAll('details') ?? [])] as HTMLDetailsElement[];
      // Los temas se abren de a uno (comparten `name`): para imprimir se sueltan del grupo, si no solo quedaría abierto el último.
      agrupados = todos.filter((d) => d.name).map((d) => [d, d.name]);
      for (const [d] of agrupados) d.removeAttribute('name');
      abiertos = todos.filter((d) => !d.open);
      for (const d of abiertos) d.open = true;
    };
    const despues = () => {
      for (const d of abiertos) d.open = false;
      for (const [d, nombre] of agrupados) d.name = nombre;
      abiertos = [];
      agrupados = [];
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
  const lugar = punto.etiqueta ?? (r.distrito ? `Un punto en ${r.distrito}` : 'Punto elegido en el mapa');
  return (
    <article ref={raiz} className="ficha" aria-labelledby="ficha-titulo" data-testid="ficha">
      <header className="f-cabecera">
        <h2 id="ficha-titulo" ref={titulo} tabIndex={-1}>
          <span className="f-sobretitulo">Ficha del punto</span> <span className="f-lugar">{lugar}</span>
        </h2>
        <p className="f-sub">
          {r.distrito ? `Distrito de ${r.distrito} · ` : ''}
          <span data-testid="ficha-coordenadas">
            {coordenadas(r.punto.lat, r.punto.lon)}
          </span>
        </p>
        <RecuentoTotal grupos={r.grupos} />
        <p className="f-fecha">
          Generada el <time dateTime={r.generado}>{fechaLarga(r.generado)}</time>. Cada dato dice su fuente y la fecha de sus datos.
        </p>
      </header>

      {/* Primera capa: lo esencial, una frase por tema; cada una abre su tema. */}
      <section className="f-esencial" aria-labelledby="ficha-esencial">
        <h3 id="ficha-esencial">En pocas palabras</h3>
        <ul>
          {r.esencial.map((e) => {
            const g = r.grupos.find((x) => x.id === e.grupo)!;
            return (
              <li key={e.grupo}>
                <a href={`#ficha-g-${e.grupo}`} onClick={(ev) => irA(ev, `ficha-g-${e.grupo}`)}>
                  <MarcaDeEstado estado={estadoDeGrupo(g.conteo)} />
                  <span className="f-esencial-frase">
                    <span className="f-esencial-tema">{g.corto}:</span> <span className="f-esencial-texto">{e.texto}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="f-prosa f-aviso" role="note">
        {r.aviso}
      </p>

      {/* Segunda capa: los temas, plegados y de a uno. */}
      <section className="f-temas" aria-labelledby="ficha-temas">
        <h3 id="ficha-temas">Por tema</h3>
        {r.grupos.map((g) => (
          <Grupo key={g.id} grupo={g} lugarActivo={lugarActivo} onLugar={onLugar} />
        ))}
      </section>

      {/* Tercera capa: lo que se comprueba fuera de la ficha y los límites de los datos. */}
      <section className="f-temas" aria-labelledby="ficha-antes">
        <h3 id="ficha-antes">Antes de decidir</h3>
      <details id="ficha-pasos" className="f-tema f-pasos" name="ficha-temas">
        <summary>
          <MarcaDeEstado estado="informativo" />
          <span className="f-tema-textos">
            <span className="f-tema-titulo">Qué comprobar antes de decidir</span>
            <span className="f-tema-resumen">Esta ficha es referencial: lo que sigue se comprueba fuera de ella.</span>
          </span>
          <span className="f-conteo-corto">{r.pasos.length} pasos</span>
          <span className="f-tema-flecha" aria-hidden="true" />
        </summary>
        <div className="f-tema-cuerpo">
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
        </div>
      </details>

      <details id="ficha-limites" className="f-tema f-limites" name="ficha-temas">
        <summary>
          <MarcaDeEstado estado="informativo" />
          <span className="f-tema-textos">
            <span className="f-tema-titulo">Límites de estos datos</span>
            <span className="f-tema-resumen">Lo que esta ficha no puede decir.</span>
          </span>
          <span className="f-tema-flecha" aria-hidden="true" />
        </summary>
        <div className="f-tema-cuerpo">
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
        </div>
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
  // Si el lugar se eligió desde el mapa, su tema se despliega y su elemento entra en la vista.
  useEffect(() => {
    if (!lugarActivo) return;
    const fila = document.querySelector<HTMLElement>(`[data-lugar="${CSS.escape(lugarActivo)}"]`);
    const tema = fila?.closest('details.f-tema');
    if (tema instanceof HTMLDetailsElement && !tema.open) tema.open = true;
    fila?.scrollIntoView({ block: 'nearest' });
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
