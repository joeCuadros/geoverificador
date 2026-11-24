/**
 * La interfaz del mapa: buscador, barra de botones y panel de capas conviven sin taparse en un teléfono (375 px) y en una tableta (768 px); el panel dice qué capas están
 * activas con icono y texto, su leyenda usa los colores del mapa y se maneja con el teclado; el buscador tiene etiqueta, botón de borrar, estados anunciados y una lista
 * que se recorre con las flechas.
 */
import type { Locator, Page } from '@playwright/test';
import { abrir, abrirCapas, activarCapa, alerta, botonDeCapas, capaEnPanel, capasDibujadas, casillaDeCapa, expect, ficha, mapa, panelDeCapas, test } from './apoyo.ts';

type Caja = { x: number; y: number; width: number; height: number };
const caja = async (l: Locator): Promise<Caja> => (await l.boundingBox())!;
/** La caja de un elemento dentro del documento (no de la ventana): no cambia si la página se desplaza. */
const cajaEnPagina = (l: Locator): Promise<Caja> => l.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
const seCruzan = (a: Caja, b: Caja) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;
const dentro = (a: Caja, b: Caja) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** Un fondo sin color, tal como lo serializa el navegador (rgba(0, 0, 0, 0) o color(srgb 0 0 0 / 0)). */
const TRANSPARENTE = /(, 0\)| \/ 0\))$/;

const campo = (page: Page) => page.getByRole('searchbox', { name: 'Buscar un lugar' });
const botonBuscar = (page: Page) => page.getByRole('button', { name: 'Buscar', exact: true });
const resultados = (page: Page) => page.getByRole('list', { name: 'Resultados de la búsqueda' });
const estadoDeBusqueda = (page: Page) => page.locator('.buscador-estado');
async function buscar(page: Page, texto: string) {
  await campo(page).fill(texto);
  await botonBuscar(page).click();
}

for (const [nombre, ancho, alto] of [
  ['en un teléfono de 375 px', 375, 667],
  ['en una tableta de 768 px', 768, 1024],
] as const) {
  test.describe(`mapa, buscador y capas ${nombre}`, () => {
    test.use({ viewport: { width: ancho, height: alto }, hasTouch: true, isMobile: true });

    test('el buscador, la barra, el mapa y el panel de capas abierto no se tapan entre sí ni ensanchan la página', async ({ page }) => {
      await abrir(page);
      await activarCapa(page, 'Salud'); // abre el panel y enciende una capa: el panel crece
      const buscador = await caja(page.getByRole('search', { name: 'Buscar un lugar' }));
      const barra = await caja(page.locator('.mapa-barra'));
      const lienzo = await caja(mapa(page));
      const panel = await caja(panelDeCapas(page));
      const zoom = await caja(page.locator('.leaflet-control-zoom'));
      // De arriba abajo: buscador, barra y mapa, cada uno en su sitio.
      expect(seCruzan(buscador, barra)).toBe(false);
      expect(seCruzan(barra, lienzo)).toBe(false);
      expect(seCruzan(buscador, lienzo)).toBe(false);
      // El panel se abre dentro del mapa: no pisa el buscador ni la barra (sus botones), ni los botones de zoom, y cabe en la pantalla.
      expect(dentro(panel, lienzo)).toBe(true);
      expect(seCruzan(panel, buscador)).toBe(false);
      expect(seCruzan(panel, barra)).toBe(false);
      expect(seCruzan(panel, zoom)).toBe(false);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(ancho + 0.5);
      // Sigue a la vista la atribución del mapa (OpenStreetMap lo exige): el panel no la tapa.
      expect(seCruzan(panel, await caja(page.locator('.leaflet-control-attribution')))).toBe(false);
      // Se desplaza por dentro y la página no se desborda.
      expect(await panelDeCapas(page).evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
      const [scroll, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(visible);
    });

    test('cada control se toca en 44 px', async ({ page }) => {
      await abrir(page);
      await campo(page).fill('Cayma');
      await activarCapa(page, 'Salud');
      const controles: [string, Locator][] = [
        ['Buscar', botonBuscar(page)],
        ['Borrar búsqueda', page.getByRole('button', { name: 'Borrar búsqueda' })],
        ['Ver ficha del centro', page.getByRole('button', { name: 'Ver ficha del centro del mapa' })],
        ['Capas', botonDeCapas(page)],
        ['Cerrar panel', page.getByRole('button', { name: 'Cerrar panel de capas' })],
        ['Quitar todas', page.getByRole('button', { name: 'Quitar todas' })],
        ['casilla de una capa', page.locator('.capa label').first()],
        ['zoom +', page.locator('.leaflet-control-zoom-in')],
        ['zoom -', page.locator('.leaflet-control-zoom-out')],
      ];
      for (const [que, control] of controles) {
        const c = await caja(control);
        expect(c.height, `${que}: alto`).toBeGreaterThanOrEqual(43.5);
        expect(c.width, `${que}: ancho`).toBeGreaterThanOrEqual(43.5);
      }
    });

    test('los resultados del buscador se despliegan sobre el mapa sin moverlo, y abrir el panel de capas pliega la lista (y al revés)', async ({ page }) => {
      await abrir(page);
      const antes = await cajaEnPagina(mapa(page));
      await abrirCapas(page);
      await buscar(page, 'Real Plaza');
      await expect(resultados(page)).toBeVisible();
      // Los dos no se abren a la vez: el panel se plegó al aparecer la lista.
      await expect(botonDeCapas(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(panelDeCapas(page)).toBeHidden();
      const lista = await caja(resultados(page));
      expect(lista.x).toBeGreaterThanOrEqual(0);
      expect(lista.x + lista.width).toBeLessThanOrEqual(ancho + 0.5);
      expect(seCruzan(lista, await caja(campo(page)))).toBe(false);
      // La lista flota sobre el mapa: el mapa ni se mueve ni cambia de tamaño.
      expect(await cajaEnPagina(mapa(page))).toEqual(antes);
      // Y al revés: abrir el panel (el clic se despacha sin mirar qué hay encima: en 375 px la lista cubre el botón) pliega la lista.
      await botonDeCapas(page).dispatchEvent('click');
      await expect(panelDeCapas(page)).toBeVisible();
      await expect(resultados(page)).toHaveCount(0);
    });
  });
}

test.describe('panel de capas: estado, leyenda y teclado', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('el botón y los grupos están nombrados, y el panel anuncia cuántas capas hay activas', async ({ page }) => {
    await expect(botonDeCapas(page)).toHaveAttribute('aria-controls', 'capas-panel');
    await expect(botonDeCapas(page)).toHaveAccessibleName('Capas del mapa');
    await abrirCapas(page);
    await expect(page.getByRole('group', { name: 'Capas del mapa' })).toBeVisible();
    for (const grupo of ['Servicios', 'Zonificación', 'Riesgo', 'Movilidad', 'Límites']) await expect(panelDeCapas(page).getByRole('group', { name: new RegExp(`^${grupo}`) })).toBeVisible();
    await casillaDeCapa(page, 'Salud').check();
    await expect(botonDeCapas(page)).toHaveAccessibleName('Capas del mapa, 1 activa');
    await casillaDeCapa(page, 'Colegios').check();
    await expect(botonDeCapas(page)).toHaveAccessibleName('Capas del mapa, 2 activas');
    await expect(panelDeCapas(page).getByRole('group', { name: /^Servicios/ })).toContainText('2 activas');
  });

  test('una capa activa se ve activa con icono y texto, no solo con un color; las apagadas no', async ({ page }) => {
    await activarCapa(page, 'Salud');
    const salud = capaEnPanel(page, 'Salud');
    await expect(salud.locator('.capa-chip')).toHaveText('Activa');
    await expect(salud.locator('.capa-chip svg')).toHaveCount(1);
    await expect(casillaDeCapa(page, 'Salud')).toBeChecked();
    await expect(capaEnPanel(page, 'Colegios').locator('.capa-chip')).toHaveCount(0);
    // La casilla marcada dibuja su marca (no es solo un relleno de color): es la del tema, pero el trazo existe.
    const marca = await casillaDeCapa(page, 'Salud').evaluate((e) => getComputedStyle(e, '::after').content);
    expect(marca).not.toBe('none');
    const apagada = await casillaDeCapa(page, 'Colegios').evaluate((e) => getComputedStyle(e, '::after').content);
    expect(apagada).toBe('none');
  });

  test('el estado de cada capa se anuncia como estado y dice si está cargando, cuántos elementos hay o si falló', async ({ page }) => {
    await page.route('**/api/capas/salud?*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'x' }) }));
    await activarCapa(page, 'Salud');
    await activarCapa(page, 'Colegios');
    await expect(capaEnPanel(page, 'Salud').getByRole('status')).toHaveText('No se pudo cargar esta capa. Revisa tu conexión y pulsa Reintentar.');
    await expect(capaEnPanel(page, 'Colegios').getByRole('status')).toHaveText(/^\d+ elementos en esta vista\.$/);
    // Cada estado lleva su icono además del texto.
    await expect(capaEnPanel(page, 'Salud').locator('.capa-estado svg')).toHaveCount(1);
  });

  test('las muestras de la leyenda tienen el color y la forma de lo que el mapa dibuja', async ({ page }) => {
    const respuesta = page.waitForResponse((r) => /\/api\/capas\/colegios\?bbox=/.test(r.url()));
    await activarCapa(page, 'Colegios');
    const j = await (await respuesta).json();
    await expect.poll(async () => (await capasDibujadas(page)).colegios).toBe(j.features.length);
    const capas = await (await page.request.get('/api/capas')).json();
    const colegios = capas.capas.find((c: any) => c.id === 'colegios');
    const delPanel = await capaEnPanel(page, 'Colegios').locator('.muestra').evaluateAll((es) => es.map((e) => ({ fondo: getComputedStyle(e).backgroundColor, redonda: getComputedStyle(e).borderTopLeftRadius, letra: e.textContent })));
    expect(delPanel.map((m) => m.fondo)).toEqual(colegios.leyenda.map((l: any) => rgb(l.color)));
    expect(delPanel.map((m) => m.letra)).toEqual(colegios.leyenda.map((l: any) => l.letra));
    for (const m of delPanel) expect(m.redonda).toBe('50%'); // un punto del mapa es un círculo con su letra
    // Cada marcador dibujado en el mapa lleva uno de esos colores y la letra de su nivel.
    if (j.features.length <= 350) {
      const marcadores = await page.locator('.leaflet-marker-icon.ent-marcador span').evaluateAll((es) => es.map((e) => ({ fondo: getComputedStyle(e).backgroundColor, letra: e.textContent })));
      expect(marcadores.length).toBeGreaterThan(0);
      const colores = new Set(colegios.leyenda.map((l: any) => rgb(l.color)));
      for (const m of marcadores) expect(colores.has(m.fondo), m.fondo).toBe(true);
    }
  });

  test('las capas de contorno discontinuo y los anillos de sismo se muestran como el mapa los dibuja', async ({ page }) => {
    await activarCapa(page, 'Límites de distrito');
    await activarCapa(page, 'Concesión eléctrica');
    await activarCapa(page, 'Sismos reportados');
    await activarCapa(page, 'Quebradas y ríos');
    const estilo = (titulo: string) => capaEnPanel(page, titulo).locator('.muestra').first().evaluate((e) => ({ borde: getComputedStyle(e).borderTopStyle, fondo: getComputedStyle(e).backgroundColor, radio: getComputedStyle(e).borderTopLeftRadius, alto: getComputedStyle(e).borderTopWidth }));
    const distrito = await estilo('Límites de distrito');
    expect(distrito.borde).toBe('dashed');
    expect(distrito.fondo).toMatch(TRANSPARENTE); // solo contorno, como en el mapa
    expect((await estilo('Concesión eléctrica')).borde).toBe('dashed');
    const sismo = await estilo('Sismos reportados');
    expect(sismo.radio).toBe('50%');
    expect(sismo.fondo).not.toMatch(TRANSPARENTE); // relleno suave dentro del anillo
    expect((await estilo('Quebradas y ríos')).borde).toBe('solid'); // un trazo
  });

  test('Esc pliega el panel y devuelve el foco al botón; «Quitar todas» apaga todas las capas', async ({ page }) => {
    await activarCapa(page, 'Salud');
    await activarCapa(page, 'Colegios');
    await expect.poll(async () => Object.keys(await capasDibujadas(page)).sort()).toEqual(['colegios', 'salud']);
    await page.getByRole('button', { name: 'Quitar todas' }).click();
    await expect(botonDeCapas(page)).toHaveAccessibleName('Capas del mapa');
    await expect(casillaDeCapa(page, 'Salud')).not.toBeChecked();
    await expect(casillaDeCapa(page, 'Colegios')).not.toBeChecked();
    await expect.poll(async () => await capasDibujadas(page)).toEqual({});
    await expect(botonDeCapas(page)).toBeFocused();
    await casillaDeCapa(page, 'Salud').focus();
    await page.keyboard.press('Escape');
    await expect(panelDeCapas(page)).toBeHidden();
    await expect(botonDeCapas(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(botonDeCapas(page)).toBeFocused();
  });

  test('el botón «Cerrar panel de capas» pliega el panel', async ({ page }) => {
    await abrirCapas(page);
    await page.getByRole('button', { name: 'Cerrar panel de capas' }).click();
    await expect(panelDeCapas(page)).toBeHidden();
  });

  test('en el tema oscuro el panel usa la superficie oscura y su texto se lee', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await activarCapa(page, 'Salud');
    const { fondo, texto } = await panelDeCapas(page).evaluate((e) => ({ fondo: getComputedStyle(e).backgroundColor, texto: getComputedStyle(e).color }));
    const luz = (c: string) => {
      const [r, g, b] = c.match(/\d+/g)!.map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    expect(luz(fondo)).toBeLessThan(0.25);
    expect(luz(texto)).toBeGreaterThan(0.6);
  });

  test('con movimiento reducido el panel aparece sin animación', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrirCapas(page);
    expect(await panelDeCapas(page).evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });

  test('el aviso de que no cargó el fondo del mapa no queda debajo del cajón de capas', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.route('https://tile.openstreetmap.org/**', (ruta) => ruta.abort());
    await page.reload();
    await expect(page.locator('.mapa-nota')).toBeVisible();
    await abrirCapas(page);
    expect(seCruzan(await caja(page.locator('.mapa-nota')), await caja(panelDeCapas(page)))).toBe(false);
  });
});

test.describe('buscador de lugares: etiqueta, estados y teclado', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('tiene etiqueta visible y un ejemplo en español, y su ayuda se lee con el campo', async ({ page }) => {
    await expect(page.locator('label[for]', { hasText: 'Buscar un lugar' })).toBeVisible();
    await expect(campo(page)).toHaveAttribute('placeholder', /Plaza de Armas/);
    await expect(campo(page)).toHaveAccessibleDescription(/al menos 2 letras/);
  });

  test('el botón de borrar aparece al escribir, vacía el campo y deja el foco en él', async ({ page }) => {
    const borrar = page.getByRole('button', { name: 'Borrar búsqueda' });
    await expect(borrar).toHaveCount(0);
    await buscar(page, 'Real Plaza');
    await expect(resultados(page)).toBeVisible();
    await expect(borrar).toBeVisible();
    await borrar.click();
    await expect(campo(page)).toHaveValue('');
    await expect(campo(page)).toBeFocused();
    await expect(resultados(page)).toHaveCount(0);
    await expect(borrar).toHaveCount(0);
  });

  test('mientras busca lo dice en una región de estado y no deja pedir dos veces', async ({ page }) => {
    let pedidas = 0;
    await page.route('**/api/buscar*', async (ruta) => {
      pedidas++;
      await new Promise((r) => setTimeout(r, 700));
      await ruta.continue();
    });
    await expect(estadoDeBusqueda(page)).toHaveAttribute('role', 'status');
    await expect(estadoDeBusqueda(page)).toHaveAttribute('aria-live', 'polite');
    await campo(page).fill('Real Plaza');
    await campo(page).press('Enter');
    await expect(estadoDeBusqueda(page)).toHaveText('Buscando…');
    await expect(botonBuscar(page)).toHaveAttribute('aria-disabled', 'true');
    await campo(page).press('Enter'); // una segunda pulsación mientras busca no pide de nuevo
    await expect(resultados(page)).toBeVisible();
    expect(pedidas).toBe(1);
    await expect(botonBuscar(page)).toHaveAttribute('aria-disabled', 'false');
  });

  test('anuncia cuántos resultados hay y, si no hay ninguno, lo dice en la misma región', async ({ page }) => {
    await buscar(page, 'Real Plaza');
    // La región solo dice cuántos hay; la lista queda fuera de ella y las instrucciones van en la descripción del campo.
    await expect(estadoDeBusqueda(page)).toHaveText(/^\d+ resultados$/);
    await expect(estadoDeBusqueda(page).getByRole('list')).toHaveCount(0);
    await expect(campo(page)).toHaveAccessibleDescription(/flechas arriba y abajo/);
    await buscar(page, 'zzzxqwv');
    await expect(estadoDeBusqueda(page)).toContainText('Sin resultados para «zzzxqwv» en los datos');
    await expect(estadoDeBusqueda(page)).toBeVisible();
    await expect(resultados(page)).toHaveCount(0);
    await expect(alerta(page)).toHaveCount(0); // «sin resultados» no es un error
  });

  test('un texto corto o un fallo del servidor son alertas, y el campo avisa que es inválido solo en el primer caso', async ({ page }) => {
    await buscar(page, 'a');
    await expect(alerta(page)).toContainText('al menos 2 letras');
    await expect(campo(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(campo(page)).toHaveAccessibleDescription(/al menos 2 letras del lugar que buscas/);
    await page.route('**/api/buscar*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo buscar el lugar. Intenta de nuevo.' }) }));
    await buscar(page, 'Cayma');
    await expect(alerta(page)).toContainText('No se pudo buscar el lugar');
    await expect(campo(page)).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('la lista se recorre con las flechas, Inicio y Fin; Esc la cierra y devuelve el foco al campo', async ({ page }) => {
    await campo(page).fill('Real Plaza');
    await campo(page).press('Enter');
    const items = resultados(page).getByRole('button');
    await expect(items).not.toHaveCount(0);
    const n = await items.count();
    expect(n).toBeGreaterThan(1);
    await campo(page).press('ArrowDown');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.nth(n - 1)).toBeFocused();
    await page.keyboard.press('ArrowDown'); // en el último se queda
    await expect(items.nth(n - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowUp'); // desde el primero, vuelve al campo
    await expect(campo(page)).toBeFocused();
    await campo(page).press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(resultados(page)).toHaveCount(0);
    await expect(campo(page)).toBeFocused();
    await expect(campo(page)).toHaveValue('Real Plaza'); // Esc no borra lo escrito
    await campo(page).press('ArrowDown'); // vuelve a abrirse con los mismos resultados
    await expect(items.nth(0)).toBeFocused();
  });

  test('Esc en el campo cierra la lista sin vaciarlo, y un toque fuera también la cierra', async ({ page }) => {
    await buscar(page, 'Real Plaza');
    await expect(resultados(page)).toBeVisible();
    await campo(page).focus();
    await page.keyboard.press('Escape');
    await expect(resultados(page)).toHaveCount(0);
    await expect(campo(page)).toHaveValue('Real Plaza');
    await campo(page).press('ArrowDown');
    await expect(resultados(page)).toBeVisible();
    await page.locator('.banda h1').click();
    await expect(resultados(page)).toHaveCount(0);
  });

  test('Enter sobre un resultado lo elige: abre su ficha y el foco vuelve al campo', async ({ page }) => {
    await campo(page).fill('Real Plaza');
    await campo(page).press('Enter');
    await expect(resultados(page)).toBeVisible();
    await campo(page).press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(ficha(page)).toBeVisible();
    await expect(resultados(page)).toHaveCount(0);
    await expect(campo(page)).toBeFocused();
  });
});
