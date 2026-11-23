/**
 * Límite sencillo de solicitudes por cliente en una ventana de tiempo (por proceso). Devuelve `permitido(clave)`: true si la solicitud entra.
 * En producción lo respalda la tabla conversacion_uso; esto solo evita que un cliente sature una ruta.
 */
export function crearLimitador(maximo: number, ventanaMs: number, reloj: () => number = Date.now): (clave: string) => boolean {
  const usos = new Map<string, { desde: number; n: number }>();
  return (clave) => {
    const ahora = reloj();
    const u = usos.get(clave);
    if (!u || ahora - u.desde > ventanaMs) {
      usos.set(clave, { desde: ahora, n: 1 });
      return true;
    }
    return ++u.n <= maximo;
  };
}

/** El cliente según el primer valor de x-forwarded-for; sin esa cabecera, «local». */
export function clienteDe(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}
