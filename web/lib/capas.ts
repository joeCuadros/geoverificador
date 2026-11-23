/**
 * capas.ts — Las capas de datos del mapa web, servidas desde la base por ventana y zoom (`@geoverificador/datos/capas`).
 *
 * Son las capas de la aplicación estática (`public/js/capas.js` y `capas-ui.js`) que la base realmente tiene. Cada una dice su fuente, la fecha de sus datos y lo
 * que NO dice (las informativas no puntúan ni afirman nada del predio). Quedan fuera las que la base no sirve: el censo por manzana (3 000 polígonos con su
 * porcentaje por servicio), el riesgo por distrito del CENEPRED y las denuncias (módulo desactivado en la aplicación estática).
 *
 * Lo que sale hacia el navegador no son las propiedades crudas de la base, sino lo que el mapa dibuja: título, detalle y color (y, según la capa, nivel, letra o radio).
 */
import { capaRecortada, ErrorDeCapa, limitesDeCapa, validarCaja, type Caja } from '@geoverificador/datos/capas';
import type { Base } from '@geoverificador/datos/cliente';

export type GrupoDeCapa = 'Servicios' | 'Zonificación' | 'Riesgo' | 'Movilidad' | 'Límites';
export type FormaDeCapa = 'punto' | 'poligono' | 'linea';

export interface DefCapa {
  id: string;
  titulo: string;
  grupo: GrupoDeCapa;
  /** Clave de `capaRecortada` en packages/datos. */
  clave: string;
  forma: FormaDeCapa;
  /** Archivos de public/data de donde salen los datos (de ahí la fecha). */
  archivos: string[];
  /** Lo que la capa no dice. */
  nota: string;
  leyenda: { texto: string; color: string; letra?: string }[];
}

const OSM_NOTA = 'Sale de OpenStreetMap, un mapa colaborativo: puede faltar un lugar que existe o figurar uno que ya cerró.';
const NIVEL = { inicial: { color: '#9a4d00', letra: 'I' }, primaria: { color: '#1c3a6b', letra: 'P' }, secundaria: { color: '#6b2d7a', letra: 'S' } } as const;
const VOLCAN = { alto: '#a31621', moderado: '#e07b00', bajo: '#e9c046' } as const;
const MINERIA = { TITULADO: '#7c2d12', 'EN TRÁMITE': '#a16207', OTRO: '#6b7280' } as const;

export const CAPAS_MAPA: DefCapa[] = [
  {
    id: 'colegios', titulo: 'Colegios', grupo: 'Servicios', clave: 'lugar:educacion', forma: 'punto', archivos: ['equipamiento/educacion.geojson'],
    nota: 'Padrón oficial de ESCALE (MINEDU). Los colegios de OpenStreetMap que completan el mapa donde falta un registro oficial se usan para medir distancias en la ficha, pero aquí no se dibujan.',
    leyenda: [{ texto: 'Inicial', ...NIVEL.inicial }, { texto: 'Primaria', ...NIVEL.primaria }, { texto: 'Secundaria', ...NIVEL.secundaria }],
  },
  {
    id: 'salud', titulo: 'Salud', grupo: 'Servicios', clave: 'lugar:salud', forma: 'punto', archivos: ['equipamiento/salud.geojson'],
    nota: 'Registro oficial de RENIPRESS (SUSALUD); sin los consultorios, que son otra categoría. Los establecimientos de OpenStreetMap de respaldo no se dibujan.',
    leyenda: [{ texto: 'Establecimiento de salud', color: '#b0272b', letra: '+' }],
  },
  {
    id: 'consultorios', titulo: 'Consultorios médicos', grupo: 'Servicios', clave: 'lugar:consultorios', forma: 'punto', archivos: ['equipamiento/consultorios.geojson'],
    nota: 'Categoría aparte de la salud y solo informativa: no tiene distancia de referencia.',
    leyenda: [{ texto: 'Consultorio médico', color: '#0f6b6b', letra: 'C' }],
  },
  { id: 'mercados', titulo: 'Mercados', grupo: 'Servicios', clave: 'lugar:mercados', forma: 'punto', archivos: ['equipamiento/mercados.geojson'], nota: `Solo informativa. ${OSM_NOTA}`, leyenda: [{ texto: 'Mercado', color: '#9a3412', letra: 'M' }] },
  { id: 'supermercados', titulo: 'Supermercados', grupo: 'Servicios', clave: 'lugar:supermercados', forma: 'punto', archivos: ['equipamiento/supermercados.geojson'], nota: `Solo informativa. ${OSM_NOTA}`, leyenda: [{ texto: 'Supermercado', color: '#065f46', letra: 'S' }] },
  { id: 'malls', titulo: 'Centros comerciales y galerías', grupo: 'Servicios', clave: 'lugar:malls', forma: 'poligono', archivos: ['equipamiento/malls.geojson'], nota: `Solo informativa; la forma es la de OpenStreetMap. ${OSM_NOTA}`, leyenda: [{ texto: 'Mall o galería', color: '#9d174d' }] },
  { id: 'finanzas', titulo: 'Bancos y cajeros', grupo: 'Servicios', clave: 'lugar:finanzas', forma: 'punto', archivos: ['equipamiento/finanzas.geojson'], nota: `Solo informativa. ${OSM_NOTA}`, leyenda: [{ texto: 'Banco', color: '#1e40af', letra: '$' }, { texto: 'Cajero', color: '#0e7490', letra: 'A' }] },
  { id: 'comida', titulo: 'Restaurantes y cafés', grupo: 'Servicios', clave: 'lugar:comida_fuera', forma: 'punto', archivos: ['equipamiento/comida_fuera.geojson'], nota: `Solo informativa. ${OSM_NOTA}`, leyenda: [{ texto: 'Restaurante', color: '#b91c1c', letra: 'R' }, { texto: 'Café', color: '#78350f', letra: 'T' }] },
  { id: 'recreacion', titulo: 'Juegos infantiles', grupo: 'Servicios', clave: 'lugar:recreacion', forma: 'punto', archivos: ['equipamiento/recreacion.geojson'], nota: `Solo informativa; los parques son la capa «Parques». ${OSM_NOTA}`, leyenda: [{ texto: 'Juegos infantiles', color: '#15803d', letra: 'J' }] },
  { id: 'paraderos', titulo: 'Paraderos', grupo: 'Servicios', clave: 'lugar:transporte', forma: 'punto', archivos: ['equipamiento/transporte.geojson'], nota: `Los paraderos de OpenStreetMap son parciales: un paradero ausente puede existir. ${OSM_NOTA}`, leyenda: [{ texto: 'Paradero', color: '#3b4a5a', letra: 'B' }] },
  { id: 'parques', titulo: 'Parques y áreas verdes', grupo: 'Servicios', clave: 'lugar:areasVerdes', forma: 'poligono', archivos: ['equipamiento/areas_verdes.geojson'], nota: OSM_NOTA, leyenda: [{ texto: 'Área verde', color: '#2f7d3b' }] },
  {
    id: 'acopio', titulo: 'Puntos de acopio de agua', grupo: 'Servicios', clave: 'lugar:acopio', forma: 'punto', archivos: ['agua/puntos_acopio.geojson'],
    nota: 'Lugares de reparto con camiones cisterna ante un desabastecimiento (directorio publicado en 2024 con datos de 2017): no son una conexión ni agua garantizada.',
    leyenda: [{ texto: 'Punto de acopio', color: '#0369a1', letra: 'H' }],
  },
  {
    id: 'electricidad', titulo: 'Concesión eléctrica', grupo: 'Servicios', clave: 'electricidad', forma: 'poligono', archivos: ['electricidad/concesiones_distribucion.geojson'],
    nota: 'Es el área en que una empresa debe dar el servicio; no dice que un predio esté conectado ni que haya red en su calle. Los bordes son poco detallados.',
    leyenda: [{ texto: 'Área de concesión de distribución', color: '#b45309' }],
  },
  {
    id: 'zonificacion', titulo: 'Zonificación (PDM 2016-2025)', grupo: 'Zonificación', clave: 'zonas', forma: 'poligono', archivos: ['zonas_aqp.geojson'],
    nota: 'Plano del PDM 2016-2025, de vigencia cumplida y extraído de un PDF: cerca del borde entre dos zonas el resultado puede no ser exacto. Confirma con el certificado municipal.',
    leyenda: [{ texto: 'El color es el de cada zona del plano; toca una zona para ver su código y su regla', color: '#b88a2e' }],
  },
  {
    id: 'volcan', titulo: 'Peligro volcánico (Misti)', grupo: 'Riesgo', clave: 'volcanZonas', forma: 'poligono', archivos: ['peligro_volcanico_misti.geojson'],
    nota: 'Zonas del IGP (lahares, flujos piroclásticos, lava y avalanchas), de escala regional y sin fecha de elaboración. La ceniza cubre toda la ciudad y no se dibuja. No es una evaluación del predio.',
    leyenda: [{ texto: 'Peligro alto', color: VOLCAN.alto }, { texto: 'Peligro moderado', color: VOLCAN.moderado }, { texto: 'Peligro bajo', color: VOLCAN.bajo }],
  },
  {
    id: 'quebradas', titulo: 'Quebradas y ríos', grupo: 'Riesgo', clave: 'cauces', forma: 'linea', archivos: ['quebradas_aqp.geojson'],
    nota: 'Ninguna fuente es completa, no es un mapa de peligro de huaicos ni de inundación y no delimita la faja marginal.',
    leyenda: [{ texto: 'Cauce (ANA, IGP u OpenStreetMap)', color: '#1f6fb2' }],
  },
  {
    id: 'geologicos', titulo: 'Peligros geológicos', grupo: 'Riesgo', clave: 'geologicos', forma: 'punto', archivos: ['peligros_aqp.geojson'],
    nota: 'Inventario de eventos documentados por INGEMMET, no un mapa de susceptibilidad: que no haya registros cerca no significa que el lugar sea seguro.',
    leyenda: [{ texto: 'Evento registrado', color: '#7c2d12' }],
  },
  {
    id: 'sismos', titulo: 'Sismos reportados', grupo: 'Riesgo', clave: 'sismos', forma: 'punto', archivos: ['sismos_igp.geojson'],
    nota: 'Ventana reciente de la capa «Sismos Reportados» del IGP, no el catálogo histórico. No predice sismos. El círculo es más grande cuanto mayor la magnitud.',
    leyenda: [{ texto: 'Sismo (mayor círculo, mayor magnitud)', color: '#c2570c' }],
  },
  {
    id: 'mineria', titulo: 'Concesiones mineras', grupo: 'Riesgo', clave: 'mineria', forma: 'poligono', archivos: ['mineria/concesiones_mineras.geojson'],
    nota: 'Una concesión es un derecho sobre los minerales (Catastro Minero de INGEMMET, referencial): no dice que haya minería ni de quién es el predio. Las extinguidas no se dibujan.',
    leyenda: [{ texto: 'Titulada', color: MINERIA.TITULADO }, { texto: 'En trámite', color: MINERIA['EN TRÁMITE'] }, { texto: 'Otra', color: MINERIA.OTRO }],
  },
  {
    id: 'rutas', titulo: 'Rutas de combi y bus', grupo: 'Movilidad', clave: 'rutas', forma: 'linea', archivos: ['rutas_osm.geojson'],
    nota: 'Recorridos mapeados por la comunidad de OpenStreetMap (ODbL): sin frecuencias ni horarios, y un cambio de ruta por tramos puede no estar reflejado.',
    leyenda: [{ texto: 'Un color por línea; toca un recorrido para ver su nombre', color: '#3b4a5a' }],
  },
  { id: 'distritos', titulo: 'Límites de distrito', grupo: 'Límites', clave: 'distritos', forma: 'poligono', archivos: ['distritos_aqp.geojson'], nota: 'Límites del INEI; solo contorno.', leyenda: [{ texto: 'Límite de distrito', color: '#33415c' }] },
];

/** Radio en píxeles de un círculo de sismo: crece con la magnitud, entre 3 y 16 (como en la aplicación estática). */
export function radioSismoPx(magnitud: number): number {
  return Math.round(Math.min(16, Math.max(3, 3 + (magnitud - 2) * 2.4)));
}

/** Fecha de los datos según los metadatos del archivo (cada descargador la llama distinto): la misma regla de packages/datos/src/cargar.ts. */
const dia = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const fechaDe = (m: Record<string, unknown>): string | null => dia(m.fecha_extraccion) ?? dia(m.fecha_descarga) ?? dia(m.descargado) ?? dia(m.fecha_publicacion);

const coma = (n: number) => String(n).replace('.', ',');
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sinNombre = (p: Record<string, any>, que: string) => (typeof p.nombre === 'string' && p.nombre.trim() ? p.nombre.trim() : `${que} sin nombre en OpenStreetMap`);

export interface PropiedadesDeCapa {
  titulo: string;
  detalle: string;
  color: string;
  nivel?: string;
  letra?: string;
  radioPx?: number;
}

type Describir = (p: Record<string, any>, ctx: Contexto) => PropiedadesDeCapa;
interface Contexto {
  reglas: Record<string, { nombre?: string }>;
}

const lugarOsm = (que: string, color: string, letra: string): Describir => (p) => ({ titulo: sinNombre(p, que), detalle: que, color, letra });

const DESCRIBIR: Record<string, Describir> = {
  colegios: (p) => {
    const niveles: string[] = (Array.isArray(p.niveles) ? p.niveles : []).filter((n: string) => n in NIVEL);
    const nivel = (['inicial', 'primaria', 'secundaria'] as const).find((n) => niveles.includes(n)) ?? 'primaria';
    const gestion = p.instituciones?.[0]?.gestion;
    return { titulo: p.nombre || 'Colegio sin nombre', detalle: `${niveles.map(mayus).join(', ') || 'Sin nivel'}${gestion ? ` · ${gestion}` : ''}${p.distrito ? ` · ${mayus(String(p.distrito).toLowerCase())}` : ''}`, color: NIVEL[nivel].color, nivel, letra: NIVEL[nivel].letra };
  },
  salud: (p) => ({ titulo: p.nombre || 'Establecimiento sin nombre', detalle: [p.categoria, p.clasificacion && mayus(String(p.clasificacion).toLowerCase())].filter(Boolean).join(' · ') || 'Establecimiento de salud', color: '#b0272b', letra: '+' }),
  consultorios: (p) => ({ titulo: p.nombre || 'Consultorio sin nombre', detalle: [p.categoria, p.distrito && mayus(String(p.distrito).toLowerCase())].filter(Boolean).join(' · ') || 'Consultorio médico', color: '#0f6b6b', letra: 'C' }),
  mercados: lugarOsm('Mercado', '#9a3412', 'M'),
  supermercados: lugarOsm('Supermercado', '#065f46', 'S'),
  malls: (p) => ({ titulo: sinNombre(p, 'Centro comercial'), detalle: p.tags?.shop === 'mall' ? 'Centro comercial o galería (shop=mall en OpenStreetMap)' : 'Centro comercial', color: '#9d174d' }),
  finanzas: (p) => (p.tipo === 'cajero' ? { titulo: sinNombre(p, 'Cajero'), detalle: 'Cajero automático', color: '#0e7490', letra: 'A' } : { titulo: sinNombre(p, 'Banco'), detalle: 'Banco', color: '#1e40af', letra: '$' }),
  comida: (p) => (p.tipo === 'cafe' ? { titulo: sinNombre(p, 'Café'), detalle: 'Café', color: '#78350f', letra: 'T' } : { titulo: sinNombre(p, 'Restaurante'), detalle: 'Restaurante', color: '#b91c1c', letra: 'R' }),
  recreacion: lugarOsm('Juegos infantiles', '#15803d', 'J'),
  paraderos: lugarOsm('Paradero', '#3b4a5a', 'B'),
  parques: (p) => ({ titulo: sinNombre(p, 'Área verde'), detalle: 'Parque o área verde (OpenStreetMap); la distancia se mide hasta su borde', color: '#2f7d3b' }),
  acopio: (p) => ({ titulo: p.direccion ? String(p.direccion).replace(/\.$/, '') : 'Punto de acopio sin dirección', detalle: `Punto de acopio de agua${p.distrito ? ` · ${mayus(String(p.distrito).toLowerCase())}` : ''} (datos de 2017)`, color: '#0369a1', letra: 'H' }),
  electricidad: (p) => ({ titulo: p.concesionaria || p.empresa || 'Concesión eléctrica', detalle: [p.nombre_zona, p.situacion && mayus(String(p.situacion).toLowerCase())].filter(Boolean).join(' · ') || 'Área de concesión de distribución', color: '#b45309' }),
  zonificacion: (p, ctx) => ({ titulo: p.codigo || 'Zona', detalle: ctx.reglas[p.codigo]?.nombre || 'Código sin reglas en la tabla del PDM', color: p.color || '#b88a2e' }),
  volcan: (p) => {
    const nivel = (['alto', 'moderado', 'bajo'] as const).find((n) => n === p.nivel) ?? 'bajo';
    return { titulo: `${mayus(String(p.tipo ?? 'zona').replace(/_/g, ' '))} · peligro ${nivel}`, detalle: p.detalle || p.etiqueta || 'Zona de peligro volcánico del Misti (IGP)', color: VOLCAN[nivel] };
  },
  quebradas: (p) => ({ titulo: p.nombre || 'Cauce sin nombre', detalle: `Fuente del trazado: ${p.fuente || 'sin dato'}${Array.isArray(p.tambienEn) && p.tambienEn.length ? `; también en ${p.tambienEn.join(', ')}` : ''}`, color: '#1f6fb2' }),
  geologicos: (p) => ({ titulo: p.subtipo || p.tipo || 'Peligro geológico', detalle: [p.anio, p.sector && `«${p.sector}»`, p.distrito].filter(Boolean).join(' · ') || 'Evento registrado', color: '#7c2d12' }),
  sismos: (p) => ({
    titulo: `Sismo de magnitud ${coma(Number(p.magnitud))}`,
    detalle: [p.fecha, Number.isFinite(p.profundidadKm) ? `${p.profundidadKm} km de profundidad` : null, p.ref].filter(Boolean).join(' · '),
    color: '#c2570c',
    radioPx: radioSismoPx(Number(p.magnitud)),
  }),
  mineria: (p) => ({
    titulo: p.nombre || p.codigo || 'Concesión minera',
    detalle: [p.estado, p.sustancia, p.hectareas ? `${Math.round(p.hectareas)} ha` : null].filter(Boolean).join(' · '),
    color: MINERIA[p.estado as keyof typeof MINERIA] ?? MINERIA.OTRO,
  }),
  rutas: (p) => ({ titulo: `Línea ${p.linea || 'sin código'}`, detalle: [p.ramal && `Ramal ${p.ramal}`, p.desde && p.hasta && `${p.desde} → ${p.hasta}`].filter(Boolean).join(' · ') || p.nombre || 'Recorrido mapeado', color: p.color || '#3b4a5a' }),
  distritos: (p) => ({ titulo: mayus(String(p.distrito || p.nombre || 'Distrito').toLowerCase()), detalle: 'Límite de distrito (INEI)', color: '#33415c' }),
};

export interface CapaInfo {
  id: string;
  titulo: string;
  grupo: GrupoDeCapa;
  forma: FormaDeCapa;
  nota: string;
  leyenda: DefCapa['leyenda'];
  zoomMin: number;
  maximo: number;
  fuente: { nombre: string; fecha: string | null; licencia: string | null; url: string | null };
}

/** El catálogo con la fuente y la fecha de cada capa, leídas de la base (la fecha es la de extracción del archivo; null si la base no la tiene). */
export async function catalogoDeCapas(base: Base): Promise<CapaInfo[]> {
  const filas = await base.consulta(
    `SELECT a.ruta, a.metadatos, f.nombre, f.licencia, f.url, to_char(f.fecha, 'YYYY-MM-DD') AS fecha FROM archivo_dato a JOIN fuente f ON f.id = a.fuente_id`,
  );
  return CAPAS_MAPA.map((c) => {
    const propias = filas.filter((f) => c.archivos.includes(f.ruta));
    const fechas = propias.map((f) => fechaDe(f.metadatos ?? {}) ?? f.fecha).filter(Boolean).sort();
    const f = propias[0];
    const { zoomMin, maximo } = limitesDeCapa(c.clave);
    return { id: c.id, titulo: c.titulo, grupo: c.grupo, forma: c.forma, nota: c.nota, leyenda: c.leyenda, zoomMin, maximo, fuente: { nombre: f?.nombre ?? 'Fuente no registrada en la base', fecha: fechas.at(-1) ?? null, licencia: f?.licencia ?? null, url: f?.url ?? null } };
  });
}

export interface CapaServida {
  capa: string;
  /** Había más elementos que el máximo de la capa: se muestran los primeros y hay que acercar el mapa. */
  recortada: boolean;
  /** Si la ventana está demasiado lejos para esta capa: el zoom mínimo. */
  requiereZoom?: number;
  features: { type: 'Feature'; geometry: any; properties: PropiedadesDeCapa }[];
}

/** Los elementos de una capa en la ventana, con lo que el mapa dibuja de cada uno. */
export async function capaParaMapa(base: Base, id: string, caja: Caja, zoom: number): Promise<CapaServida> {
  const def = CAPAS_MAPA.find((c) => c.id === id);
  if (!def) throw new ErrorDeCapa(`Capa desconocida: ${id}.`);
  const r = await capaRecortada(base, def.clave, caja, zoom);
  const ctx: Contexto = { reglas: {} };
  if (id === 'zonificacion' && r.features.length) ctx.reglas = (await base.consulta(`SELECT contenido FROM documento WHERE archivo = 'reglas_zonas.json'`))[0]?.contenido ?? {};
  const describir = DESCRIBIR[id];
  return {
    capa: id,
    recortada: r.recortada,
    ...(r.requiereZoom ? { requiereZoom: r.requiereZoom } : {}),
    features: r.features.map((f) => ({ type: 'Feature' as const, geometry: f.geometry, properties: describir(f.properties ?? {}, ctx) })),
  };
}

export type LecturaDeCaja = { ok: true; caja: Caja; zoom: number } | { ok: false; error: string };

/** Lee `bbox=oeste,sur,este,norte` y `zoom` de la consulta. */
export function leerCajaYZoom(params: URLSearchParams): LecturaDeCaja {
  const bbox = params.get('bbox');
  const zoomTexto = params.get('zoom');
  if (!bbox || zoomTexto === null) return { ok: false, error: 'Indica bbox=oeste,sur,este,norte y zoom.' };
  const partes = bbox.split(',').map((x) => (x.trim() === '' ? NaN : Number(x)));
  const zoom = zoomTexto.trim() === '' ? NaN : Number(zoomTexto);
  if (partes.length !== 4 || partes.some((n) => !Number.isFinite(n))) return { ok: false, error: 'bbox debe ser oeste,sur,este,norte en grados.' };
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) return { ok: false, error: 'zoom debe ser un número entre 0 y 22.' };
  try {
    return { ok: true, caja: validarCaja(partes), zoom };
  } catch (e) {
    return { ok: false, error: e instanceof ErrorDeCapa ? e.message : 'La caja no es válida.' };
  }
}
