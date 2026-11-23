'use client';
import { useEffect, useId, useState } from 'react';
import type { Ajuste } from '@geoverificador/agente/agente';
import { partirEnlaces } from '../../lib/enlaces.ts';
import { enlaceSeguro, type Marcador } from '../../lib/marcadores.ts';
import type { Referencia } from '../../lib/reporte.ts';
import type { Envio, RespuestaApi } from './chat-tipos.ts';
import { EstadoChip, Medidor } from './FichaPartes.tsx';
import { IconoAlerta, IconoChevron, IconoCerrar, IconoEnlace, IconoEntorno, IconoFlecha, IconoInfo, IconoMapa, IconoOrden } from './Iconos.tsx';

type Sugerencia = RespuestaApi['sugerencias'][number];
type Chip = RespuestaApi['entendido'][number];
type Tarjeta = NonNullable<RespuestaApi['resultados']>['tarjetas'][number];

/** Un texto con sus enlaces http(s) como enlaces y sin tocar el HTML. */
export function Texto({ texto }: { texto: string }) {
  return (
    <>
      {partirEnlaces(texto).map((p, i) =>
        p.tipo === 'enlace' ? (
          <a key={i} href={p.valor} target="_blank" rel="noopener noreferrer">
            {p.valor}
          </a>
        ) : (
          <span key={i}>{p.valor}</span>
        ),
      )}
    </>
  );
}

/** Las líneas con las que el asistente dice qué tomó, qué corrigió o qué no usó: aclaraciones, no la respuesta. */
const ES_ACLARACION = /^(Tomé como |No tengo datos de|No usé «|Entendí «)/;

/**
 * La respuesta en palabras. Cuando trae resultados, lo que el asistente aclara de su trabajo («Tomé como lugar…», «Entendí…») baja a una línea más discreta y la
 * frase que dice qué encontró queda como lo principal. El texto es el mismo, solo se ordena a la vista.
 */
export function Narracion({ texto, ordenar }: { texto: string; ordenar: boolean }) {
  const lineas = ordenar ? texto.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  if (lineas.length < 2) return <Texto texto={texto} />;
  return (
    <>
      {lineas.map((l, i) =>
        ES_ACLARACION.test(l) ? (
          <span key={i} className="linea linea-aclaracion">
            <IconoInfo />
            <span>
              <Texto texto={l} />
            </span>
          </span>
        ) : (
          <span key={i} className="linea">
            <Texto texto={l} />
          </span>
        ),
      )}
    </>
  );
}

const enviarDe = (s: Sugerencia): Envio => ({ mensaje: s.mensaje ?? s.texto, ajuste: s.ajuste as Ajuste | undefined });

// ------------------------------------------------------------------ Respuestas rápidas

export function Sugerencias({ lista, titulo, deshabilitado, onEnviar }: { lista: Sugerencia[]; titulo: string; deshabilitado: boolean; onEnviar: (e: Envio) => void }) {
  if (lista.length === 0) return null;
  return (
    <div className="sugerencias" role="group" aria-label={titulo}>
      <ul>
        {lista.map((s, i) => (
          <li key={`${s.texto}-${i}`}>
            <button type="button" className={`sugerencia sugerencia-${s.rol}`} disabled={deshabilitado} onClick={() => onEnviar(enviarDe(s))}>
              <span>{s.texto}</span>
              {s.rol === 'ejemplo' && <IconoFlecha />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ Lo que se entendió

function ChipEntendido({ chip, deshabilitado, onEnviar }: { chip: Chip; deshabilitado: boolean; onEnviar: (e: Envio) => void }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const nombre = `${chip.etiqueta}: ${chip.valor}`;
  return (
    <li className={`chip${chip.corregido ? ' chip-corregido' : ''}${abierto ? ' chip-abierto' : ''}`} data-chip={chip.clave}>
      <div className="chip-fila">
        {chip.cambiar.length > 0 ? (
          <button type="button" className="chip-cuerpo" aria-expanded={abierto} aria-controls={id} disabled={deshabilitado} onClick={() => setAbierto((a) => !a)}>
            <span className="chip-etiqueta">{chip.etiqueta}</span>
            <span className="chip-valor">{chip.valor}</span>
            <span className="chip-flecha">
              <IconoChevron />
            </span>
            <span className="solo-lectores">. Tocar para cambiarlo</span>
          </button>
        ) : (
          <span className="chip-cuerpo chip-fijo">
            <span className="chip-etiqueta">{chip.etiqueta}</span>
            <span className="chip-valor">{chip.valor}</span>
          </span>
        )}
        {chip.quitar && (
          <button type="button" className="chip-quitar" aria-label={`Quitar de tu búsqueda: ${chip.etiqueta} (${chip.valor})`} disabled={deshabilitado} onClick={() => onEnviar({ mensaje: `Quitar «${nombre}»`, ajuste: chip.quitar as Ajuste })}>
            <IconoCerrar />
          </button>
        )}
      </div>
      {(chip.detalle || chip.corregido) && (
        <p className="chip-nota">
          {chip.corregido ? 'Lo corregí a partir de lo que escribiste. ' : ''}
          {chip.detalle ?? ''}
        </p>
      )}
      {abierto && chip.cambiar.length > 0 && (
        <div id={id} className="chip-opciones" role="group" aria-label={`Cambiar ${chip.etiqueta.toLowerCase()}`}>
          {chip.cambiar.map((o, i) => (
            <button key={`${o.texto}-${i}`} type="button" className="sugerencia" disabled={deshabilitado} onClick={() => (setAbierto(false), onEnviar(enviarDe(o)))}>
              {o.texto}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

export function Entendido({ chips, deshabilitado, onEnviar }: { chips: Chip[]; deshabilitado: boolean; onEnviar: (e: Envio) => void }) {
  if (chips.length === 0) return null;
  return (
    <section className="entendido" aria-label="Lo que entendí de tu búsqueda">
      <h3 className="entendido-titulo">Lo que entendí</h3>
      <ul className="chips">
        {chips.map((c) => (
          <ChipEntendido key={c.clave} chip={c} deshabilitado={deshabilitado} onEnviar={onEnviar} />
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ Límites (lo que los datos no dicen)

/**
 * «Antes de decidir»: lo que estos datos no dicen. Queda abierto en la respuesta más reciente y plegado en las anteriores; cada persona lo abre o lo cierra.
 */
export function Limites({ lineas, abierto, etiqueta }: { lineas: string[]; abierto: boolean; etiqueta?: string }) {
  if (lineas.length === 0) return null;
  return (
    <div className="limites" role="note" aria-label={etiqueta}>
      <details open={abierto}>
        <summary>
          <IconoInfo />
          <span className="limites-titulo">Antes de decidir</span>
          <span className="limites-flecha">
            <IconoChevron />
          </span>
        </summary>
        <ul>
          {lineas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ Avisos

const nombreBonito = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/\s(Y|De|Del|La|El)\b/g, (m) => m.toLowerCase());

function TarjetaAviso({ t, marcador, activo, onEnfocar, onVerFicha }: { t: Tarjeta; marcador: Marcador | null; activo: boolean; onEnfocar: (m: Marcador) => void; onVerFicha: (m: Marcador) => void }) {
  const url = enlaceSeguro(t.url);
  const datos = [t.tipo ? t.tipo.charAt(0).toUpperCase() + t.tipo.slice(1) : null, t.distrito ? nombreBonito(t.distrito) : null, t.areaM2 !== null ? `${t.areaM2} m²` : null, t.dormitorios !== null ? `${t.dormitorios} dormitorios` : null].filter(Boolean);
  // «US$ 23 695 (≈ S/ 80 728 al cambio de 3.407, 2026-11-12)»: el precio del aviso va grande y su conversión, con su cambio y su fecha, queda debajo.
  const partePrecio = /^(.*?)\s*(\(.*\))$/.exec(t.precioTexto);
  const [precio, conversion] = partePrecio ? [partePrecio[1], partePrecio[2]] : [t.precioTexto, null];
  return (
    <li className={`tarjeta-aviso${activo ? ' aviso-activo' : ''}`} data-aviso-id={t.id} aria-current={activo ? 'true' : undefined}>
      <div className="tarjeta-cabecera">
        <span className="tarjeta-posicion" aria-hidden="true">
          {t.posicion}
        </span>
        <div className="tarjeta-titulo">
          <h3 className="aviso-nombre">{t.titulo}</h3>
          <p className="aviso-detalle">{datos.join(' · ') || 'Sin más datos'}</p>
        </div>
        <p className="aviso-precio">
          {precio}
          {conversion && <span className="aviso-precio-nota"> {conversion}</span>}
        </p>
      </div>
      {t.pedidos > 0 && (
        <p className="aviso-resumen">
          <span className="resumen-barras" aria-hidden="true">
            {t.criterios.map((c) => (
              <i key={c.id} className={`seg seg-${c.estado}`} />
            ))}
          </span>
          <span>
            Cumple <strong>{t.cumplidos}</strong> de {t.pedidos} criterios · {t.sinDato} sin dato
          </span>
        </p>
      )}
      {t.criterios.length > 0 && (
        <dl className="criterios">
          {t.criterios.map((c) => (
            <div key={c.id} className={`criterio criterio-${c.estado}`}>
              <dt>{c.etiqueta}</dt>
              <dd>
                <span className="criterio-linea">
                  <EstadoChip estado={c.estado} />
                  <span className="criterio-valor">{c.valor}</span>
                </span>
                <span className="criterio-pie">
                  Pediste: {c.pedido}
                  {c.fuente || c.fecha ? ` · Fuente: ${c.fuente ?? 'sin registrar'}${c.fecha ? ` · datos del ${c.fecha}` : ''}` : ''}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {t.criterios.length > 0 && (
        <details className="limites-criterios">
          <summary>
            <span>Qué significa cada dato y sus límites</span>
            <span className="limites-flecha">
              <IconoChevron />
            </span>
          </summary>
          {[...new Map(t.criterios.map((c) => [c.id, c])).values()].map((c) => (
            <p key={c.id}>
              <strong>{c.etiqueta}.</strong> {c.nota}
            </p>
          ))}
        </details>
      )}
      <p className="aviso-fuente">
        Visto por última vez el {t.vistoPorUltimaVez} · Fuente: {t.fuente}
        {t.tambienEn.length ? ` · también en ${t.tambienEn.join(', ')}` : ''}
        {t.tipoInferido ? ' · el tipo de inmueble se dedujo del título' : ''}
        {t.esProyecto ? ' · es un proyecto en venta' : ''}
      </p>
      <div className="aviso-acciones">
        {url && (
          <a className="boton-enlace" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir el aviso original de ${t.titulo} (se abre en otra pestaña)`}>
            <IconoEnlace />
            Abrir el aviso original
          </a>
        )}
        {marcador ? (
          <>
            <button type="button" className="boton-secundario" aria-label={`Ver en el mapa: ${t.titulo}`} onClick={() => onEnfocar(marcador)}>
              <IconoMapa />
              Ver en el mapa
            </button>
            <button type="button" className="boton-secundario" aria-label={`Ver ficha del entorno: ${t.titulo}`} onClick={() => onVerFicha(marcador)}>
              <IconoEntorno />
              Ver ficha del entorno
            </button>
          </>
        ) : (
          <p className="aviso-sin-mapa">Sin ubicación conocida: no aparece en el mapa.</p>
        )}
      </div>
    </li>
  );
}

export function Resultados({ r, ubicados, activo, vivo, onEnfocar, onVerFicha }: { r: NonNullable<RespuestaApi['resultados']>; ubicados: Marcador[]; activo: number | null; vivo: boolean; onEnfocar: (m: Marcador) => void; onVerFicha: (m: Marcador) => void }) {
  const marcador = (id: number) => ubicados.find((m) => m.id === id) ?? null;
  const conMapa = r.tarjetas.filter((t) => marcador(t.id));
  const sinMapa = r.tarjetas.filter((t) => !marcador(t.id));
  const lista = (ts: Tarjeta[], clase: string) => (
    <ul className={clase}>
      {ts.map((t) => (
        <TarjetaAviso key={t.id} t={t} marcador={marcador(t.id)} activo={t.id === activo} onEnfocar={onEnfocar} onVerFicha={onVerFicha} />
      ))}
    </ul>
  );
  return (
    <section className="resultados" aria-label="Avisos encontrados">
      <p className="resultados-orden">
        <IconoOrden />
        <span>{r.orden}</span>
      </p>
      {conMapa.length > 0 && (
        <div className="avisos-mapa">
          <p className="avisos-titulo">
            <IconoMapa />
            {conMapa.length === 1 ? '1 aviso ubicado en el mapa' : `${conMapa.length} avisos ubicados en el mapa`}
          </p>
          {lista(conMapa, 'tarjetas')}
        </div>
      )}
      {sinMapa.length > 0 && (
        <div className="avisos-sin-mapa">
          <p className="avisos-titulo">{sinMapa.length === 1 ? '1 aviso sin ubicación conocida (no aparece en el mapa)' : `${sinMapa.length} avisos sin ubicación conocida (no aparecen en el mapa)`}</p>
          {lista(sinMapa, 'tarjetas')}
        </div>
      )}
      {r.notas.length > 0 && (
        <ul className="notas-resultado">
          {r.notas.map((n) => (
            <li key={n}>
              <IconoInfo />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      <Limites lineas={r.limites} abierto={vivo} etiqueta="Límites de estos datos" />
    </section>
  );
}

// ------------------------------------------------------------------ Punto del mapa y comparación

const metros = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
const referenciaTexto = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/** «Peligro bajo: Escenario…» → el nivel (para marcarlo a la vista) y el resto. Si el texto no empieza así, no hay nivel. */
function nivelDePeligro(texto: string): { nivel: 'bajo' | 'moderado' | 'alto' | 'muy_alto' | null; etiqueta: string; resto: string } {
  const m = /^(Peligro (muy alto|alto|moderado|medio|bajo))\s*:\s*/i.exec(texto);
  if (!m) return { nivel: null, etiqueta: '', resto: texto };
  const palabra = m[2].toLowerCase();
  const nivel = palabra === 'muy alto' ? 'muy_alto' : palabra === 'alto' ? 'alto' : palabra === 'bajo' ? 'bajo' : 'moderado';
  return { nivel, etiqueta: m[1], resto: texto.slice(m[0].length) };
}
const BARRAS: Record<'bajo' | 'moderado' | 'alto' | 'muy_alto', number> = { bajo: 1, moderado: 2, alto: 3, muy_alto: 4 };

function Peligro({ p }: { p: NonNullable<RespuestaApi['ficha']>['peligros'][number] }) {
  const { nivel, etiqueta, resto } = nivelDePeligro(p.texto);
  return (
    <li className="peligro">
      {nivel ? (
        <>
          <span className={`peligro-nivel peligro-${nivel}`}>
            <span className="peligro-barras" aria-hidden="true">
              {[1, 2, 3, 4].map((n) => (
                <i key={n} className={n <= BARRAS[nivel] ? 'lleno' : undefined} />
              ))}
            </span>
            {etiqueta}
          </span>
          <span className="solo-lectores">: </span>
          <span className="peligro-texto">{resto}</span>
        </>
      ) : (
        <span className="peligro-texto">{p.texto}</span>
      )}
      {(p.fuente || p.fecha) && (
        <span className="criterio-pie">
          {p.fuente ? `Fuente: ${p.fuente}` : ''}
          {p.fecha ? `${p.fuente ? ' · ' : ''}datos del ${p.fecha}` : ''}
        </span>
      )}
    </li>
  );
}

export function FichaDelPunto({ f, vivo }: { f: NonNullable<RespuestaApi['ficha']>; vivo: boolean }) {
  return (
    <section className="ficha-chat" aria-label="Lo que hay en el punto elegido">
      <dl className="criterios">
        {f.filas.map((x) => {
          const estado = x.estado;
          const referencia: Referencia | null =
            x.umbralM !== null && x.distanciaM !== null && (estado === 'cumple' || estado === 'no_cumple')
              ? { m: x.umbralM, texto: `hasta ${referenciaTexto(x.umbralM)}`, origen: null, proporcion: Math.min(x.distanciaM / (2 * x.umbralM), 1), marca: 0.5 }
              : null;
          const distancia = x.distanciaM !== null ? metros(x.distanciaM) : null;
          return (
            <div key={x.etiqueta} className={`criterio criterio-${estado === 'informativo' ? 'info' : estado}`}>
              <dt>{x.etiqueta}</dt>
              <dd>
                <span className="criterio-linea">
                  <EstadoChip estado={estado} />
                  {x.valor !== null ? (
                    <span className="criterio-valor criterio-texto">{x.valor}</span>
                  ) : x.nombre || distancia ? (
                    <>
                      {x.nombre && <span className="criterio-nombre">{x.nombre}</span>}
                      {distancia && (
                        <span className="criterio-valor criterio-distancia">
                          <span className="solo-lectores">{x.nombre ? ', a ' : 'a '}</span>
                          {distancia}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="criterio-valor criterio-texto">sin dato</span>
                  )}
                </span>
                {referencia && distancia && (
                  <span className="criterio-medidor">
                    <Medidor referencia={referencia} estado={estado} distancia={distancia} />
                  </span>
                )}
                <span className="criterio-pie">
                  {x.umbralM !== null ? `Referencia: ${referenciaTexto(x.umbralM)}` : ''}
                  {x.fuente || x.fecha ? `${x.umbralM !== null ? ' · ' : ''}Fuente: ${x.fuente ?? 'sin registrar'}${x.fecha ? ` · datos del ${x.fecha}` : ''}` : ''}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      {f.peligros.length > 0 && (
        <div className="peligros">
          <h4 className="peligros-titulo">
            <IconoAlerta />
            Peligros de contexto (no son una evaluación del predio)
          </h4>
          <ul>
            {f.peligros.map((p) => (
              <Peligro key={p.texto} p={p} />
            ))}
          </ul>
        </div>
      )}
      <Limites lineas={f.limites} abierto={vivo} />
    </section>
  );
}

export function Comparacion({ c }: { c: NonNullable<RespuestaApi['comparacion']> }) {
  return (
    <section className="comparacion" aria-label="Comparación de avisos">
      <div className="comparacion-envoltorio">
        <table>
          <caption className="solo-lectores">Comparación lado a lado de los avisos {c.columnas.map((x) => x.posicion).join(' y ')}</caption>
          <thead>
            <tr>
              <th scope="col">Dato</th>
              {c.columnas.map((x) => (
                <th key={x.id} scope="col">
                  <span className="tarjeta-posicion" aria-hidden="true">
                    {x.posicion}
                  </span>{' '}
                  {enlaceSeguro(x.url) ? (
                    <a href={x.url} target="_blank" rel="noopener noreferrer">
                      {x.titulo}
                    </a>
                  ) : (
                    x.titulo
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.filas.map((f) => (
              <tr key={f.etiqueta}>
                <th scope="row">{f.etiqueta}</th>
                {f.valores.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.fuentes.length > 0 && (
        <ul className="notas-resultado">
          {c.fuentes.map((f) => (
            <li key={f.etiqueta}>
              <IconoInfo />
              <span>
                Fuente de «{f.etiqueta}»: {f.fuente}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="resultados-orden">
        <IconoOrden />
        <span>{c.nota}</span>
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ Esperando

/** Mientras el asistente trabaja: dice qué está haciendo (primero entiende, después busca y mide) y no se repite como una pantalla congelada. */
export function Pensando() {
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setPaso(1), 1200);
    const b = setTimeout(() => setPaso(2), 4500);
    return () => (clearTimeout(a), clearTimeout(b));
  }, []);
  const textos = ['Entendiendo tu mensaje…', 'Buscando avisos y midiendo distancias…', 'Sigo midiendo: cada aviso se compara con los datos de la ciudad…'];
  return (
    <div className="pensando" role="status">
      <span className="pensando-puntos" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{textos[paso]}</span>
    </div>
  );
}
