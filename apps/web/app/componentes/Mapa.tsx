'use client';
import 'leaflet/dist/leaflet.css';
import './mapa-a11y.css';
import CONFIG from '@geoverificador/dominio/nucleo/config';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { CapaInfo, CapaServida } from '../../lib/capas.ts';
import type { MapaDeRespuesta } from '../../lib/mapa-respuesta.ts';
import type { Marcador } from '../../lib/marcadores.ts';
import type { LugarDeFicha, ReporteDePunto } from '../../lib/reporte.ts';
import {
  PANE_DE_CAPA,
  abrirConEspacio,
  abrirCuadroDe,
  capaDeDatos,
  claveDeElemento,
  crearPanes,
  cuadro,
  dibujarLugares,
  dibujarRespuesta,
  dibujarViaje,
  elementosCercanos,
  iconoDeAviso,
  nombreDeAviso,
  type ElementoAbrible,
  type LugarDibujado,
} from './dibujo.ts';
import { alAbrirSuperficie, avisarSuperficie, type EstadoCapa } from './interfaz.ts';
import { PanelCapas, type ListaDeCapa } from './PanelCapas.tsx';
import type { EstadoViaje, PuntoElegido } from './tipos.ts';

type Origen = PuntoElegido['origen'];

/** Un aviso del mapa puede traer el número de su tarjeta en el asistente (si no, se numera por orden). */
type MarcadorNumerado = Marcador & { posicion?: number };

interface Props {
  marcadores: Marcador[];
  avisoActivo: number | null;
  /** Pide enfocar un aviso (desde su tarjeta del chat): el mapa lo centra y abre su cuadro. `n` cambia en cada pedido. */
  enfocar: { id: number; n: number } | null;
  punto: PuntoElegido | null;
  reporte: ReporteDePunto | null;
  lugarActivo: string | null;
  respuesta: MapaDeRespuesta;
  viaje: EstadoViaje;
  onElegir: (lat: number, lon: number, origen: Origen, etiqueta: string | null) => void;
  onAviso: (m: Marcador) => void;
  onVerFichaAviso: (m: Marcador) => void;
  onLugar: (id: string) => void;
}

/**
 * Los cambios de vista que hace la aplicación son siempre instantáneos: Leaflet descarta un cambio de zoom que llega mientras otro se anima (el encuadre del
 * viaje llega justo después del de los avisos y se perdía). Las animaciones de lo que hace la persona (zoom, desvanecimientos, inercia, desplazar con las flechas)
 * se apagan al crear el mapa si pide `prefers-reduced-motion: reduce`.
 */
const SIN_ANIMACION = { animate: false } as const;
const RETARDO_MOVER_MS = 350;
const FICHA_RADIO_VISTA_M = 1500;

const AYUDA_DEL_MAPA =
  'Elige un punto con un clic o un toque. Con el teclado: enfoca el mapa, muévelo con las flechas (con más y menos se acerca o se aleja) y pulsa «Ver ficha del centro del mapa» para ver la ficha del punto que queda en la mira del centro. Lo que dibujan las capas también está en la «Lista de elementos de esta vista» del panel de capas.';

const esperaMenosMovimiento = (): boolean => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * El mapa (Leaflet, como la aplicación estática). Dibuja, cada cosa en su capa: los datos que la persona enciende (zonas, riesgos, servicios…, pedidos a la base
 * por ventana y zoom), lo más cercano de cada sección de la ficha, los avisos y los lugares que ubicó el asistente, y la combi o bus que midió.
 * Solo se carga en el navegador: Leaflet toca `window` al importarse.
 */
export function Mapa({ marcadores, avisoActivo, enfocar, punto, reporte, lugarActivo, respuesta, viaje, onElegir, onAviso, onVerFichaAviso, onLugar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const grupos = useRef<Record<'avisos' | 'lugares' | 'respuesta' | 'viaje', Leaflet.LayerGroup> | null>(null);
  const marcaPunto = useRef<Leaflet.Marker | null>(null);
  const marcasAviso = useRef(new Map<number, Leaflet.Marker>());
  const lugaresDibujados = useRef(new Map<string, LugarDibujado>());
  const capasDibujadas = useRef(new Map<string, Leaflet.GeoJSON>());
  const elementos = useRef(new Map<string, Map<string, ElementoAbrible>>());
  const cuadroAbierto = useRef<Leaflet.Popup | null>(null);
  const cuadroDeCapa = useRef<{ capa: string; clave: string } | null>(null);
  const retornoDelFoco = useRef<HTMLElement | null>(null);
  const sinMoverFoco = useRef(false);
  const cuentaDeCapas = useRef(new Map<string, number>());
  const controles = useRef(new Map<string, AbortController>());
  const retardo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alElegir = useRef(onElegir);
  const alAviso = useRef(onAviso);
  const alVerFicha = useRef(onVerFichaAviso);
  const alLugar = useRef(onLugar);
  const [listo, setListo] = useState(false);
  const [sinFondo, setSinFondo] = useState(false);
  const [capas, setCapas] = useState<CapaInfo[] | null>(null);
  const [errorDeLista, setErrorDeLista] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [activas, setActivas] = useState<ReadonlySet<string>>(new Set());
  const [estados, setEstados] = useState<Record<string, EstadoCapa>>({});
  const [listas, setListas] = useState<Record<string, ListaDeCapa>>({});
  const idAyuda = useId();
  const activasRef = useRef(activas);
  const capasRef = useRef(capas);

  useEffect(() => {
    alElegir.current = onElegir;
    alAviso.current = onAviso;
    alVerFicha.current = onVerFichaAviso;
    alLugar.current = onLugar;
  }, [onElegir, onAviso, onVerFichaAviso, onLugar]);
  useEffect(() => {
    activasRef.current = activas;
    capasRef.current = capas;
  }, [activas, capas]);
  // Si se despliega la lista de resultados del buscador, el panel de capas se pliega (los dos se abren sobre el mapa).
  useEffect(() => alAbrirSuperficie('buscador', () => setPanelAbierto(false)), []);
  // Los avisos de la respuesta, para encuadrar el círculo junto con ellos (este efecto va antes que el que dibuja la respuesta).
  const marcadoresRef = useRef(marcadores);
  useEffect(() => {
    marcadoresRef.current = marcadores;
  }, [marcadores]);

  // ------------------------------------------------------------------ El mapa
  useEffect(() => {
    let cancelado = false;
    let observador: ResizeObserver | undefined;
    (async () => {
      const L = (await import('leaflet')).default as unknown as typeof Leaflet;
      if (cancelado || !contenedor.current) return;
      leaflet.current = L;
      // El mapa se maneja con el teclado (flechas para moverlo, + y − para el zoom) y, si la persona pide menos movimiento, sin animaciones.
      const reducido = esperaMenosMovimiento();
      const m = L.map(contenedor.current, {
        zoomControl: false,
        preferCanvas: true,
        keyboard: true,
        ...(reducido ? { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false } : {}),
      }).setView(CONFIG.center as [number, number], CONFIG.zoom as number);
      if (reducido) {
        // Las flechas desplazan con una animación propia de Leaflet que ninguna opción apaga.
        const desplazar = m.panBy.bind(m);
        m.panBy = ((desde, opciones) => desplazar(desde, { ...opciones, animate: false })) as typeof m.panBy;
      }
      // Los controles de Leaflet vienen en inglés: se arman aquí con sus nombres en español.
      L.control.zoom({ position: 'topleft', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(m);
      m.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; Colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
        .on('tileerror', () => setSinFondo(true))
        .addTo(m);
      L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(m);
      crearPanes(L, m);
      grupos.current = { lugares: L.layerGroup().addTo(m), avisos: L.layerGroup().addTo(m), respuesta: L.layerGroup().addTo(m), viaje: L.layerGroup().addTo(m) };
      m.on('click', (e: Leaflet.LeafletMouseEvent) => alElegir.current(e.latlng.lat, e.latlng.lng, 'mapa', null));
      // Cuadros (ventanas emergentes): al abrirse con el teclado o con un clic, el foco entra al primer botón o enlace; al cerrarse, vuelve a donde estaba.
      m.on('popupopen', (e: Leaflet.PopupEvent) => {
        const cuadroNuevo = e.popup;
        const raiz = cuadroNuevo.getElement();
        const cerrar = (cuadroNuevo as unknown as { _closeButton?: HTMLElement })._closeButton;
        cerrar?.setAttribute('aria-label', 'Cerrar');
        cerrar?.setAttribute('title', 'Cerrar');
        cuadroAbierto.current = cuadroNuevo;
        const fuente = (cuadroNuevo as unknown as { _source?: Leaflet.Layer })._source;
        const clave = fuente ? claveDeElemento(fuente) : null;
        cuadroDeCapa.current = null;
        if (fuente && clave) for (const [id, capa] of capasDibujadas.current) if (capa.hasLayer(fuente)) cuadroDeCapa.current = { capa: id, clave };
        const antes = document.activeElement as HTMLElement | null;
        retornoDelFoco.current = antes && antes !== document.body && !raiz?.contains(antes) ? antes : null;
        if (sinMoverFoco.current) return;
        const destino = raiz?.querySelector<HTMLElement>('.leaflet-popup-content a[href], .leaflet-popup-content button') ?? raiz?.querySelector<HTMLElement>('.cuadro-aviso');
        destino?.focus({ preventScroll: true });
      });
      m.on('popupclose', (e: Leaflet.PopupEvent) => {
        const raiz = e.popup.getElement();
        const activo = document.activeElement as HTMLElement | null;
        const perdido = !activo || activo === document.body || !activo.isConnected || Boolean(raiz?.contains(activo));
        const retorno = retornoDelFoco.current;
        if (cuadroAbierto.current === e.popup) {
          cuadroAbierto.current = null;
          cuadroDeCapa.current = null;
          retornoDelFoco.current = null;
        }
        if (!perdido) return;
        // Vuelve al marcador (o al botón de la lista) que abrió el cuadro; si ya no se ve, al mapa.
        retorno?.focus({ preventScroll: true });
        if (document.activeElement !== retorno && (!activo || raiz?.contains(activo))) contenedor.current?.focus({ preventScroll: true });
      });
      // Esc cierra el cuadro abierto estando el foco en el mapa, en un marcador o dentro del cuadro.
      contenedor.current.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape' || !cuadroAbierto.current) return;
        ev.stopPropagation();
        m.closePopup();
      });
      // La vista queda a la vista del DOM (zoom y centro): útil para las pruebas y para quien inspeccione la página.
      const anotarVista = () => {
        const c = m.getCenter();
        contenedor.current?.setAttribute('data-vista', `${m.getZoom()}|${c.lat.toFixed(5)}|${c.lng.toFixed(5)}`);
      };
      anotarVista();
      m.on('moveend', () => {
        anotarVista();
        if (retardo.current) clearTimeout(retardo.current);
        retardo.current = setTimeout(() => {
          for (const id of activasRef.current) void cargarCapa(id);
        }, RETARDO_MOVER_MS);
      });
      // El contenedor cambia de tamaño al girar el teléfono o al ensanchar la ventana: Leaflet debe enterarse.
      if (window.ResizeObserver) {
        observador = new ResizeObserver(() => m.invalidateSize({ pan: false }));
        observador.observe(contenedor.current);
      }
      mapa.current = m;
      setListo(true);
    })();
    return () => {
      cancelado = true;
      observador?.disconnect();
      if (retardo.current) clearTimeout(retardo.current);
      for (const c of controles.current.values()) c.abort();
      controles.current.clear();
      capasDibujadas.current.clear();
      elementos.current.clear();
      cuadroAbierto.current = null;
      marcasAviso.current.clear();
      lugaresDibujados.current.clear();
      mapa.current?.remove();
      mapa.current = null;
      grupos.current = null;
      marcaPunto.current = null;
      setListo(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Lo que hay dibujado, a la vista del DOM: capas de datos con su número de elementos, y el viaje con sus tramos y trasbordos. */
  const anotarDibujo = useCallback(() => {
    const c = contenedor.current;
    if (!c) return;
    c.setAttribute('data-capas', [...cuentaDeCapas.current].map(([id, n]) => `${id}:${n}`).join(','));
  }, []);

  const ajustar = useCallback((limites: Leaflet.LatLngBounds, maxZoom = 17) => {
    mapa.current?.fitBounds(limites, { padding: [48, 48], maxZoom, ...SIN_ANIMACION });
  }, []);

  // ------------------------------------------------------------------ Capas de datos
  const cargarLista = useCallback(() => {
    fetch('/api/capas')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('lista'))))
      .then((j) => {
        setCapas(j.capas as CapaInfo[]);
        setErrorDeLista(false);
      })
      .catch(() => setErrorDeLista(true));
  }, []);
  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  const poner = (id: string, e: EstadoCapa) => setEstados((x) => ({ ...x, [id]: e }));
  /** Quita de la lista del panel y de la memoria los elementos de una capa que ya no está dibujada. */
  const olvidarElementos = (id: string) => {
    elementos.current.delete(id);
    setListas((x) => {
      if (!(id in x)) return x;
      const { [id]: _quitada, ...resto } = x;
      return resto;
    });
  };

  async function cargarCapa(id: string) {
    const m = mapa.current;
    const L = leaflet.current;
    const info = capasRef.current?.find((c) => c.id === id);
    if (!m || !L || !info) return;
    controles.current.get(id)?.abort();
    const quitar = () => {
      const previa = capasDibujadas.current.get(id);
      if (previa) m.removeLayer(previa);
      capasDibujadas.current.delete(id);
      cuentaDeCapas.current.delete(id);
      olvidarElementos(id);
      anotarDibujo();
    };
    const b = m.getBounds();
    if (m.getZoom() < info.zoomMin) {
      quitar();
      poner(id, { tipo: 'lejos', zoomMin: info.zoomMin, ventana: false });
      return;
    }
    if (b.getEast() - b.getWest() > 2 || b.getNorth() - b.getSouth() > 2) {
      quitar();
      poner(id, { tipo: 'lejos', zoomMin: info.zoomMin, ventana: true });
      return;
    }
    const control = new AbortController();
    controles.current.set(id, control);
    poner(id, { tipo: 'cargando' });
    try {
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(',');
      const r = await fetch(`/api/capas/${id}?bbox=${bbox}&zoom=${m.getZoom()}`, { signal: control.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'capa');
      const datos = j as CapaServida;
      // Si el cuadro de un elemento de esta capa estaba abierto, se vuelve a abrir cuando la capa se redibuje (mover el mapa la pide de nuevo).
      const cuadroPrevio = cuadroDeCapa.current?.capa === id ? { clave: cuadroDeCapa.current.clave, conFoco: Boolean(cuadroAbierto.current?.getElement()?.contains(document.activeElement)) } : null;
      quitar();
      if (!activasRef.current.has(id)) return;
      if (datos.requiereZoom) {
        poner(id, { tipo: 'lejos', zoomMin: datos.requiereZoom, ventana: false });
        return;
      }
      const capa = capaDeDatos(L, info, datos, PANE_DE_CAPA);
      capa.addTo(m);
      capasDibujadas.current.set(id, capa);
      cuentaDeCapas.current.set(id, datos.features.length);
      const cercanos = elementosCercanos(capa, m.getCenter());
      elementos.current.set(id, new Map(cercanos.elementos.map((e) => [e.clave, e])));
      setListas((x) => ({ ...x, [id]: { total: cercanos.total, items: cercanos.elementos.map(({ clave, titulo, detalle }) => ({ clave, titulo, detalle })) } }));
      anotarDibujo();
      if (cuadroPrevio) {
        const igual = capa.getLayers().find((l) => claveDeElemento(l) === cuadroPrevio.clave);
        if (igual) conFoco(cuadroPrevio.conFoco, () => abrirCuadroDe(igual));
      }
      poner(id, datos.recortada ? { tipo: 'recortada', n: datos.features.length } : { tipo: 'ok', n: datos.features.length });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') poner(id, { tipo: 'error' });
    }
  }

  function alternarCapa(id: string) {
    const nuevas = new Set(activasRef.current);
    if (nuevas.has(id)) {
      nuevas.delete(id);
      controles.current.get(id)?.abort();
      const previa = capasDibujadas.current.get(id);
      if (previa) mapa.current?.removeLayer(previa);
      capasDibujadas.current.delete(id);
      cuentaDeCapas.current.delete(id);
      olvidarElementos(id);
      anotarDibujo();
      setEstados((x) => {
        const { [id]: _quitado, ...resto } = x;
        return resto;
      });
    } else nuevas.add(id);
    activasRef.current = nuevas;
    setActivas(nuevas);
    if (nuevas.has(id)) void cargarCapa(id);
  }

  /** Abre un cuadro desde el código: con `enfocar` el foco entra en él; sin él (lo pidió un botón de la ficha o del chat) el foco se queda donde estaba. */
  function conFoco(enfocar: boolean, abrir: () => void) {
    sinMoverFoco.current = !enfocar;
    try {
      abrir();
    } finally {
      sinMoverFoco.current = false;
    }
  }

  /** Desde la «Lista de elementos de esta vista»: abre el cuadro del elemento y lleva el foco a él. El panel se pliega para que no tape el cuadro. */
  function verElemento(capa: string, clave: string) {
    const e = elementos.current.get(capa)?.get(clave);
    if (!e) return;
    setPanelAbierto(false);
    conFoco(true, () => abrirCuadroDe(e.capa));
  }

  // ------------------------------------------------------------------ Avisos del asistente
  useEffect(() => {
    const L = leaflet.current;
    const m = mapa.current;
    const g = grupos.current?.avisos;
    if (!listo || !L || !m || !g) return;
    g.clearLayers();
    marcasAviso.current.clear();
    marcadores.forEach((a, i) => {
      const posicion = (a as MarcadorNumerado).posicion ?? i + 1;
      const nombre = nombreDeAviso(posicion, a.titulo);
      const marca = L.marker([a.lat, a.lon], { icon: iconoDeAviso(L, posicion), title: nombre, keyboard: true, pane: 'ficha' })
        .bindPopup(() => cuadro(a.titulo, [a.detalle], { texto: 'Ver ficha del punto', alHacer: () => alVerFicha.current(a) }, a.url ? { texto: 'Ver el aviso original', url: a.url } : null))
        .on('click', () => alAviso.current(a))
        // Con el teclado, Leaflet avisa de la tecla Enter como «keypress» (y no como «click»); la barra espaciadora también activa el marcador.
        .on('keypress', (e: Leaflet.LeafletKeyboardEvent) => {
          if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') alAviso.current(a);
        })
        .addTo(g);
      abrirConEspacio(marca);
      marca.getElement()?.setAttribute('aria-label', nombre);
      marcasAviso.current.set(a.id, marca);
    });
    if (marcadores.length > 1) ajustar(L.latLngBounds(marcadores.map((a) => [a.lat, a.lon] as [number, number])));
    else if (marcadores.length === 1) m.setView([marcadores[0].lat, marcadores[0].lon], 16, SIN_ANIMACION);
  }, [marcadores, listo, ajustar]);

  // El aviso activo (el que tiene su viaje dibujado y su tarjeta resaltada) se ve más grande.
  useEffect(() => {
    for (const [id, marca] of marcasAviso.current) marca.getElement()?.classList.toggle('ent-activo', id === avisoActivo);
  }, [avisoActivo, marcadores, listo]);

  // Desde la tarjeta del chat: centrar el aviso y abrir su cuadro.
  useEffect(() => {
    if (!enfocar) return;
    const marca = marcasAviso.current.get(enfocar.id);
    const m = mapa.current;
    if (!marca || !m) return;
    m.setView(marca.getLatLng(), Math.max(m.getZoom(), 16), SIN_ANIMACION);
    conFoco(false, () => marca.openPopup());
  }, [enfocar]);

  // ------------------------------------------------------------------ El punto elegido y su ficha
  useEffect(() => {
    const L = leaflet.current;
    const m = mapa.current;
    if (!listo || !L || !m) return;
    marcaPunto.current?.remove();
    marcaPunto.current = null;
    if (!punto) return;
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    const icono = L.divIcon({ className: 'marcador-punto', html: span, iconSize: [26, 26], iconAnchor: [13, 13] });
    marcaPunto.current = L.marker([punto.lat, punto.lon], { icon: icono, title: 'Punto elegido', keyboard: false, interactive: false, pane: 'punto' }).addTo(m);
    if (punto.origen === 'busqueda') m.setView([punto.lat, punto.lon], Math.max(m.getZoom(), 16), SIN_ANIMACION);
  }, [punto, listo]);

  useEffect(() => {
    const L = leaflet.current;
    const g = grupos.current?.lugares;
    if (!listo || !L || !g) return;
    g.clearLayers();
    lugaresDibujados.current.clear();
    if (!reporte) return;
    lugaresDibujados.current = dibujarLugares(L, g, reporte.punto, reporte.lugares, (id) => alLugar.current(id));
    // El mapa acompaña a la ficha: encuadra el punto y lo que tiene cerca.
    const cercanos = reporte.lugares.filter((l: LugarDeFicha) => l.distanciaM !== null && l.distanciaM <= FICHA_RADIO_VISTA_M).map((l) => [l.lat, l.lon] as [number, number]);
    if (cercanos.length) ajustar(L.latLngBounds([[reporte.punto.lat, reporte.punto.lon], ...cercanos]));
    else mapa.current?.setView([reporte.punto.lat, reporte.punto.lon], 17, SIN_ANIMACION);
  }, [reporte, listo, ajustar]);

  // El lugar activo de la ficha se resalta, abre su cuadro y entra en la vista.
  useEffect(() => {
    const L = leaflet.current;
    for (const [id, d] of lugaresDibujados.current) d.marcador.getElement()?.classList.toggle('ent-activo', id === lugarActivo);
    if (!lugarActivo || !L || !reporte) return;
    const d = lugaresDibujados.current.get(lugarActivo);
    const l = reporte.lugares.find((x) => x.id === lugarActivo);
    if (!d || !l) return;
    ajustar(L.latLngBounds([[reporte.punto.lat, reporte.punto.lon], [l.lat, l.lon]]));
    conFoco(false, () => d.marcador.openPopup());
  }, [lugarActivo, reporte, ajustar]);

  // ------------------------------------------------------------------ Lo que ubicó el asistente y el viaje
  useEffect(() => {
    const L = leaflet.current;
    const g = grupos.current?.respuesta;
    if (!listo || !L || !g) return;
    g.clearLayers();
    const limitesDelCirculo = dibujarRespuesta(L, g, respuesta.lugares, respuesta.sectores);
    // El círculo de «cerca de» queda a la vista del DOM: centro y radio en metros (vacío si no hay).
    const pedido = respuesta.lugares.find((l) => l.rol === 'lugar' && l.radioM);
    contenedor.current?.setAttribute('data-circulo', pedido?.radioM ? `${pedido.lat.toFixed(5)}|${pedido.lon.toFixed(5)}|${Math.round(pedido.radioM)}` : '');
    const puntos = [...respuesta.lugares, ...respuesta.sectores].map((p) => [p.lat, p.lon] as [number, number]);
    if (respuesta.sectores.length && puntos.length) ajustar(L.latLngBounds(puntos), 15);
    else if (limitesDelCirculo) {
      // El mapa encuadra todo lo que es «cerca» y, si hay avisos, también dónde quedan respecto de él; pero si están tan lejos que el círculo quedaría
      // como un punto (más de 6 veces su tamaño), se encuadra solo el círculo: los avisos se ven con «Ver en el mapa».
      const todo = L.latLngBounds(limitesDelCirculo.getSouthWest(), limitesDelCirculo.getNorthEast());
      for (const a of marcadoresRef.current) todo.extend([a.lat, a.lon]);
      const demasiadoLejos = todo.getNorth() - todo.getSouth() > 6 * (limitesDelCirculo.getNorth() - limitesDelCirculo.getSouth()) || todo.getEast() - todo.getWest() > 6 * (limitesDelCirculo.getEast() - limitesDelCirculo.getWest());
      ajustar(demasiadoLejos ? limitesDelCirculo : todo, 16);
    }
  }, [respuesta, listo, ajustar]);

  useEffect(() => {
    const L = leaflet.current;
    const g = grupos.current?.viaje;
    if (!listo || !L || !g) return;
    g.clearLayers();
    contenedor.current?.setAttribute('data-viaje', '');
    if (viaje.tipo !== 'listo') return;
    const origen = marcadores.find((a) => a.id === viaje.avisoId);
    if (!origen) return;
    const limites = dibujarViaje(L, g, origen, viaje.datos);
    if (viaje.datos.trazado) contenedor.current?.setAttribute('data-viaje', `${viaje.avisoId}|${viaje.datos.trazado.tramos.length}|${viaje.datos.trazado.trasbordos.length}`);
    if (limites) {
      const trabajo = respuesta.lugares.find((l) => l.rol === 'trabajo');
      if (trabajo) limites.extend([trabajo.lat, trabajo.lon]);
      ajustar(limites, 16);
    }
    // El trazado se dibuja cuando llega; no se vuelve a encuadrar si solo cambia la lista de marcadores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viaje, listo]);

  return (
    <div className="mapa-envoltorio">
      {/* Los botones del mapa van en una barra encima, no sobre el mapa: así no tapan nada de lo dibujado, ni en un teléfono. */}
      <div className="mapa-barra">
        <button
          type="button"
          className="boton-centro boton-secundario"
          disabled={!listo}
          aria-label="Ver ficha del centro del mapa"
          onClick={() => {
            const c = mapa.current?.getCenter();
            if (c) alElegir.current(c.lat, c.lng, 'centro', null);
          }}
        >
          Ver ficha del centro<span className="solo-escritorio"> del mapa</span>
        </button>
        <PanelCapas
          capas={capas}
          errorDeLista={errorDeLista}
          activas={activas}
          estados={estados}
          listas={listas}
          abierto={panelAbierto}
          onAbrir={(a) => {
            setPanelAbierto(a);
            if (a) avisarSuperficie('capas');
            if (a && errorDeLista) cargarLista();
          }}
          onAlternar={alternarCapa}
          onReintentarLista={cargarLista}
          onReintentarCapa={(id) => void cargarCapa(id)}
          onVerElemento={verElemento}
        />
      </div>
      <div className="mapa-lienzo">
        {/* El mapa se enfoca con Tab: ahí las flechas lo mueven y + y − lo acercan o alejan (lo hace Leaflet). La ayuda se lee con él. */}
        <div ref={contenedor} className="mapa" role="group" aria-label="Mapa de Arequipa" aria-describedby={idAyuda} data-listo={listo ? 'si' : 'no'} />
        {/* La mira marca el centro (el punto de «Ver ficha del centro del mapa»); solo se ve mientras el mapa tiene el foco del teclado. */}
        <span className="mapa-mira" aria-hidden="true" />
        <p id={idAyuda} className="solo-lectores">
          {AYUDA_DEL_MAPA}
        </p>
        {sinFondo && (
          <p className="mapa-nota" role="status">
            No se pudo cargar el fondo del mapa. Revisa tu conexión y recarga la página; mientras tanto se pueden seguir buscando lugares y eligiendo puntos.
          </p>
        )}
      </div>
    </div>
  );
}
