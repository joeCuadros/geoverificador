'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import { aMarcadores, type Marcador } from '../../lib/marcadores.ts';
import { Comparacion, Entendido, FichaDelPunto, Narracion, Pensando, Resultados, Sugerencias } from './ChatPartes.tsx';
import { coordenadasTexto } from './chat-formato.ts';
import { IconoAlerta, IconoEnviar, IconoInfo, IconoMapa } from './Iconos.tsx';
import { Ilustracion, type IdIlustracion } from './Ilustraciones.tsx';
import { abrirGuiaEn } from './Onboarding.tsx';
import type { Envio, EstadoDelAgente, RespuestaApi, Turno } from './chat-tipos.ts';
import { llevarAlFinal, llevarAlInicio, llevarALaVista } from './desplazar.ts';
import { MAPA_VACIO, type EstadoViaje, type PuntoElegido } from './tipos.ts';
import './chat.css';

const BIENVENIDA = 'Cuéntame qué buscas en Arequipa: el tipo (departamento, casa…), el distrito, el precio máximo y qué quieres tener cerca. Te muestro avisos con los datos de cada uno.';
const EJEMPLO = 'Quiero un departamento en Cayma, cerca de un colegio…';
const MAX_MENSAJE = 600;
/** Si no se puede leer qué cubre el asistente, estos ejemplos igual sirven para empezar. */
const EJEMPLOS_BASE: EstadoDelAgente['ejemplos'] = [
  { texto: 'Un departamento cerca de un colegio', rol: 'ejemplo' },
  { texto: 'Una casa cerca de la UNSA hasta 400 mil soles', rol: 'ejemplo' },
  { texto: 'Zonas con salud y colegio cerca', rol: 'ejemplo' },
];

/** La portada del asistente: tres pasos con su dibujo; cada uno abre la guía en el paso que lo explica. */
const PASOS_PORTADA: { id: IdIlustracion; titulo: string; texto: string }[] = [
  { id: 'asistente', titulo: 'Cuéntame lo que buscas', texto: 'La zona y lo que quieres tener cerca: colegio, paradero, parque…' },
  { id: 'buscar', titulo: 'O elige un punto en el mapa', texto: 'Busca una dirección o toca el mapa.' },
  { id: 'ficha', titulo: 'Lee su ficha', texto: 'Qué queda dentro de la referencia, qué no y de dónde sale cada dato.' },
];

function Portada() {
  return (
    <section className="portada" aria-labelledby="portada-titulo">
      <h3 id="portada-titulo" className="portada-titulo">
        Así funciona
      </h3>
      <ol className="portada-pasos">
        {PASOS_PORTADA.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="portada-paso" onClick={() => abrirGuiaEn(p.id)}>
              <Ilustracion id={p.id} tam="mini" />
              <span className="portada-textos">
                <strong>
                  {i + 1}. {p.titulo}
                </strong>
                <span>{p.texto}</span>
                <span className="solo-lectores"> (abre la guía en este paso)</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Un turno del chat; el de un error guarda lo que se envió para poder reintentarlo. */
type TurnoChat = Turno & { reintentar?: Envio };

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

const ERROR_SIN_TITULAR = 'La respuesta llegó incompleta y no pude mostrarla. Toca «Reintentar» para volver a preguntar.';
const ERROR_DE_RED = 'No pude conectar con el servidor y tu mensaje no se envió. Revisa tu conexión y toca «Reintentar».';
const errorDelServidor = (estado: number, mensaje: unknown): string => {
  if (typeof mensaje !== 'string' || !mensaje.trim()) return `No pude procesar tu mensaje: el servidor respondió con un error (${estado}). Toca «Reintentar» o prueba de nuevo en unos minutos.`;
  // Un límite por hora no se arregla reintentando de inmediato: el mensaje del servidor ya dice cuándo volver.
  return estado === 429 ? mensaje : `${mensaje} Toca «Reintentar» para enviar tu mensaje otra vez.`;
};

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
 *
 * Lectores de pantalla: el registro de la conversación NO es una región viva (si lo fuera, leería de nuevo todas las tarjetas de cada respuesta). Lo que se anuncia es
 * una sola vez el titular de la respuesta, por una única región `status` que existe siempre; el foco pasa a la burbuja cuando la respuesta viene de un botón.
 */
export function Chat({ onResultado, activo, viaje, punto, onEnfocar, onVerFicha }: Props) {
  const [turnos, setTurnos] = useState<TurnoChat[]>([{ id: 0, quien: 'agente', texto: BIENVENIDA }]);
  const [cargando, setCargando] = useState(false);
  const [agente, setAgente] = useState<EstadoDelAgente | null>(null);
  /** Lo que anuncia la región `status`: el titular de la última respuesta (o el error). */
  const [anuncio, setAnuncio] = useState('');
  const [largo, setLargo] = useState(0);
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
  /** Para que el mismo titular dos veces seguidas se vuelva a anunciar. */
  const alterna = useRef(false);

  const anunciar = useCallback((texto: string) => {
    alterna.current = !alterna.current;
    setAnuncio(alterna.current ? texto : `${texto} `);
  }, []);

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

  // La altura del campo de escribir: lo que se desplaza hacia una tarjeta nunca queda debajo de él. Si el campo no va pegado (pantallas muy bajas), no reserva nada.
  useEffect(() => {
    const el = compositor.current;
    const r = raiz.current;
    if (!el || !r) return;
    const medir = () => r.style.setProperty('--alto-compositor', `${reservaDelCompositor()}px`);
    medir();
    window.addEventListener('resize', medir);
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', medir);
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => (o.disconnect(), window.removeEventListener('resize', medir));
  }, []);

  /** Cuánto del final de lo visible tapa el campo de escribir: 0 si no está pegado abajo. */
  function reservaDelCompositor(): number {
    const el = compositor.current;
    if (!el || getComputedStyle(el).position !== 'sticky') return 0;
    return Math.ceil(el.getBoundingClientRect().height) + 12;
  }

  // Una respuesta nueva se lee desde su primera línea (no desde el final de un bloque largo); lo demás baja al final.
  // La bienvenida (turno 0) no mueve nada: en un teléfono la conversación no tiene desplazamiento propio y bajar al final arrastraría la página, dejando el mapa fuera.
  useEffect(() => {
    const ultimo = turnos[turnos.length - 1];
    if (!ultimo || ultimo.id === 0) return;
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
    if (tarjeta) llevarALaVista(tarjeta, reservaDelCompositor());
  }, [activo]);

  // El resultado del viaje al trabajo (no su «midiendo…») se anuncia por la misma región.
  const textoViaje = textoDelViaje(viaje);
  useEffect(() => {
    if (textoViaje && viaje.tipo !== 'cargando') anunciar(textoViaje);
  }, [textoViaje, viaje.tipo, anunciar]);

  /**
   * Envía un mensaje o un ajuste. Devuelve si el asistente respondió (false si hubo un error, que queda en la conversación con su botón «Reintentar»).
   * `reintentoDe` es el turno de error que se reintenta: se quita y no se repite el mensaje de la persona.
   */
  const enviar = useCallback(
    async ({ mensaje, ajuste }: Envio, { tecleado = false, reintentoDe }: { tecleado?: boolean; reintentoDe?: number } = {}): Promise<boolean> => {
      const texto = mensaje.trim();
      if (!texto || cargando) return false;
      alLlegar.current = tecleado ? 'campo' : 'burbuja';
      if (reintentoDe === undefined) setTurnos((t) => [...t, { id: siguiente.current++, quien: 'yo', texto }]);
      else setTurnos((t) => t.filter((x) => x.id !== reintentoDe));
      setAnuncio('');
      setCargando(true);
      const falla = (mensajeDeError: string) => {
        setTurnos((t) => [...t, { id: siguiente.current++, quien: 'agente', texto: mensajeDeError, error: true, reintentar: { mensaje: texto, ajuste } }]);
        anunciar(mensajeDeError);
        return false;
      };
      try {
        const cuerpo = { mensaje: texto, estado: estado.current ?? undefined, ajuste, punto: punto ? { lat: punto.lat, lon: punto.lon, etiqueta: punto.etiqueta } : undefined };
        const r = await fetch('/api/agente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return falla(errorDelServidor(r.status, j.error));
        const resp = j as RespuestaApi;
        const conTarjetas = Boolean(resp.resultados || resp.ficha || resp.comparacion || resp.tipo === 'vacio');
        const titular = (conTarjetas ? resp.titular : resp.texto) as string | undefined;
        if (!titular) return falla(ERROR_SIN_TITULAR);
        if (j.estado) estado.current = j.estado;
        const ubicados = aMarcadores(Array.isArray(resp.avisos) ? resp.avisos : []);
        // Una búsqueda (con o sin resultados) reemplaza los marcadores; un saludo, una pregunta o una ficha no los tocan.
        if (resp.tipo === 'resultado' || resp.tipo === 'vacio') onResultado(ubicados, resp.mapa ?? MAPA_VACIO);
        llegada.current = Date.now();
        setTurnos((t) => [...t, { id: siguiente.current++, quien: 'agente', texto: titular, r: resp, ubicados }]);
        anunciar(titular);
        return true;
      } catch {
        return falla(ERROR_DE_RED);
      } finally {
        setCargando(false);
        if (tecleado) campo.current?.focus();
      }
    },
    [anunciar, cargando, onResultado, punto],
  );

  async function alEnviar(f: FormEvent<HTMLFormElement>) {
    f.preventDefault();
    const mensaje = (campo.current?.value ?? '').trim();
    if (!mensaje || cargando) return;
    if (campo.current) campo.current.value = '';
    setLargo(0);
    const respondio = await enviar({ mensaje }, { tecleado: true });
    // Si falló, lo escrito vuelve al campo (a menos que la persona ya haya empezado otro mensaje) para no tener que escribirlo de nuevo.
    if (!respondio && campo.current && campo.current.value === '') {
      campo.current.value = mensaje;
      setLargo(mensaje.length);
    }
  }

  const ultimoAgente = [...turnos].reverse().find((t) => t.quien === 'agente');
  const inicio = turnos.length === 1;
  const enElLimite = largo >= MAX_MENSAJE;

  return (
    <div className="chat" ref={raiz}>
      <h2 className="solo-lectores">Asistente</h2>
      <p className="solo-lectores" role="status" aria-atomic="true">
        {anuncio}
      </p>
      <div className="chat-log" role="log" aria-label="Conversación con el asistente" aria-live="off" aria-busy={cargando}>
        {turnos.map((t) => {
          const vivo = t.id === ultimoAgente?.id;
          const conPartes = Boolean(t.r?.resultados || t.r?.ficha || t.r?.comparacion);
          return (
            <div
              key={t.id}
              data-turno={t.id}
              tabIndex={t.quien === 'agente' ? -1 : undefined}
              role={t.quien === 'agente' ? 'group' : undefined}
              aria-label={t.quien === 'agente' ? (t.error ? 'Error del asistente' : 'Respuesta del asistente') : undefined}
              className={`burbuja ${t.quien === 'yo' ? 'burbuja-yo' : 'burbuja-agente'}${t.error ? ' burbuja-error' : ''}${conPartes ? ' burbuja-ancha' : ''}`}
              data-quien={t.quien}
            >
              <p className="burbuja-texto">
                {t.error && <IconoAlerta />}
                <span className="solo-lectores">{t.quien === 'yo' ? 'Tú: ' : 'Asistente: '}</span>
                <Narracion texto={t.texto} ordenar={Boolean(t.r && (t.r.tipo === 'resultado' || t.r.tipo === 'vacio'))} />
              </p>
              {t.error && t.reintentar && vivo && (
                <div className="burbuja-acciones">
                  <button type="button" className="boton-secundario" disabled={cargando} onClick={() => void enviar(t.reintentar!, { reintentoDe: t.id })}>
                    Reintentar
                  </button>
                </div>
              )}
              {t.id === 0 && agente && (
                <p className="burbuja-cobertura">
                  <IconoInfo />
                  <span>{agente.resumen}</span>
                </p>
              )}
              {t.r?.comparacion && <Comparacion c={t.r.comparacion} />}
              {t.r?.ficha && <FichaDelPunto f={t.r.ficha} vivo={vivo} />}
              {t.r?.resultados && <Resultados r={t.r.resultados} ubicados={t.ubicados ?? []} activo={activo} vivo={vivo} onEnfocar={onEnfocar} onVerFicha={onVerFicha} />}
              {t.r?.modo === 'modelo' && <p className="burbuja-modelo">La frase de apertura la redactó un modelo de lenguaje y se comprobó contra los datos; los avisos, cifras y fuentes salen de las herramientas.</p>}
              {vivo && t.r && <Entendido chips={t.r.entendido ?? []} deshabilitado={cargando} onEnviar={(e) => void enviar(e)} />}
              {vivo && t.r && <Sugerencias lista={t.r.sugerencias ?? []} titulo="Respuestas rápidas" deshabilitado={cargando} onEnviar={(e) => void enviar(e)} />}
              {t.id === 0 && inicio && <Portada />}
              {t.id === 0 && inicio && <Sugerencias lista={agente?.ejemplos ?? EJEMPLOS_BASE} titulo="Ejemplos para empezar" deshabilitado={cargando} onEnviar={(e) => void enviar(e)} />}
            </div>
          );
        })}
        {textoViaje && (
          <p className="viaje-estado" data-testid="viaje-estado">
            {textoViaje}
          </p>
        )}
        {cargando && <Pensando />}
      </div>
      <div className="compositor" ref={compositor}>
        {agente?.modelo && (
          <p className="aviso-modelo" data-testid="aviso-modelo">
            <IconoInfo />
            <span>
              <strong>Privacidad:</strong> un modelo de Google (Gemini) redacta la frase con que abre las respuestas con avisos. Si envías este mensaje, Google recibe tu mensaje, lo que se entendió de tu búsqueda y un resumen de los resultados, sin coordenadas.
            </span>
          </p>
        )}
        {punto && (
          <div className="punto-elegido">
            <p>
              <IconoMapa />
              <span>
                <strong>Punto elegido en el mapa:</strong> {punto.etiqueta ? `${punto.etiqueta} · ` : ''}
                {coordenadasTexto(punto.lat, punto.lon)}
              </span>
            </p>
            <button type="button" className="boton-secundario" disabled={cargando} onClick={() => void enviar({ mensaje: '¿Qué hay en el punto que elegí?', ajuste: { accion: 'punto' } })}>
              ¿Qué hay aquí?
            </button>
          </div>
        )}
        <form className="mensaje-form" onSubmit={(f) => void alEnviar(f)}>
          <div className="mensaje-cabecera">
            <label htmlFor="mensaje">Tu consulta</label>
            <span id="mensaje-contador" className={`mensaje-contador${enElLimite ? ' mensaje-contador-limite' : ''}`}>
              {largo} de {MAX_MENSAJE} caracteres{enElLimite ? ': llegaste al límite' : ''}
            </span>
          </div>
          <div className="mensaje-fila">
            <input
              id="mensaje"
              ref={campo}
              name="mensaje"
              autoComplete="off"
              maxLength={MAX_MENSAJE}
              placeholder={EJEMPLO}
              aria-describedby="mensaje-contador"
              onInput={(e) => setLargo(e.currentTarget.value.length)}
            />
            <button type="submit" className="enviar" disabled={cargando}>
              Enviar
              <IconoEnviar />
            </button>
          </div>
        </form>
      </div>
      <p className="nota-pie">Los números salen de datos oficiales y de avisos públicos, con su fuente y fecha. Revisa siempre el aviso original.</p>
      <div ref={fin} className="chat-fin" />
    </div>
  );
}
