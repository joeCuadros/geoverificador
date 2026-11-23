export interface Punto { lat: number; lon: number }
export interface Etiquetado extends Punto { nombre?: string }

export interface Dato {
  estado?: string;
  nombre?: string | null;
  distanciaM?: number | null;
  umbralM?: number | null;
  fuente?: string;
  fecha?: string;
  metodo?: string;
  lat?: number;
  lon?: number;
  [k: string]: any;
}

export interface Ficha {
  punto: Punto;
  distrito: { ubigeo: string; nombre: string; props: Record<string, any> } | null;
  zona: { codigo: string; color: string | null; regla: Record<string, any> | null; fuenteId: string } | null;
  entorno: Record<string, any>;
  peligros: { clase: string; tipo: string; nivel: string | null; nombre: string | null; props: Record<string, any>; distanciaM: number | null; fuenteId: string }[];
}

export interface CriterioAviso { id: string; etiqueta: string; cumple: boolean | null; valor: string; pedido: string; referencia: string | null; fuente: string | null; fecha: string | null; nota: string; convencion: boolean }
export interface Aviso {
  id: number; titulo: string | null; url: string; fuente: string; tipo: string | null; precio: number | null; moneda: string | null; precioPen: number | null; tipoCambio: number | null; tipoCambioFecha: string | null;
  areaM2: number | null; dormitorios: number | null; distrito: string | null; lat: number | null; lon: number | null; vistoPorUltimaVez: string; tambienEn: string[];
  criterios: CriterioAviso[]; cumplidos: number; sinDato: number; pedidos: number;
}
