export type ParteDeTexto = { tipo: 'texto' | 'enlace'; valor: string };

const URL_HTTP = /https?:\/\/[^\s<>"]+/gi;
const PUNTUACION_FINAL = /[.,;:!?)\]»”'’]+$/;

/** Parte un texto en tramos de texto y enlaces http(s), para dibujar los enlaces como tales sin tocar el HTML. La puntuación final no es parte del enlace. */
export function partirEnlaces(texto: string): ParteDeTexto[] {
  const partes: ParteDeTexto[] = [];
  let desde = 0;
  const agregar = (tipo: ParteDeTexto['tipo'], valor: string) => {
    if (!valor) return;
    const ultima = partes.at(-1);
    if (ultima && ultima.tipo === tipo) ultima.valor += valor;
    else partes.push({ tipo, valor });
  };
  for (const m of texto.matchAll(URL_HTTP)) {
    const enlace = m[0].replace(PUNTUACION_FINAL, '');
    agregar('texto', texto.slice(desde, m.index));
    agregar('enlace', enlace);
    desde = m.index + enlace.length;
  }
  agregar('texto', texto.slice(desde));
  return partes;
}
