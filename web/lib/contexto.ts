/** Lo que devuelve /api/contexto: denuncias del entorno, peligros geológicos y zona sísmica del distrito. */
export interface Contexto {
  delito: { radio: number; conteo: { total: number; ROBO?: number; HURTO?: number }; meta: { meses: number; desde?: string; hasta?: string; ventanaDesde?: string; fuente?: string } } | null;
  distrito: { distrito: string; provincia: string; zona: number | null; z: number | null; norma?: string; definicionZ?: string } | null;
  peligro: { radio: number; total: number; porTipo: [string, number][]; masCercano: { distancia: number } | null } | null;
  precio: { estado: string; distrito?: string; precioM2?: { venta: number }; arriendoMensual?: number | null; nAvisos?: { venta: number; arriendo?: number }; periodo?: unknown; fuente?: string; licencia?: string; atribucion?: string; causa?: string } | null;
  cenepred: { resultado: { estado: string }; lineas: { fenomeno: string; nivel: string; texto: string }[] } | null;
  errores?: (string | null)[];
}
