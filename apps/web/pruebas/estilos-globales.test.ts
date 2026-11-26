import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Lo que se pidió de app/globals.css, sin abrir un navegador: contrastes de los tokens y que las marcas del mapa usen la tinta del mapa (el fondo del mapa es siempre claro). */
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

const bloqueOscuro = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
const bloqueClaro = css.match(/^:root \{([^}]*)\}/m)?.[1] ?? '';
const token = (bloque: string, nombre: string): string => {
  const v = bloque.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!v) throw new Error(`Falta el token ${nombre}`);
  return v;
};
const canal = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminancia = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
};
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** El cuerpo de la primera regla cuyo selector contiene `selector` (sin media queries anidadas: basta para estas reglas). */
const regla = (selector: string): string => {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`Falta la regla ${selector}`);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
};

describe('contraste de los tokens', () => {
  it('el borde ámbar del tema oscuro se distingue de su fondo (≥ 4,4:1; era 2,85:1)', () => {
    expect(contraste(token(bloqueOscuro, '--amb-line'), token(bloqueOscuro, '--amb-bg'))).toBeGreaterThanOrEqual(4.4);
  });

  it('el borde ámbar del tema claro sigue bastando como componente de interfaz (≥ 3:1)', () => {
    expect(contraste(token(bloqueClaro, '--amb-line'), token(bloqueClaro, '--amb-bg'))).toBeGreaterThanOrEqual(3);
  });

  it('la tinta del mapa se lee sobre el fondo siempre claro del mapa y sobre el blanco de las marcas (≥ 3:1)', () => {
    const tinta = token(bloqueClaro, '--tinta-mapa');
    expect(contraste(tinta, '#ece9e0')).toBeGreaterThanOrEqual(3); // la tesela de fondo de las pruebas, de claridad parecida a la de OpenStreetMap
    expect(contraste(tinta, '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('la tinta del mapa no cambia con el tema (no está redefinida en el tema oscuro)', () => {
    expect(bloqueOscuro).not.toMatch(/--tinta-mapa/);
  });
});

describe('las marcas dibujadas sobre el mapa usan la tinta del mapa, no los tokens del tema', () => {
  it.each([
    ['el punto elegido', '.marcador-punto span { width'],
    ['el aro de foco de un marcador', '.leaflet-marker-icon:focus-visible {'],
    ['el lugar activo', '.leaflet-marker-icon.ent-activo span {'],
    ['el aviso activo', '.leaflet-marker-icon.marcador-aviso.ent-activo span {'],
  ])('%s', (_nombre, selector) => {
    const r = regla(selector);
    expect(r).toMatch(/var\(--tinta-mapa\)/);
    expect(r).not.toMatch(/var\(--(tinta|focus)\)/);
  });
});

describe('texto y objetivos', () => {
  it('el cuerpo usa rem, no px: respeta el tamaño de letra que la persona eligió en el navegador', () => {
    expect(regla('body { font')).toMatch(/font:\s*1rem\/1\.5/);
    expect(regla('body { font')).not.toMatch(/\d+px\//);
  });

  it('el botón del cuadro de un aviso mide 44 px en pantallas táctiles', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)[^{]*\{\s*\.cuadro-aviso button \{ min-height: 44px; \}/);
  });

  it('hay scroll-padding en la página y en el panel, y se conserva la regla de movimiento reducido', () => {
    expect(regla('html {')).toMatch(/scroll-padding-top/);
    expect(regla('.cuerpo-panel {')).toMatch(/scroll-padding-top/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('las familias usan las variables que define layout.tsx (next/font) y conservan su nombre y el sistema como respaldo', () => {
    expect(css).toMatch(/--sans:\s*var\(--fuente-sans, system-ui\), 'Instrument Sans', system-ui/);
    expect(css).toMatch(/--titulo:\s*var\(--fuente-titulo, system-ui\), 'Bricolage Grotesque', system-ui/);
    // Los títulos usan la familia de títulos; la prosa ya no va en serif.
    expect(regla('h1, h2, h3, h4 {')).toMatch(/var\(--titulo\)/);
    expect(css).not.toMatch(/var\(--serif\)/);
  });
});
