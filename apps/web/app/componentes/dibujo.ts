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

/** El cuadro de un elemento. Se arma con nodos de DOM (textContent), nunca con HTML: los textos vienen de datos de terceros. */
export function cuadro(titulo: string, lineas: (string | null | undefined)[], accion?: { texto: string; alHacer: () => void }, enlace?: { texto: string; url: string } | null): HTMLElement {
  const caja = document.createElement('div');
  caja.className = 'cuadro-aviso';
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

const fuenteDe = (c: CapaInfo) => `Fuente: ${c.fuente.nombre}${c.fuente.fecha ? ` · datos del ${c.fuente.fecha}` : ' · sin fecha en la base'}`;

/** Un marcador con una letra (o un punto si no la hay): el color nunca es lo único que informa. */
export function iconoLetra(L: L, letra: string | null, color: string, clase = 'ent-marcador', tamano = 24): Leaflet.DivIcon {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.style.background = colorSeguro(color, '#3b4a5a');
  if (letra) span.textContent = letra;
  return L.divIcon({ className: clase, html: span, iconSize: [tamano, tamano], iconAnchor: [tamano / 2, tamano / 2], popupAnchor: [0, -tamano / 2] });
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
export function capaDeDatos(L: L, info: CapaInfo, datos: CapaServida, panes: Record<string, string>): Leaflet.Layer {
  const pane = panes[info.id] ?? 'puntos';
  // Con cientos de puntos, los iconos con letra se amontonan: se dibujan como círculos de lienzo (como la aplicación estática).
  const conIconos = datos.features.length <= MAX_ICONOS;
  return L.geoJSON({ type: 'FeatureCollection', features: datos.features } as any, {
    pane,
    pointToLayer: (f, latlng) => {
      const p = (f.properties ?? {}) as CapaServida['features'][number]['properties'];
      if (p.radioPx) return L.circleMarker(latlng, { radius: p.radioPx, color: colorSeguro(p.color, '#c2570c'), weight: 1.5, fillColor: colorSeguro(p.color, '#c2570c'), fillOpacity: 0.25, pane });
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
    const dist = l.distanciaM === null ? 'sin distancia' : l.distanciaM === 0 ? 'el punto está dentro del área' : `${l.distanciaM < 1000 ? `${Math.round(l.distanciaM)} m` : `${(l.distanciaM / 1000).toFixed(2).replace('.', ',')} km`} en línea recta`;
    marcador.bindPopup(cuadro(l.nombre, [...l.rotulos, dist, l.fuente ? `Fuente: ${l.fuente}` : null], undefined, l.osm ? { texto: `${l.osm} en openstreetmap.org`, url: `https://www.openstreetmap.org/${l.osm}` } : null));
    marcador.on('click', () => alElegir(l.id));
    marcador.on('keypress', (e: Leaflet.LeafletKeyboardEvent) => {
      if (e.originalEvent.key === 'Enter') alElegir(l.id);
    });
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
    L.marker([l.lat, l.lon], { icon: iconoLetra(L, l.rol === 'trabajo' ? 'T' : 'L', l.rol === 'trabajo' ? '#b91c1c' : '#6b2d7a', 'ent-marcador ent-respuesta', 28), title: `${rol}: ${l.nombre}${radio !== null ? ` (cerca: a ${etiquetaDeRadio(radio)} o menos)` : ''}`, keyboard: true, pane: 'viaje' })
      .bindPopup(cuadro(l.nombre, [`${rol}, tal como lo ubicó el asistente.`, radio !== null ? `El círculo marca a ${etiquetaDeRadio(radio)} o menos: lo que entiende el asistente por «cerca».` : null]))
      .addTo(grupo);
  }
  for (const s of sectores) {
    const ha = s.hectareas ? `${s.hectareas} ha` : null;
    L.marker([s.lat, s.lon], { icon: iconoLetra(L, String(s.n), '#0b5d4f', 'ent-marcador ent-sector', 30), title: `Sector ${s.n}${s.nombre ? `: ${s.nombre}` : ''}`, keyboard: true, pane: 'viaje' })
      .bindPopup(cuadro(`Sector ${s.n}${s.nombre ? ` · cerca de ${s.nombre}` : ''}`, ['Aquí se cumple todo lo que pediste.', [s.distrito, ha].filter(Boolean).join(' · '), 'Se marca el centro del sector; su contorno no se dibuja.']))
      .addTo(grupo);
  }
  return limites;
}

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
      .bindPopup(cuadro(`Línea ${tr.linea}${t.tramos.length > 1 ? ` (${i + 1}.ª ruta)` : ''}`, [tr.nombre, `Caminas ${tr.caminarOrigenM} m al subir y ${tr.caminarDestinoM} m al bajar, en línea recta. El trazado es el publicado en OpenStreetMap; no sé dónde se sube ni se baja.`]))
      .addTo(grupo);
    [[tr.subida, 'Subes aquí: el punto de la ruta más cercano a donde estás'], [tr.bajada, 'Bajas aquí: el punto de la ruta más cercano a donde vas']].forEach(([p, texto]) => {
      const q = p as { lat: number; lon: number };
      L.circleMarker([q.lat, q.lon], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, pane: 'viaje' }).bindPopup(cuadro(`Línea ${tr.linea}`, [texto as string])).addTo(grupo);
    });
  });
  for (const x of t.trasbordos) {
    puntos.push([x.lat, x.lon]);
    L.circleMarker([x.lat, x.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#f59e0b', fillOpacity: 1, pane: 'viaje' })
      .bindPopup(cuadro('Trasbordo', ['Bajas de la 1.ª ruta y caminas hasta la 2.ª, en línea recta.', x.nombre ? `Parada mapeada cerca: ${x.nombre}.` : 'No hay una parada mapeada cerca: el cruce es el punto de la ruta más cercano a la otra.']))
      .addTo(grupo);
  }
  return L.latLngBounds(puntos);
}
