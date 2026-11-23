'use client';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import { IconoCerrar } from './Iconos.tsx';
import { alAbrirSuperficie, avisarSuperficie, indiceDeResultado } from './interfaz.ts';

interface Resultado {
  nombre: string;
  lat: number;
  lon: number;
  precisionM: number;
  origen: 'destino' | 'lugar' | 'distrito' | 'nominatim';
  categoria: string | null;
  distrito: string | null;
}

type Estado = { tipo: 'quieto' } | { tipo: 'buscando' } | { tipo: 'error'; mensaje: string; corto: boolean } | { tipo: 'listo'; texto: string; resultados: Resultado[] };

const ORIGEN: Record<Resultado['origen'], string> = { destino: 'lugar de referencia', lugar: 'lugar de los datos', distrito: 'referencia dentro del distrito', nominatim: 'dirección' };

/**
 * Busca un lugar por su nombre en los datos locales (sin servicios externos) y deja elegir uno para ver su ficha.
 * Los resultados se despliegan sobre el mapa (no lo empujan) y se recorren con el teclado: ↓ desde el campo entra en la lista, ↑ ↓ Inicio y Fin se mueven, Enter elige
 * y Esc la cierra y devuelve el foco al campo. Cada estado (buscando, sin resultados, cuántos hay) se anuncia en una región «polite»; los errores, como alerta.
 */
export function Buscador({ onElegir }: { onElegir: (lat: number, lon: number, etiqueta: string) => void }) {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'quieto' });
  const [abierta, setAbierta] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const pedido = useRef<AbortController | null>(null);
  const id = useId();
  const idLista = `${id}-lista`;
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;

  const plegar = useCallback(() => setAbierta(false), []);

  // Abierta la lista, el panel de capas se pliega (los dos se despliegan sobre el mapa); y si se abre el panel, esta se pliega.
  useEffect(() => {
    if (abierta) avisarSuperficie('buscador');
  }, [abierta]);
  useEffect(() => alAbrirSuperficie('capas', plegar), [plegar]);
  // Un toque o clic fuera de la lista la cierra; una búsqueda a medias no sigue corriendo al desmontar.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierta]);
  useEffect(() => () => pedido.current?.abort(), []);

  async function buscar(f: FormEvent<HTMLFormElement>) {
    f.preventDefault();
    if (estado.tipo === 'buscando') return;
    const q = texto.trim();
    if (q.length < 2) {
      setAbierta(false);
      setEstado({ tipo: 'error', mensaje: 'Escribe al menos 2 letras del lugar que buscas.', corto: true });
      return;
    }
    pedido.current?.abort();
    const control = new AbortController();
    pedido.current = control;
    setAbierta(false);
    setEstado({ tipo: 'buscando' });
    try {
      const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`, { signal: control.signal });
      const j = await r.json().catch(() => ({}));
      if (control.signal.aborted) return;
      if (!r.ok) {
        setEstado({ tipo: 'error', mensaje: j.error ?? 'No se pudo buscar el lugar. Intenta de nuevo.', corto: false });
        return;
      }
      const resultados: Resultado[] = j.resultados ?? [];
      setEstado({ tipo: 'listo', texto: q, resultados });
      setAbierta(resultados.length > 0);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setEstado({ tipo: 'error', mensaje: 'No pude conectar. Revisa tu conexión e intenta de nuevo.', corto: false });
    }
  }

  function borrar() {
    pedido.current?.abort();
    setTexto('');
    setEstado({ tipo: 'quieto' });
    setAbierta(false);
    campo.current?.focus();
  }

  const botones = () => Array.from(raiz.current?.querySelectorAll<HTMLButtonElement>('button.buscador-opcion') ?? []);

  function alTeclaEnCampo(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && abierta) {
      // La primera vez cierra la lista; el navegador no debe vaciar además el campo.
      e.preventDefault();
      setAbierta(false);
      return;
    }
    if (e.key === 'ArrowDown' && estado.tipo === 'listo' && estado.resultados.length > 0) {
      e.preventDefault();
      setAbierta(true);
      // La lista puede estar plegada: se espera a que se dibuje para enfocar el primer resultado.
      requestAnimationFrame(() => botones()[0]?.focus());
    }
  }

  function alTeclaEnLista(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setAbierta(false);
      campo.current?.focus();
      return;
    }
    const lista = botones();
    const destino = indiceDeResultado(lista.indexOf(document.activeElement as HTMLButtonElement), lista.length, e.key);
    if (destino === null) return;
    e.preventDefault();
    if (destino < 0) campo.current?.focus();
    else lista[destino]?.focus();
  }

  function alSalirElFoco(e: FocusEvent<HTMLDivElement>) {
    // Con el Tab, el foco que sale hacia otro control cierra la lista. Un foco que se pierde sin destino (un clic en su borde o su barra) no la cierra.
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setAbierta(false);
  }

  const buscando = estado.tipo === 'buscando';
  const conResultados = estado.tipo === 'listo' && estado.resultados.length > 0;
  const aviso =
    estado.tipo === 'buscando'
      ? 'Buscando…'
      : estado.tipo === 'listo' && estado.resultados.length === 0
        ? `No encontré «${estado.texto}» en los datos. Prueba con el nombre de un colegio, un mall, un distrito, o haz clic en el mapa.`
        : estado.tipo === 'listo'
          ? `${estado.resultados.length === 1 ? '1 resultado' : `${estado.resultados.length} resultados`} para «${estado.texto}». Usa la flecha hacia abajo para recorrerlos.`
          : '';

  return (
    <div className="buscador" ref={raiz} onBlur={alSalirElFoco}>
      <form onSubmit={buscar} role="search" aria-label="Buscar un lugar">
        <label htmlFor={`${id}-q`}>Buscar un lugar</label>
        <div className="buscador-fila">
          <div className="buscador-campo">
            <input
              id={`${id}-q`}
              ref={campo}
              name="q"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={alTeclaEnCampo}
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
              placeholder="Plaza de Armas, Cayma…"
              aria-describedby={`${idAyuda}${estado.tipo === 'error' ? ` ${idError}` : ''}`}
              aria-invalid={estado.tipo === 'error' && estado.corto ? true : undefined}
            />
            {texto && (
              <button type="button" className="buscador-borrar" aria-label="Borrar búsqueda" onClick={borrar}>
                <IconoCerrar />
              </button>
            )}
          </div>
          <button type="submit" aria-disabled={buscando} className="buscador-enviar">
            Buscar
          </button>
        </div>
        <p id={idAyuda} className="solo-lectores">
          Escribe al menos 2 letras. Con resultados, usa las flechas arriba y abajo para recorrerlos, Enter para elegir y Esc para cerrar la lista.
        </p>
      </form>
      {/* Una sola región «polite» que siempre está en la página: así sus cambios (buscando, sin resultados, cuántos hay) se anuncian. */}
      <div className="buscador-estado" role="status" aria-live="polite" aria-atomic="true">
        {aviso && <p className={conResultados ? 'solo-lectores' : estado.tipo === 'buscando' ? 'mensaje-buscando' : 'mensaje-vacio'}>{aviso}</p>}
      </div>
      {estado.tipo === 'error' && (
        <p role="alert" id={idError} className="mensaje-error">
          {estado.mensaje}
        </p>
      )}
      {conResultados && abierta && (
        <ul id={idLista} className="buscador-lista" aria-label="Resultados de la búsqueda" onKeyDown={alTeclaEnLista}>
          {estado.resultados.map((r, i) => (
            <li key={`${r.nombre}-${i}`}>
              <button
                type="button"
                className="buscador-opcion"
                onClick={(e) => {
                  onElegir(r.lat, r.lon, r.nombre);
                  setAbierta(false);
                  setEstado({ tipo: 'quieto' });
                  // Elegido con Enter, el foco vuelve al campo (no se pierde al desaparecer el botón); con un toque no, para no abrir el teclado del teléfono.
                  if (e.detail === 0) campo.current?.focus();
                }}
              >
                <span className="buscador-opcion-nombre">{r.nombre}</span>
                <span className="buscador-opcion-detalle">
                  {ORIGEN[r.origen]}
                  {r.distrito && r.origen !== 'distrito' ? ` · ${r.distrito}` : ''} · precisión de unos {r.precisionM} m
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
