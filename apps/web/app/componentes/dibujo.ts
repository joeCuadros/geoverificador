import type * as Leaflet from 'leaflet';
import type { CapaInfo, CapaServida, FormaDeCapa } from '../../lib/capas.ts';
import { etiquetaDeRadio, radioValido } from '../../lib/radio.ts';
import type { LugarDeFicha } from '../../lib/reporte.ts';
import type { LugarDeRespuesta, SectorDeRespuesta } from '../../lib/mapa-respuesta.ts';
import type { Marcador } from '../../lib/marcadores.ts';
import { colorSeguro, type DatosDeViaje } from './tipos.ts';

type L = typeof Leaflet;

/** Los paneles del mapa, de abajo hacia arriba: lo extenso (zonas, riesgo) debajo, lo puntual (servicios, ficha, viaje) encima. */
const MAX_ICONOS = 350;

export const PANES = {
  distritos: 351,
  zonas: 352,
  concesiones: 353,
  volcan: 354,
  verde: 356,
  circulo: 358,
  lineas: 420,
  viaje: 425,
  puntos: 430,
  ficha: 435,
  punto: 440,
} as const;

export function crearPanes(L: L, map: Leaflet.Map): void {
  // Todos los cuadros se quedan dentro de la vista y lejos de los controles (zoom a la izquierda, escala y atribución abajo): un marcador pegado al borde de arriba no
  // deja su cuadro cortado.
  L.Popup.mergeOptions({ autoPan: true, keepInView: true, autoPanPaddingTopLeft: L.point(56, 16), autoPanPaddingBottomRight: L.point(16, 44), maxWidth: 280 });
  for (const [nombre, z] of Object.entries(PANES)) {
    const p = map.createPane(nombre);
    p.style.zIndex = String(z);
  }
}

/** El panel en que se dibuja cada capa de datos. */
export const PANE_DE_CAPA: Record<string, keyof typeof PANES> = {
  distritos: 'distritos', zonificacion: 'zonas', electricidad: 'concesiones', mineria: 'concesiones', volcan: 'volcan', parques: 'verde', malls: 'verde', quebradas: 'lineas', rutas: 'lineas',
};

/** Lo que lee un lector de pantalla tras un enlace que sale de la aplicación. */
export const AVISO_PESTANA_NUEVA = ' (abre en otra pestaña)';

/**
 * El cuadro de un elemento. Se arma con nodos de DOM (textContent), nunca con HTML: los textos vienen de datos de terceros.
 * Es un grupo con nombre y se puede enfocar (tabindex -1): al abrirse, el foco llega al primer botón o enlace y, si no tiene, al cuadro mismo.
 */
export function cuadro(titulo: string, lineas: (string | null | undefined)[], accion?: { texto: string; alHacer: () => void }, enlace?: { texto: string; url: string } | null): HTMLElement {
  const caja = document.createElement('div');
  caja.className = 'cuadro-aviso';
  caja.tabIndex = -1;
  caja.setAttribute('role', 'group');
  caja.setAttribute('aria-label', titulo);
  const t = document.createElement('strong');
  t.textContent = titulo;
  caja.append(t);
  for (const l of lineas) {
    if (!l) continue;
    const p = document.createElement('p');
    p.textContent = l;
    caja.append(p);
  }
  if (enlace) {
    const a = document.createElement('a');
    a.href = enlace.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = enlace.texto;
    const aviso = document.createElement('span');
    aviso.className = 'solo-lectores';
    aviso.textContent = AVISO_PESTANA_NUEVA;
    a.append(aviso);
    caja.append(a);
  }
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'boton-secundario';
    b.textContent = accion.texto;
    b.addEventListener('click', accion.alHacer);
    caja.append(b);
  }
  return caja;
}

/** La línea de fuente de un cuadro o de una capa: la fecha de los datos o, si la base no la trae, «sin fecha registrada». */
export const textoDeFuente = (nombre: string, fecha: string | null | undefined): string => `Fuente: ${nombre} · ${fecha ? `datos del ${fecha}` : 'sin fecha registrada'}`;

const fuenteDe = (c: CapaInfo) => textoDeFuente(c.fuente.nombre, c.fuente.fecha);

const GRIS_DE_DATOS = '#3b4a5a';
const TEXTO_CLARO = '#ffffff';
const TEXTO_OSCURO = '#111827';
/** El lado mínimo de lo que se toca (WCAG 2.5.8 pide 24 px; la guía de la aplicación, 44). */
export const LADO_DE_TOQUE = 44;

/** Un color hexadecimal como [r, g, b] de 0 a 255; si no tiene forma de color, el gris de los datos. */
function rgbDe(color: string): [number, number, number] {
  const h = colorSeguro(color, GRIS_DE_DATOS).slice(1);
  const base = h.length === 3 || h.length === 4 ? [...h.slice(0, 3)].map((c) => c + c).join('') : h.length === 6 || h.length === 8 ? h.slice(0, 6) : GRIS_DE_DATOS.slice(1);
  return [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16)) as [number, number, number];
}

function luminancia(color: string): number {
  const [r, g, b] = rgbDe(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** La razón de contraste (de 1 a 21) entre dos colores hexadecimales. */
export function contrasteEntre(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** El color de la letra que mejor se lee sobre `fondo`: blanco o tinta, el de más contraste (nunca menos de 4,5 a 1). */
export function colorDeTexto(fondo: string): string {
  return contrasteEntre(TEXTO_CLARO, fondo) >= contrasteEntre(TEXTO_OSCURO, fondo) ? TEXTO_CLARO : TEXTO_OSCURO;
}

/** El nombre de un marcador de aviso: lleva el mismo número que su tarjeta en el asistente. */
export const nombreDeAviso = (posicion: number, titulo: string): string => `Aviso ${posicion}: ${titulo}`;

const esTactil = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);

/** El lado del área que se toca de un marcador de `tamano` px: con un dedo, al menos 44 px (el dibujo queda centrado; el resto es área transparente). */
export const areaDeToque = (tamano: number, tactil = esTactil()): number => (tactil ? Math.max(tamano, LADO_DE_TOQUE) : tamano);

/** Un marcador con una letra (o un punto si no la hay): el color nunca es lo único que informa, y la letra toma el color que mejor se lee sobre el fondo. */
export function iconoLetra(L: L, letra: string | null, color: string, clase = 'ent-marcador', tamano = 24): Leaflet.DivIcon {
  const fondo = colorSeguro(color, GRIS_DE_DATOS);
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.style.background = fondo;
  span.style.color = colorDeTexto(fondo);
  span.style.width = span.style.height = `${tamano}px`;
  if (letra) span.textContent = letra;
  const area = areaDeToque(tamano);
  return L.divIcon({ className: clase, html: span, iconSize: [area, area], iconAnchor: [area / 2, area / 2], popupAnchor: [0, -tamano / 2] });
}

/** El marcador de un aviso: un círculo claro con borde de tinta y el número del aviso (el de su tarjeta), no un color: así no se confunde con nada más. */
export function iconoDeAviso(L: L, posicion: number): Leaflet.DivIcon {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = String(posicion);
  const area = areaDeToque(32);
  return L.divIcon({ className: 'marcador-aviso', html: span, iconSize: [area, area], iconAnchor: [area / 2, area / 2], popupAnchor: [0, -16] });
}

/** Con el teclado, Leaflet abre el cuadro de un marcador con Enter; con la barra espaciadora (la otra tecla de un botón) también. */
export function abrirConEspacio(marca: Leaflet.Marker): Leaflet.Marker {
  return marca.on('keypress', (e: Leaflet.LeafletKeyboardEvent) => {
    if (e.originalEvent.key !== ' ') return;
    e.originalEvent.preventDefault();
    marca.openPopup();
  });
}

/** El grosor del trazo de una capa de líneas. */
const grosorDeLinea = (id: string): number => (id === 'rutas' ? 3 : 2.5);

export interface EstiloDeArea {
  color: string;
  weight: number;
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
  dashArray?: string;
}

/** Cómo se pinta el polígono de una capa: el mapa y la muestra de la leyenda del panel salen de aquí, así no pueden diferir. */
export function estiloDeArea(id: string, color: string): EstiloDeArea {
  if (id === 'distritos') return { color, weight: 2, fill: false, fillColor: color, fillOpacity: 0, dashArray: '2 5' };
  if (id === 'electricidad') return { color, weight: 2, fill: true, fillColor: color, fillOpacity: 0.08, dashArray: '6 4' };
  return { color, weight: 1.2, fill: true, fillColor: color, fillOpacity: id === 'zonificacion' ? 0.38 : 0.3 };
}

/**
 * La muestra de una entrada de la leyenda, con la misma forma y el mismo color con que el mapa dibuja ese elemento: un icono con su letra (puntos con letra), un punto
 * liso, el anillo de un sismo, un trazo o un área (con su relleno y su borde, discontinuo si el mapa lo dibuja así). Nunca es lo único que informa: el texto va al lado.
 */
export type MuestraDeLeyenda =
  | { tipo: 'icono'; color: string; letra: string }
  | { tipo: 'punto'; color: string }
  | { tipo: 'anillo'; color: string; relleno: number }
  | { tipo: 'linea'; color: string; grosor: number }
  | { tipo: 'area'; color: string; grosor: number; relleno: number; discontinuo: boolean };

export function muestraDeLeyenda(capa: { id: string; forma: FormaDeCapa }, item: { color: string; letra?: string }): MuestraDeLeyenda {
  const color = colorSeguro(item.color, '#3b4a5a');
  if (capa.forma === 'linea') return { tipo: 'linea', color, grosor: grosorDeLinea(capa.id) };
  if (capa.forma === 'punto') {
    if (capa.id === 'sismos') return { tipo: 'anillo', color, relleno: 0.25 };
    return item.letra ? { tipo: 'icono', color, letra: item.letra } : { tipo: 'punto', color };
  }
  const e = estiloDeArea(capa.id, color);
  return { tipo: 'area', color, grosor: e.weight, relleno: e.fill ? e.fillOpacity : 0, discontinuo: Boolean(e.dashArray) };
}

/** La capa de Leaflet de una capa de datos: puntos con letra, círculos de sismo, líneas y polígonos, cada uno con su cuadro (título, detalle y fuente). */
export function capaDeDatos(L: L, info: CapaInfo, datos: CapaServida, panes: Record<string, string>): Leaflet.GeoJSON {
  const pane = panes[info.id] ?? 'puntos';
  // Con cientos de puntos, los iconos con letra se amontonan: se dibujan como círculos de lienzo (como la aplicación estática).
  const conIconos = datos.features.length <= MAX_ICONOS;
  return L.geoJSON({ type: 'FeatureCollection', features: datos.features } as any, {
    pane,
    pointToLayer: (f, latlng) => {
      const p = (f.properties ?? {}) as CapaServida['features'][number]['properties'];
      if (p.radioPx) return L.circleMarker(latlng, { radius: p.radioPx, color: colorSeguro(p.color, '#c2570c'), weight: 1.5, fillColor: colorSeguro(p.color, '#c2570c'), fillOpacity: 0.25, pane });
      // Los puntos de una capa no son paradas del Tab (pueden ser cientos): se llega a ellos con la «Lista de elementos de esta vista» del panel de capas.
      if (p.letra && conIconos) return L.marker(latlng, { icon: iconoLetra(L, p.letra, p.color), title: p.titulo, keyboard: false, pane: 'puntos' });
      return L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 1, fillColor: colorSeguro(p.color, '#3b4a5a'), fillOpacity: 0.95, pane });
    },
    style: (f) => {
      const p = (f?.properties ?? {}) as { color?: string };
      const color = colorSeguro(p.color, '#3b4a5a');
      if (info.forma === 'linea') return { color, weight: grosorDeLinea(info.id), opacity: 0.85 };
      return estiloDeArea(info.id, color);
    },
    onEachFeature: (f, layer) => {
      const p = (f.properties ?? {}) as CapaServida['features'][number]['properties'];
      layer.bindPopup(cuadro(p.titulo, [p.detalle, fuenteDe(info)]));
    },
  });
}

type PropiedadesDeElemento = CapaServida['features'][number]['properties'];

/** Un elemento de una capa de datos tal como se lista en el panel de capas. */
export interface ElementoDeLista {
  clave: string;
  titulo: string;
  detalle: string | null;
}

/** El mismo elemento con lo que hace falta para abrir su cuadro en el mapa. */
export interface ElementoAbrible extends ElementoDeLista {
  capa: Leaflet.Layer;
  punto: Leaflet.LatLng;
}

/** Cuántos elementos de cada capa se listan: los más cercanos al centro de la vista (la lista es una alternativa al mapa, no un volcado de la base). */
export const TOPE_DE_LISTA = 25;

/** Dónde se abre el cuadro de una capa: su punto o el centro de su recuadro. No depende de que la capa ya esté en el mapa. */
function puntoDe(capa: Leaflet.Layer): Leaflet.LatLng | null {
  const x = capa as unknown as { getLatLng?: () => Leaflet.LatLng; getBounds?: () => Leaflet.LatLngBounds };
  if (x.getLatLng) return x.getLatLng();
  if (x.getBounds) return x.getBounds().getCenter();
  return null;
}

const propiedadesDe = (capa: Leaflet.Layer): PropiedadesDeElemento | null => ((capa as { feature?: { properties?: PropiedadesDeElemento } }).feature?.properties ?? null);

/** Identifica un elemento dibujado entre dos cargas de la capa (título y lugar): así un cuadro abierto se puede volver a abrir cuando la capa se redibuja. */
export function claveDeElemento(capa: Leaflet.Layer): string | null {
  const p = propiedadesDe(capa);
  const q = puntoDe(capa);
  return p && q ? `${p.titulo}|${q.lat.toFixed(5)}|${q.lng.toFixed(5)}` : null;
}

/** Abre el cuadro de un elemento de una capa (en su punto, o en el centro de su recuadro si es una línea o un área). */
export function abrirCuadroDe(capa: Leaflet.Layer): void {
  const punto = puntoDe(capa);
  if (punto) (capa as Leaflet.Path).openPopup(punto);
}

/** Los `tope` elementos de una capa dibujada más cercanos a `centro` y cuántos hay en total. */
export function elementosCercanos(capa: Leaflet.GeoJSON, centro: Leaflet.LatLng, tope = TOPE_DE_LISTA): { total: number; elementos: ElementoAbrible[] } {
  const todos: (ElementoAbrible & { distancia: number })[] = [];
  capa.eachLayer((l) => {
    const p = propiedadesDe(l);
    const punto = puntoDe(l);
    if (!p || !punto) return;
    todos.push({ clave: '', titulo: p.titulo, detalle: p.detalle || null, capa: l, punto, distancia: centro.distanceTo(punto) });
  });
  todos.sort((a, b) => a.distancia - b.distancia);
  const elementos = todos.slice(0, tope).map(({ distancia: _d, ...e }, i) => ({ ...e, clave: String(i) }));
  return { total: todos.length, elementos };
}

export interface LugarDibujado {
  marcador: Leaflet.Marker;
  forma: Leaflet.Layer | null;
}

/**
 * Los lugares de la ficha tal como los devolvió el servidor: un marcador por lugar, su polígono o línea si la tiene y, si no, una línea punteada desde el punto elegido
 * (como la aplicación estática). Un clic en el marcador avisa a la ficha.
 */
export function dibujarLugares(L: L, grupo: Leaflet.LayerGroup, punto: { lat: number; lon: number }, lugares: LugarDeFicha[], alElegir: (id: string) => void): Map<string, LugarDibujado> {
  const dibujados = new Map<string, LugarDibujado>();
  for (const l of lugares) {
    const color = l.tipo === 'parque' ? '#2f7d3b' : l.tipo === 'cauce' ? '#1f6fb2' : '#1c3a6b';
    let forma: Leaflet.Layer | null = null;
    if (l.forma) forma = L.geoJSON({ type: 'Feature', geometry: l.forma, properties: {} } as any, { style: { color, weight: l.tipo === 'cauce' ? 4 : 2, fillOpacity: 0.2 }, interactive: false, pane: 'ficha' }).addTo(grupo);
    else if (l.tipo !== 'geologico') forma = L.polyline([[punto.lat, punto.lon], [l.lat, l.lon]], { color, weight: 2, dashArray: '4 6', interactive: false, pane: 'ficha' }).addTo(grupo);
    const letra = l.letra ?? (l.tipo === 'geologico' ? '!' : l.tipo === 'cauce' ? '~' : null);
    const marcador = L.marker([l.lat, l.lon], { icon: iconoLetra(L, letra, l.tipo === 'geologico' ? '#7c2d12' : color, 'ent-marcador ent-ficha'), title: `${l.nombre}${l.filas.length ? ` (${l.filas.join(', ')})` : ''}`, keyboard: true, pane: 'ficha' });
    const dist = l.distanciaM === null ? 'sin distancia' : l.distanciaM === 0 ? 'el punto está dentro del área' : `${l.distanciaM < 1000 ? `${Math.round(l.distanciaM)} m` : `${(l.distanciaM / 1000).toFixed(2)} km`} en línea recta`;
    marcador.bindPopup(cuadro(l.nombre, [...l.rotulos, dist, l.fuente ? `Fuente: ${l.fuente}` : null], undefined, l.osm ? { texto: `${l.osm} en openstreetmap.org`, url: `https://www.openstreetmap.org/${l.osm}` } : null));
    marcador.on('click', () => alElegir(l.id));
    marcador.on('keypress', (e: Leaflet.LeafletKeyboardEvent) => {
      if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') alElegir(l.id);
    });
    abrirConEspacio(marcador);
    marcador.addTo(grupo);
    dibujados.set(l.id, { marcador, forma });
  }
  return dibujados;
}

/** Metros por grado de latitud: con ella se sube desde el centro del círculo hasta su borde norte, donde va el rótulo. */
const METROS_POR_GRADO = 111_320;

/**
 * El círculo de preferencia: todo lo que cae dentro es «cerca» para quien pidió estar cerca de ese lugar. Se dibuja con SVG (el mapa usa lienzo para los puntos de las capas)
 * porque su color sale del CSS: el mapa de fondo es siempre claro, así que la tinta del círculo no cambia con el tema. No es interactivo: no tapa los clics del mapa.
 * El rótulo con la distancia va sobre el borde norte; es solo visual, la misma distancia está escrita en «Lo que entendí».
 */
export function dibujarCirculo(L: L, grupo: Leaflet.LayerGroup, centro: { lat: number; lon: number }, radioM: number): Leaflet.LatLngBounds | null {
  if (!radioValido(radioM)) return null;
  const circulo = L.circle([centro.lat, centro.lon], { radius: radioM, renderer: L.svg({ pane: 'circulo' }), className: 'circulo-cerca', interactive: false, pane: 'circulo' }).addTo(grupo);
  const span = document.createElement('span');
  span.className = 'etiqueta-circulo';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = etiquetaDeRadio(radioM);
  const icono = L.divIcon({ className: 'etiqueta-circulo-caja', html: span, iconSize: [0, 0], iconAnchor: [0, 0] });
  L.marker([centro.lat + radioM / METROS_POR_GRADO, centro.lon], { icon: icono, interactive: false, keyboard: false, pane: 'ficha' }).addTo(grupo);
  return circulo.getBounds();
}

/**
 * Los lugares que el asistente ubicó (el trabajo, el otro lugar) y los sectores de la búsqueda de zonas (solo su centro: el contorno no está calculado).
 * El «lugar pedido» con su criterio «cerca de» trae además el radio: se dibuja su círculo y se devuelven sus límites (null si no hay ninguno).
 */
export function dibujarRespuesta(L: L, grupo: Leaflet.LayerGroup, lugares: LugarDeRespuesta[], sectores: SectorDeRespuesta[]): Leaflet.LatLngBounds | null {
  let limites: Leaflet.LatLngBounds | null = null;
  for (const l of lugares) {
    const rol = l.rol === 'trabajo' ? 'Trabajo' : 'Lugar pedido';
    const radio = l.rol === 'lugar' && radioValido(l.radioM) ? l.radioM : null;
    if (radio !== null) {
      const b = dibujarCirculo(L, grupo, l, radio);
      if (b) limites = limites ? limites.extend(b) : b;
    }
    const marcador = L.marker([l.lat, l.lon], { icon: iconoLetra(L, l.rol === 'trabajo' ? 'T' : 'L', l.rol === 'trabajo' ? '#b91c1c' : '#6b2d7a', 'ent-marcador ent-respuesta', 28), title: `${rol}: ${l.nombre}${radio !== null ? ` (cerca: a ${etiquetaDeRadio(radio)} o menos)` : ''}`, keyboard: true, pane: 'viaje' })
      .bindPopup(cuadro(l.nombre, [`${rol}, tal como lo ubicó el asistente.`, radio !== null ? `El círculo marca a ${etiquetaDeRadio(radio)} o menos: lo que entiende el asistente por «cerca».` : null]))
      .addTo(grupo);
    abrirConEspacio(marcador);
  }
  for (const s of sectores) {
    const ha = s.hectareas ? `${s.hectareas} ha` : null;
    const marcador = L.marker([s.lat, s.lon], { icon: iconoLetra(L, String(s.n), '#0b5d4f', 'ent-marcador ent-sector', 30), title: `Sector ${s.n}${s.nombre ? `: ${s.nombre}` : ''}`, keyboard: true, pane: 'viaje' })
      .bindPopup(cuadro(`Sector ${s.n}${s.nombre ? ` · cerca de ${s.nombre}` : ''}`, ['Cumple los criterios pedidos según los datos.', [s.distrito, ha].filter(Boolean).join(' · '), 'Se marca el centro del sector; su contorno no se dibuja.']))
      .addTo(grupo);
    abrirConEspacio(marcador);
  }
  return limites;
}

/** El trasbordo se dibuja con un aro de tinta oscura sobre blanco (contraste de 15 a 1 con el mapa): el ámbar es solo del aviso y no se lee sobre el fondo claro. */
export const COLOR_DE_TRASBORDO = '#1b2233';

/** El trazado de la mejor combi o bus: cada tramo con su color, dónde subes y dónde bajas y, con un trasbordo, el punto donde cambias de ruta. */
export function dibujarViaje(L: L, grupo: Leaflet.LayerGroup, origen: Marcador, datos: DatosDeViaje): Leaflet.LatLngBounds | null {
  const t = datos.trazado;
  if (!t) return null;
  const puntos: [number, number][] = [[origen.lat, origen.lon]];
  L.circleMarker([origen.lat, origen.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1, pane: 'viaje' }).bindPopup(cuadro('De donde sales', [origen.titulo])).addTo(grupo);
  t.tramos.forEach((tr, i) => {
    const color = colorSeguro(tr.color, i === 0 ? '#0b5d4f' : '#7c3aed');
    const linea: [number, number][] = tr.segmento.map(([x, y]) => [y, x]);
    puntos.push(...linea);
    L.polyline(linea, { color, weight: 6, opacity: 0.9, pane: 'viaje' })
      .bindPopup(cuadro(`Línea ${tr.linea}${t.tramos.length > 1 ? ` (${i + 1}.ª ruta)` : ''}`, [tr.nombre, `Caminas ${tr.caminarOrigenM} m al subir y ${tr.caminarDestinoM} m al bajar, en línea recta. El trazado es el publicado en OpenStreetMap; no se sabe dónde se sube ni se baja.`]))
      .addTo(grupo);
    [[tr.subida, 'Subes aquí: el punto de la ruta más cercano a donde estás'], [tr.bajada, 'Bajas aquí: el punto de la ruta más cercano a donde vas']].forEach(([p, texto]) => {
      const q = p as { lat: number; lon: number };
      L.circleMarker([q.lat, q.lon], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, pane: 'viaje' }).bindPopup(cuadro(`Línea ${tr.linea}`, [texto as string])).addTo(grupo);
    });
  });
  for (const x of t.trasbordos) {
    puntos.push([x.lat, x.lon]);
    L.circleMarker([x.lat, x.lon], { radius: 9, color: COLOR_DE_TRASBORDO, weight: 4, fillColor: '#fff', fillOpacity: 1, pane: 'viaje' })
      .bindPopup(cuadro('Trasbordo', ['Bajas de la 1.ª ruta y caminas hasta la 2.ª, en línea recta.', x.nombre ? `Parada mapeada cerca: ${x.nombre}.` : 'No hay una parada mapeada cerca: el cruce es el punto de la ruta más cercano a la otra.']))
      .addTo(grupo);
  }
  return L.latLngBounds(puntos);
}
