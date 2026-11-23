'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import { aMarcadores, type Marcador } from '../../lib/marcadores.ts';
import { Comparacion, Entendido, FichaDelPunto, Pensando, Resultados, Sugerencias, Texto } from './ChatPartes.tsx';
import type { Envio, EstadoDelAgente, RespuestaApi, Turno } from './chat-tipos.ts';
import { llevarAlFinal, llevarAlInicio, llevarALaVista } from './desplazar.ts';
import { MAPA_VACIO, type EstadoViaje, type PuntoElegido } from './tipos.ts';
import './chat.css';

const BIENVENIDA = 'Cuéntame qué vivienda buscas en Arequipa: tipo, distrito, precio máximo y qué quieres tener cerca.';
const EJEMPLO = 'Quiero un departamento en Cayma, cerca de un colegio…';
/** Si no se puede leer qué cubre el asistente, estos ejemplos igual sirven para empezar. */
const EJEMPLOS_BASE: EstadoDelAgente['ejemplos'] = [
  { texto: 'Un departamento cerca de un colegio', rol: 'ejemplo' },
  { texto: 'Una casa cerca de la UNSA hasta 400 mil soles', rol: 'ejemplo' },
  { texto: 'Zonas con salud y colegio cerca', rol: 'ejemplo' },
];

function textoDelViaje(v: EstadoViaje): string | null {
  switch (v.tipo) {
    case 'ninguno':
      return null;
    case 'cargando':
      return 'Midiendo la ruta al trabajo del aviso seleccionado…';
    case 'error':
      return v.mensaje;
    case 'listo': {
      const m = v.datos.mejor;
      if (!v.datos.hayRuta || !m || !v.datos.trazado) return 'No hay una ruta directa ni con un trasbordo en los datos para ir de este aviso al trabajo.';
      const tiempo = m.minutos === null ? '' : ` · unos ${m.minutos} min sin contar la espera`;
      return `Ruta al trabajo dibujada en el mapa para el aviso seleccionado: ${m.lineas.join(' → ')} (${m.trasbordos ? 'con un trasbordo' : 'directa'})${tiempo}. ${v.datos.nota}`;
    }
  }
}

const coordenadas = (p: PuntoElegido) => `${p.lat.toFixed(5).replace('.', ',')}; ${p.lon.toFixed(5).replace('.', ',')}`;

interface Props {
  /** Una búsqueda trajo sus avisos con ubicación y lo que ubicó (trabajo, sectores): el mapa los dibuja. */
  onResultado: (marcadores: Marcador[], mapa: MapaDeRespuesta) => void;
  /** El aviso resaltado: el que tiene su viaje dibujado y su marcador grande. */
  activo: number | null;
  viaje: EstadoViaje;
  /** El punto elegido en el mapa: el asistente puede decir qué hay ahí. */
  punto: PuntoElegido | null;
  onEnfocar: (m: Marcador) => void;
  onVerFicha: (m: Marcador) => void;
}

/**
 * El asistente. Cada respuesta del servidor trae, además del texto, datos estructurados con los que se dibuja la conversación:
 *   · lo que entendió (botones que se quitan o se cambian y repiten la búsqueda),
 *   · respuestas rápidas para la pregunta pendiente y los siguientes pasos,
 *   · los avisos como tarjetas, con cada criterio, su fuente y su fecha.
 * Los avisos con ubicación van al mapa como marcadores; una tarjeta enfoca su marcador y el marcador resalta su tarjeta.
 */
export function Chat({ onResultado, activo, viaje, punto, onEnfocar, onVerFicha }: Props) {
  const [turnos, setTurnos] = useState<Turno[]>([{ id: 0, quien: 'agente', texto: BIENVENIDA }]);
  const [cargando, setCargando] = useState(false);
  const [agente, setAgente] = useState<EstadoDelAgente | null>(null);
  const siguiente = useRef(1);
  const estado = useRef<unknown>(null);
  const campo = useRef<HTMLInputElement>(null);
  const compositor = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const fin = useRef<HTMLDivElement>(null);
  /** Qué hay que hacer con el foco y el desplazamiento cuando llegue la próxima respuesta. */
  const alLlegar = useRef<'campo' | 'burbuja'>('campo');
  /** Cuándo llegó la última respuesta: el aviso que se resalta por una búsqueda nueva no debe mover la lectura de la respuesta. */
  const llegada = useRef(0);

  // Qué cubre el asistente hoy (cuántos avisos, desde cuándo) y si hay un modelo de lenguaje activo.
  useEffect(() => {
    let vivo = true;
    fetch('/api/agente/estado')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && j && typeof j.resumen === 'string' && setAgente({ resumen: j.resumen, ejemplos: Array.isArray(j.ejemplos) ? j.ejemplos : EJEMPLOS_BASE, modelo: Boolean(j.modelo) }))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  // La altura del campo de escribir: lo que se desplaza hacia una tarjeta nunca queda debajo de él.
  useEffect(() => {
    const el = compositor.current;
    const r = raiz.current;
    if (!el || !r || typeof ResizeObserver === 'undefined') return;
    const medir = () => r.style.setProperty('--alto-compositor', `${Math.ceil(el.getBoundingClientRect().height) + 12}px`);
    medir();
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  // Una respuesta nueva se lee desde su primera línea (no desde el final de un bloque largo); lo demás baja al final.
  useEffect(() => {
    const ultimo = turnos[turnos.length - 1];
    if (!ultimo) return;
    if (ultimo.quien === 'agente' && ultimo.id > 0) {
      const burbuja = document.querySelector<HTMLElement>(`.chat [data-turno="${ultimo.id}"]`);
      if (burbuja) llevarAlInicio(burbuja);
      if (alLlegar.current === 'burbuja') burbuja?.focus({ preventScroll: true });
    } else if (fin.current) llevarAlFinal(fin.current);
  }, [turnos]);
  useEffect(() => {
    if (cargando && fin.current) llevarAlFinal(fin.current);
  }, [cargando]);

  // Si el aviso se eligió desde el mapa, su tarjeta entra en la vista.
  useEffect(() => {
    if (Date.now() - llegada.current < 1500) return;
    const tarjeta = activo !== null ? document.querySelector<HTMLElement>(`.chat [data-aviso-id="${activo}"]`) : null;
    if (tarjeta) llevarALaVista(tarjeta, (compositor.current?.getBoundingClientRect().height ?? 0) + 12);
  }, [activo]);

  const enviar = useCallback(
    async ({ mensaje, ajuste }: Envio, tecleado = false) => {
      const texto = mensaje.trim();
      if (!texto || cargando) return;
      alLlegar.current = tecleado ? 'campo' : 'burbuja';
      setTurnos((t) => [...t, { id: siguiente.current++, quien: 'yo', texto }]);
      setCargando(true);
      try {
        const cuerpo = { mensaje: texto, estado: estado.current ?? undefined, ajuste, punto: punto ? { lat: punto.lat, lon: punto.lon, etiqueta: punto.etiqueta } : undefined };
        const r = await fetch('/api/agente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setTurnos((t) => [...t, { id: siguiente.current++, quien: 'agente', texto: j.error ?? 'Algo salió mal. Intenta de nuevo.', error: true }]);
          return;
        }
        if (j.estado) estado.current = j.estado;
        const resp = j as RespuestaApi;
        const ubicados = aMarcadores(Array.isArray(resp.avisos) ? resp.avisos : []);
        // Una búsqueda (con o sin resultados) reemplaza los marcadores; un saludo, una pregunta o una ficha no los tocan.
        if (resp.tipo === 'resultado' || resp.tipo === 'vacio') onResultado(ubicados, resp.mapa ?? MAPA_VACIO);
        llegada.current = Date.now();
        const conTarjetas = Boolean(resp.resultados || resp.ficha || resp.comparacion || resp.tipo === 'vacio');
        setTurnos((t) => [...t, { id: siguiente.current++, quien: 'agente', texto: (conTarjetas ? resp.titular : resp.texto) ?? 'Algo salió mal.', r: resp, ubicados }]);
      } catch {
        setTurnos((t) => [...t, { id: siguiente.current++, quien: 'agente', texto: 'No pude conectar. Revisa tu conexión e intenta de nuevo.', error: true }]);
      } finally {
        setCargando(false);
        if (tecleado) campo.current?.focus();
      }
    },
    [cargando, onResultado, punto],
  );

  function alEnviar(f: FormEvent<HTMLFormElement>) {
    f.preventDefault();
    const mensaje = (campo.current?.value ?? '').trim();
    if (!mensaje || cargando) return;
    if (campo.current) campo.current.value = '';
    void enviar({ mensaje }, true);
  }

  const ultimoAgente = [...turnos].reverse().find((t) => t.quien === 'agente');
  const inicio = turnos.length === 1;

  return (
    <div className="chat" ref={raiz}>
      <div className="chat-log" role="log" aria-label="Conversación con el asistente" aria-live="polite">
        {turnos.map((t) => {
          const vivo = t.id === ultimoAgente?.id;
          const conPartes = Boolean(t.r?.resultados || t.r?.ficha || t.r?.comparacion);
          return (
            <div
              key={t.id}
              data-turno={t.id}
              tabIndex={t.quien === 'agente' ? -1 : undefined}
              className={`burbuja ${t.quien === 'yo' ? 'burbuja-yo' : 'burbuja-agente'}${t.error ? ' burbuja-error' : ''}${conPartes ? ' burbuja-ancha' : ''}`}
              data-quien={t.quien}
              role={t.error ? 'alert' : undefined}
            >
              <p className="burbuja-texto">
                <span className="solo-lectores">{t.quien === 'yo' ? 'Tú: ' : 'Asistente: '}</span>
                <Texto texto={t.texto} />
              </p>
              {t.id === 0 && agente && <p className="burbuja-cobertura">{agente.resumen}</p>}
              {t.r?.comparacion && <Comparacion c={t.r.comparacion} />}
              {t.r?.ficha && <FichaDelPunto f={t.r.ficha} />}
              {t.r?.resultados && <Resultados r={t.r.resultados} ubicados={t.ubicados ?? []} activo={activo} onEnfocar={onEnfocar} onVerFicha={onVerFicha} />}
              {t.r?.modo === 'modelo' && <p className="burbuja-modelo">La frase de apertura la redactó un modelo de lenguaje y se comprobó contra los datos; los avisos, cifras y fuentes salen de las herramientas.</p>}
              {vivo && t.r && <Entendido chips={t.r.entendido ?? []} deshabilitado={cargando} onEnviar={(e) => void enviar(e)} />}
              {vivo && t.r && <Sugerencias lista={t.r.sugerencias ?? []} titulo="Respuestas rápidas" deshabilitado={cargando} onEnviar={(e) => void enviar(e)} />}
              {t.id === 0 && inicio && <Sugerencias lista={agente?.ejemplos ?? EJEMPLOS_BASE} titulo="Ejemplos para empezar" deshabilitado={cargando} onEnviar={(e) => void enviar(e)} />}
            </div>
          );
        })}
        {textoDelViaje(viaje) && (
          <p className="viaje-estado" role="status" data-testid="viaje-estado">
            {textoDelViaje(viaje)}
          </p>
        )}
        {cargando && <Pensando />}
      </div>
      <div className="compositor" ref={compositor}>
        {punto && (
          <div className="punto-elegido">
            <p>
              <strong>Punto elegido en el mapa:</strong> {punto.etiqueta ? `${punto.etiqueta} · ` : ''}
              {coordenadas(punto)}
            </p>
            <button type="button" className="boton-secundario" disabled={cargando} onClick={() => void enviar({ mensaje: '¿Qué hay en el punto que elegí?', ajuste: { accion: 'punto' } })}>
              ¿Qué hay aquí?
            </button>
          </div>
        )}
        <form className="mensaje-form" onSubmit={alEnviar}>
          <label htmlFor="mensaje" className="solo-lectores">
            Tu consulta
          </label>
          <input id="mensaje" ref={campo} name="mensaje" autoComplete="off" maxLength={600} placeholder={EJEMPLO} />
          <button type="submit" disabled={cargando}>
            Enviar
          </button>
        </form>
      </div>
      <p className="nota-pie">
        Los números salen de datos oficiales y de avisos públicos, con su fuente y fecha. Revisa siempre el aviso original.
        {agente?.modelo ? ' Un modelo de lenguaje (Gemini) redacta la frase de apertura de las respuestas con avisos: tu mensaje y un resumen de los resultados se envían a Google.' : ''}
      </p>
      <div ref={fin} className="chat-fin" />
    </div>
  );
}
