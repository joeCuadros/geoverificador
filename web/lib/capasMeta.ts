/** Lo que se muestra de cada capa en el panel. Sin Leaflet, para que se pueda renderizar en el servidor. */
export interface MetaCapa { etiqueta: string; descripcion: string; grupo: 'Ciudad' | 'Entorno' | 'Peligros'; color: string }

export const capasMeta: Record<string, MetaCapa> = {
  distritos: { etiqueta: 'Distritos', descripcion: 'Límites oficiales (INEI)', grupo: 'Ciudad', color: '#52606d' },
  zonas: { etiqueta: 'Zonificación', descripcion: 'Plano del PDM 2016-2025 (vigencia cumplida)', grupo: 'Ciudad', color: '#e0b3b3' },
  rutas: { etiqueta: 'Rutas de bus', descripcion: 'Combis y buses (OpenStreetMap)', grupo: 'Ciudad', color: '#2f6fed' },
  paraderos: { etiqueta: 'Paraderos', descripcion: 'Paraderos mapeados (parciales)', grupo: 'Ciudad', color: '#2f6fed' },
  salud: { etiqueta: 'Salud', descripcion: 'Establecimientos (RENIPRESS)', grupo: 'Entorno', color: '#d9381e' },
  educacion: { etiqueta: 'Colegios', descripcion: 'Padrón ESCALE (MINEDU)', grupo: 'Entorno', color: '#e69a00' },
  universidades: { etiqueta: 'Universidades', descripcion: 'Licenciadas por Sunedu', grupo: 'Entorno', color: '#7a3fc4' },
  censo: { etiqueta: 'Manzanas del censo', descripcion: 'Cobertura de agua, luz y desagüe (2017); desde zoom 15', grupo: 'Entorno', color: '#1a7f4b' },
  cauces: { etiqueta: 'Quebradas y ríos', descripcion: 'Cauces (peligro de huaico)', grupo: 'Peligros', color: '#0b7285' },
  volcan: { etiqueta: 'Peligro volcánico', descripcion: 'Mapa del IGP (Misti)', grupo: 'Peligros', color: '#c2410c' },
};
