import { crc32, deflateSync } from 'node:zlib';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { CLAVE_VISTO } from '../lib/onboarding.ts';

/** Un PNG de 1×1 píxel del color dado (el color del fondo del mapa en las pruebas). */
function pngDeUnPixel(r: number, g: number, b: number): Buffer {
  const trozo = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(1, 0);
  cabecera.writeUInt32BE(1, 4);
  cabecera[8] = 8; // 8 bits por canal
  cabecera[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', cabecera), trozo('IDAT', deflateSync(Buffer.from([0, r, g, b]))), trozo('IEND', Buffer.alloc(0))]);
}

/** Una tesela de 1×1 píxel: el mapa no depende de tile.openstreetmap.org, así que las pruebas no dependen de internet. */
const TESELA = pngDeUnPixel(236, 233, 224);

export const test = base.extend<{ onboardingVisto: boolean }>({
  // La guía de primera visita no debe tapar las demás pruebas: por omisión el navegador ya la vio. e2e/onboarding.spec.ts usa `test.use({ onboardingVisto: false })`.
  onboardingVisto: [true, { option: true }],
  page: async ({ page, baseURL, onboardingVisto }, use) => {
    if (onboardingVisto) await page.addInitScript((clave) => { try { window.localStorage.setItem(clave, '1'); } catch { /* sin almacenamiento */ } }, CLAVE_VISTO);
    await page.route('**/*', (ruta) => {
      const url = ruta.request().url();
      if (url.startsWith(baseURL!) || url.startsWith('data:') || url.startsWith('blob:')) return ruta.continue();
      if (url.startsWith('https://tile.openstreetmap.org/')) return ruta.fulfill({ contentType: 'image/png', body: TESELA });
      return ruta.abort(); // ningún otro recurso externo
    });
    await use(page);
  },
});
export { expect };

/** Centro inicial del mapa: la Plaza de Armas (CONFIG.center). */
export const PLAZA = { lat: -16.39883, lon: -71.53697 };
/** Ubicación de los avisos de prueba de e2e/datos/avisos.json. */
export const AVISO_1 = { lat: -16.3905, lon: -71.5435, titulo: 'Departamento de prueba en Yanahuara', url: 'https://portal.example/inmueble/e2e-yanahuara-1' };
export const AVISO_2 = { lat: -16.3935, lon: -71.5465, titulo: 'Departamento de prueba amplio en Yanahuara', url: 'https://portal.example/inmueble/e2e-yanahuara-2' };
export const CONSULTA_AVISOS = 'un departamento en Yanahuara cerca de un colegio hasta 450 mil soles';

export const mapa = (page: Page): Locator => page.locator('.mapa');
export const ficha = (page: Page): Locator => page.getByTestId('ficha');

export async function abrir(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.mapa[data-listo="si"]')).toBeVisible();
}

/** Escribe en el chat, envía y espera la respuesta del asistente. Devuelve la burbuja de esa respuesta. */
export async function preguntar(page: Page, texto: string): Promise<Locator> {
  const antes = await page.locator('.burbuja-agente').count();
  await page.getByLabel('Tu consulta').fill(texto);
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.locator('.burbuja-agente')).toHaveCount(antes + 1);
  return page.locator('.burbuja-agente').last();
}

/** Lee «-16.39883, -71.53697» (punto decimal, latitud y longitud separadas por coma) como números. */
export function leerCoordenadas(texto: string): { lat: number; lon: number } {
  const [lat, lon] = texto.split(',').map((x) => Number(x.trim()));
  return { lat, lon };
}

/** El marcador de un aviso en el mapa por su título: se llama «Aviso N: título», con el número de su tarjeta. */
export const marcadorDeAviso = (page: Page, titulo: string): Locator => {
  const literal = titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', { name: new RegExp(`^Aviso \\d+: ${literal}$`) });
};

/** Un clic en el mapa a (dx, dy) píxeles de su centro. */
export async function clicEnMapa(page: Page, dx = 80, dy = -60): Promise<void> {
  const caja = (await mapa(page).boundingBox())!;
  await page.mouse.click(caja.x + caja.width / 2 + dx, caja.y + caja.height / 2 + dy);
}

/** Aleja el mapa `veces` niveles de zoom, esperando a que la escala cambie después de cada uno (Leaflet anima el zoom). */
export async function alejar(page: Page, veces: number): Promise<void> {
  const escala = page.locator('.leaflet-control-scale-line').first();
  for (let i = 0; i < veces; i++) {
    const antes = await escala.innerText();
    await page.locator('.leaflet-control-zoom-out').click();
    await expect(escala).not.toHaveText(antes);
  }
}

/** Las alertas de la aplicación (excluye el anunciador de rutas de Next, que también tiene role="alert"). */
export const alerta = (page: Page): Locator => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** Zoom y centro del mapa, tal como los anota el componente del mapa en `data-vista`. */
export async function vista(page: Page): Promise<{ zoom: number; lat: number; lon: number }> {
  const [zoom, lat, lon] = ((await mapa(page).getAttribute('data-vista')) ?? '').split('|').map(Number);
  return { zoom, lat, lon };
}

/** Las capas de datos dibujadas y su número de elementos (`data-capas="colegios:418,salud:112"`). */
export async function capasDibujadas(page: Page): Promise<Record<string, number>> {
  const texto = (await mapa(page).getAttribute('data-capas')) ?? '';
  return Object.fromEntries(texto.split(',').filter(Boolean).map((p) => [p.split(':')[0], Number(p.split(':')[1])]));
}

export const botonDeCapas = (page: Page): Locator => page.getByRole('button', { name: /Capas del mapa/ });
export const panelDeCapas = (page: Page): Locator => page.locator('.capas-panel');

export async function abrirCapas(page: Page): Promise<void> {
  if ((await botonDeCapas(page).getAttribute('aria-expanded')) !== 'true') await botonDeCapas(page).click();
  await expect(panelDeCapas(page)).toBeVisible();
}

/** La casilla de una capa por su título. */
export const casillaDeCapa = (page: Page, titulo: string): Locator => page.getByRole('checkbox', { name: titulo, exact: true });

/** El contenedor de una capa en el panel (su casilla, su estado, su leyenda, su nota y su fuente). */
export const capaEnPanel = (page: Page, titulo: string): Locator => page.locator('.capa', { has: page.getByRole('checkbox', { name: titulo, exact: true }) });

export async function activarCapa(page: Page, titulo: string): Promise<void> {
  await abrirCapas(page);
  await casillaDeCapa(page, titulo).check();
}
