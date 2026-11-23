import L from 'leaflet';

export interface DefCapaMapa {
  etiqueta: string;
  descripcion: string;
  grupo: 'Ciudad' | 'Entorno' | 'Peligros';
  color: string;
  cargar: (mapa: L.Map, grupo: L.LayerGroup) => Promise<void>;
}

const estado = new WeakMap<L.LayerGroup, string>();
const clave = (m: L.Map) => {
  const b = m.getBounds();
  return `${m.getZoom()}|${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
};

/** Una capa recortada de la base (/api/capas/<capa>). */
function desdeApi(capa: string, estilo: (f: any) => L.PathOptions, punto?: (f: any, ll: L.LatLng) => L.Layer, titulo?: (f: any) => string): DefCapaMapa['cargar'] {
  return async (mapa, grupo) => {
    const k = clave(mapa);
    if (estado.get(grupo) === k) return;
    estado.set(grupo, k);
    const b = mapa.getBounds();
    const r = await fetch(`/api/capas/${capa}?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&zoom=${mapa.getZoom()}`)
      .then((x) => x.json())
      .catch(() => null);
    grupo.clearLayers();
    if (!r?.features) return;
    L.geoJSON(r, {
      style: estilo,
      pointToLayer: punto ?? ((_f, ll) => L.circleMarker(ll, { radius: 4, color: '#fff', weight: 1, fillColor: '#0f6e5a', fillOpacity: 1 })),
      onEachFeature: (f, l) => {
        const t = titulo?.(f);
        if (t) l.bindTooltip(t, { sticky: true });
      },
    }).addTo(grupo);
  };
}

/** Un archivo estático de public/data con puntos (colegios, salud…), visibles de cerca. */
function puntosEstaticos(ruta: string, color: string, nombre: (p: any) => string): DefCapaMapa['cargar'] {
  let datos: any = null;
  return async (mapa, grupo) => {
    grupo.clearLayers();
    if (mapa.getZoom() < 14) return;
    datos ??= await fetch(`/data/${ruta}`).then((r) => r.json()).catch(() => ({ features: [] }));
    const b = mapa.getBounds().pad(0.1);
    for (const f of datos.features as any[]) {
      const g = f.geometry;
      const c = g?.type === 'Point' ? g.coordinates : g?.type === 'Polygon' ? g.coordinates[0][0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0][0] : null;
      if (!c || !b.contains([c[1], c[0]])) continue;
      L.circleMarker([c[1], c[0]], { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95 }).bindTooltip(nombre(f.properties ?? {}), { direction: 'top' }).addTo(grupo);
    }
  };
}

/** Mapa de calor de denuncias: celdas de ~275 m con el conteo, nunca puntos. */
function calorDeDenuncias(): DefCapaMapa['cargar'] {
  let datos: any = null;
  return async (_mapa, grupo) => {
    if (datos) return;
    datos = await fetch('/api/delitos').then((r) => r.json()).catch(() => null);
    grupo.clearLayers();
    if (!datos?.celdas) return;
    const h = datos.celda / 2;
    for (const c of datos.celdas as { lat: number; lon: number; n: number }[]) {
      const t = Math.sqrt(c.n / datos.max);
      L.rectangle([[c.lat - h, c.lon - h], [c.lat + h, c.lon + h]], { stroke: false, fillColor: '#c2410c', fillOpacity: 0.12 + 0.5 * t, interactive: true })
        .bindTooltip(`${c.n} denuncias de robo y hurto en esta celda (${datos.meta.meses} meses)`, { sticky: true })
        .addTo(grupo);
    }
  };
}

export const capasDelMapa: Record<string, DefCapaMapa> = {
  distritos: { etiqueta: 'Distritos', descripcion: 'Límites oficiales (INEI)', grupo: 'Ciudad', color: '#52606d', cargar: desdeApi('distritos', () => ({ color: '#52606d', weight: 1.5, fillOpacity: 0, dashArray: '4 4' }), undefined, (f) => f.properties?.distrito ?? '') },
  zonas: { etiqueta: 'Zonificación', descripcion: 'Plano del PDM 2016-2025 (vigencia cumplida)', grupo: 'Ciudad', color: '#e0b3b3', cargar: desdeApi('zonas', (f) => ({ color: f.properties?.color ?? '#999', weight: 0.5, fillColor: f.properties?.color ?? '#999', fillOpacity: 0.45 }), undefined, (f) => `${f.properties?.codigo ?? ''} ${f.properties?.nombre ?? ''}`.trim()) },
  rutas: { etiqueta: 'Rutas de bus', descripcion: 'Combis y buses (OpenStreetMap)', grupo: 'Ciudad', color: '#2f6fed', cargar: desdeApi('rutas', () => ({ color: '#2f6fed', weight: 2, opacity: 0.55 }), undefined, (f) => f.properties?.ref ?? f.properties?.name ?? '') },
  paraderos: { etiqueta: 'Paraderos', descripcion: 'Paraderos mapeados (parciales)', grupo: 'Ciudad', color: '#2f6fed', cargar: desdeApi('paraderos', () => ({}), (_f, ll) => L.circleMarker(ll, { radius: 4, color: '#fff', weight: 1, fillColor: '#2f6fed', fillOpacity: 1 }), (f) => f.properties?.name ?? 'Paradero') },
  salud: { etiqueta: 'Salud', descripcion: 'Establecimientos (RENIPRESS)', grupo: 'Entorno', color: '#d9381e', cargar: puntosEstaticos('equipamiento/salud.geojson', '#d9381e', (p) => p.nombre ?? p.name ?? 'Establecimiento de salud') },
  educacion: { etiqueta: 'Colegios', descripcion: 'Padrón ESCALE (MINEDU)', grupo: 'Entorno', color: '#e69a00', cargar: puntosEstaticos('equipamiento/educacion.geojson', '#e69a00', (p) => p.nombre ?? p.name ?? 'Institución educativa') },
  universidades: { etiqueta: 'Universidades', descripcion: 'Licenciadas por Sunedu', grupo: 'Entorno', color: '#7a3fc4', cargar: puntosEstaticos('equipamiento/educacion_superior.geojson', '#7a3fc4', (p) => p.nombre ?? p.name ?? 'Universidad') },
  censo: { etiqueta: 'Manzanas del censo', descripcion: 'Cobertura de agua, luz y desagüe (2017); desde zoom 15', grupo: 'Entorno', color: '#1a7f4b', cargar: desdeApi('censo', (f) => ({ color: '#1a7f4b', weight: 0.6, fillColor: '#1a7f4b', fillOpacity: f.properties?.con_datos ? 0.18 : 0.04 })) },
  delitos: { etiqueta: 'Denuncias (calor)', descripcion: 'Robo y hurto agregados en celdas (MININTER)', grupo: 'Peligros', color: '#c2410c', cargar: calorDeDenuncias() },
  cauces: { etiqueta: 'Quebradas y ríos', descripcion: 'Cauces (peligro de huaico)', grupo: 'Peligros', color: '#0b7285', cargar: desdeApi('cauces', () => ({ color: '#0b7285', weight: 2.5 }), undefined, (f) => f.properties?.nombre ?? 'Cauce') },
  volcan: { etiqueta: 'Peligro volcánico', descripcion: 'Mapa del IGP (Misti)', grupo: 'Peligros', color: '#c2410c', cargar: desdeApi('volcan', () => ({ color: '#c2410c', weight: 0.8, fillColor: '#c2410c', fillOpacity: 0.15 }), undefined, (f) => f.properties?.etiqueta ?? '') },
};
