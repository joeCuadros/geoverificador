'use client';
import type { EstadoDeItem, ItemDeFicha, Referencia } from '../../lib/reporte.ts';

const ETIQUETA: Record<EstadoDeItem, string> = { cumple: 'Cumple', no_cumple: 'No cumple', informativo: 'Informativo', sin_dato: 'Sin dato' };

/** El estado de un dato: icono, texto y color a la vez (el color nunca es lo único que informa). Informativo y sin dato no se parecen a un veredicto. */
export function EstadoChip({ estado, texto }: { estado: EstadoDeItem; texto?: string }) {
  return (
    <span className={`estado estado-${estado}`}>
      <svg className="estado-icono" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        {estado === 'cumple' && (
          <>
            <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M6.2 10.4l2.6 2.6 5-5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {estado === 'no_cumple' && (
          <>
            <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </>
        )}
        {estado === 'informativo' && (
          <>
            <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 9v5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="10" cy="6.4" r="1.1" fill="currentColor" />
          </>
        )}
        {estado === 'sin_dato' && (
          <>
            <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.6" />
            <path d="M7.8 7.9a2.3 2.3 0 114 1.5c-.8.7-1.8 1.1-1.8 2.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="10" cy="14.4" r="1" fill="currentColor" />
          </>
        )}
      </svg>
      {texto ?? ETIQUETA[estado]}
    </span>
  );
}

/**
 * Dónde queda la distancia respecto de la distancia de referencia: una barra que se llena hasta el doble de la referencia, con una marca en la referencia.
 * Es una ayuda visual; el valor y la referencia están siempre escritos.
 */
export function Medidor({ referencia, estado, distancia }: { referencia: Referencia; estado: EstadoDeItem; distancia: string }) {
  if (referencia.proporcion === null) return null;
  return (
    <span className="medidor" role="img" aria-label={`${distancia}; referencia ${referencia.texto}`}>
      <span className={`medidor-relleno medidor-${estado}`} style={{ width: `${Math.max(referencia.proporcion * 100, 2)}%` }} />
      <span className="medidor-marca" style={{ left: `${referencia.marca * 100}%` }} />
    </span>
  );
}

/** Un icono de mapa: indica que el elemento se puede ver en el mapa. */
function IconoMapa() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M10 18s6-5.2 6-9.6A6 6 0 004 8.4C4 12.8 10 18 10 18z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="10" cy="8.4" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

/** La fuente y la fecha de los datos, en una línea corta junto a la cifra. */
export function Fuente({ fuente }: { fuente: ItemDeFicha['fuente'] }) {
  return (
    <span className="f-fuente">
      {fuente.texto}
      {' · '}
      {fuente.fecha ? `datos del ${fuente.fecha}` : 'sin fecha en la base'}
    </span>
  );
}

/** El contenido de un elemento: lo mismo dentro de un botón (si tiene lugar en el mapa) que dentro de un bloque. */
export function CuerpoDeItem({ item, sinChipInformativo = false }: { item: ItemDeFicha; sinChipInformativo?: boolean }) {
  const sinDistancia = !item.distancia;
  return (
    <>
      <span className="f-fila">
        {item.estado && !(sinChipInformativo && item.estado === 'informativo') && <EstadoChip estado={item.estado} />}
        <span className="f-titulo">{item.titulo}</span>
        {item.distancia && <span className="f-distancia">{item.distancia.texto}</span>}
      </span>
      {item.nombre && <span className="f-nombre">{item.nombre}</span>}
      {sinDistancia && <span className="f-texto">{item.resumen}</span>}
      {item.referencia && item.estado && item.estado !== 'sin_dato' && item.distancia && (
        <span className="f-referencia">
          <Medidor referencia={item.referencia} estado={item.estado} distancia={item.distancia.texto} />
          <span className="f-referencia-texto">Referencia: {item.referencia.texto}</span>
        </span>
      )}
      {item.criterios && (
        <span className="f-criterios">
          {item.criterios.map((c) => (
            <span key={c.etiqueta} className="f-criterio">
              <EstadoChip estado={c.estado} />
              <span className="f-criterio-etiqueta">{c.etiqueta}</span>
              {c.referencia && <span className="f-criterio-ref">{c.estado === 'sin_dato' ? `referencia ${c.referencia.texto}` : c.referencia.texto}</span>}
              {item.distancia && c.referencia && c.estado !== 'sin_dato' && <Medidor referencia={c.referencia} estado={c.estado} distancia={item.distancia.texto} />}
            </span>
          ))}
        </span>
      )}
      {item.datos.length > 0 && (
        <span className="f-datos">
          {item.datos.map((d) => (
            <span key={d.etiqueta} className="f-dato">
              <span className="f-dato-etiqueta">{d.etiqueta}:</span> {d.valor}
            </span>
          ))}
        </span>
      )}
      <Fuente fuente={item.fuente} />
      {item.lugarId && (
        <span className="f-ver" aria-hidden="true">
          <IconoMapa /> Ver en el mapa
        </span>
      )}
    </>
  );
}

/** Lo que se despliega de un elemento: el detalle propio (escenarios, otros registros, recorridos). */
export function MasDeItem({ item }: { item: ItemDeFicha }) {
  if (!item.detalle) return null;
  return (
    <details className="f-mas">
      <summary>{item.detalle.titulo}</summary>
      <ul className="f-lista">
        {item.detalle.lineas.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Cómo se calculó cada dato del grupo y qué no dice, en un solo desplegable por grupo: los textos repetidos (la nota de todo el comercio, por ejemplo) salen una vez.
 * La fuente y la fecha no están aquí: están siempre a la vista junto a cada cifra.
 */
export function DetallesDeGrupo({ items }: { items: ItemDeFicha[] }) {
  const vistoMetodo = new Set<string>();
  const vistoLimite = new Set<string>();
  const bloques = items
    .map((it) => {
      const metodo = it.metodo && !vistoMetodo.has(it.metodo) ? it.metodo : null;
      const noDice = it.noDice && !vistoLimite.has(it.noDice) ? it.noDice : null;
      if (metodo) vistoMetodo.add(metodo);
      if (noDice) vistoLimite.add(noDice);
      const origen = it.referencia?.origen ?? it.criterios?.find((c) => c.referencia?.origen)?.referencia?.origen ?? null;
      return { it, metodo, noDice, origen };
    })
    .filter((b) => b.metodo || b.noDice || b.origen);
  if (!bloques.length) return null;
  return (
    <details className="f-mas f-mas-grupo">
      <summary>Cómo se calculó y qué no dicen estos datos</summary>
      {bloques.map(({ it, metodo, noDice, origen }) => (
        <div key={it.id} className="f-mas-bloque">
          <h5>{it.titulo}</h5>
          {metodo && (
            <p>
              <strong>Cómo se calculó.</strong> {metodo}
            </p>
          )}
          {origen && (
            <p>
              <strong>Origen de la referencia.</strong> {origen}.
            </p>
          )}
          {noDice && (
            <p>
              <strong>Qué no dice.</strong> {noDice}
            </p>
          )}
        </div>
      ))}
    </details>
  );
}
