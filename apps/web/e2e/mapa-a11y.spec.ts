/**
 * El mapa para quien no usa el ratón o no ve el color: se mueve y se elige un punto con el teclado, los cuadros reciben y devuelven el foco, los elementos de las capas tienen
 * una lista como alternativa, los controles de Leaflet hablan español, los marcadores de aviso llevan su número y se tocan con el dedo, y con «movimiento reducido» el
 * mapa no anima. Los errores de las capas dicen qué hacer y tienen su botón «Reintentar».
 */
import type { Page } from '@playwright/test';
import { AVISO_1, CONSULTA_AVISOS, abrir, abrirCapas, activarCapa, alerta, botonDeCapas, capaEnPanel, casillaDeCapa, expect, ficha, leerCoordenadas, mapa, marcadorDeAviso, panelDeCapas, preguntar, test, vista } from './apoyo.ts';

const botonCentro = (page: Page) => page.getByRole('button', { name: 'Ver ficha del centro del mapa' });
/** ¿El foco está dentro del cuadro (ventana emergente) abierto? */
const focoEnElCuadro = (page: Page) => page.evaluate(() => Boolean(document.activeElement?.closest('.leaflet-popup')));

test.describe('mapa con el teclado', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('el mapa se enfoca con Tab, dice cómo usarlo y se mueve con las flechas y con + y −', async ({ page }) => {
    const m = mapa(page);
    await expect(m).toHaveAttribute('tabindex', '0');
    await expect(m).toHaveAccessibleName('Mapa de Arequipa');
    // La ayuda es la descripción del mapa y nombra el botón que elige el punto del centro.
    await expect(m).toHaveAccessibleDescription(/flechas/);
    await expect(m).toHaveAccessibleDescription(/Ver ficha del centro del mapa/);
    await expect(m).toHaveAccessibleDescription(/Lista de elementos de esta vista/);
    await m.focus();
    const antes = await vista(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await vista(page)).lon).toBeGreaterThan(antes.lon);
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await vista(page)).lat).toBeLessThan(antes.lat);
    // Con el foco del teclado en el mapa se ve la mira del centro.
    await expect(page.locator('.mapa-mira')).toBeVisible();
    await page.keyboard.press('Equal');
    await expect.poll(async () => (await vista(page)).zoom).toBe(antes.zoom + 1);
    await page.keyboard.press('Minus');
    await expect.poll(async () => (await vista(page)).zoom).toBe(antes.zoom);
  });

  test('con el teclado se elige un punto: mover el mapa y pulsar «Ver ficha del centro del mapa» abre la ficha de lo que quedó al centro', async ({ page }) => {
    await mapa(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await vista(page)).lon).toBeGreaterThan(-71.53697);
    // El centro que se ve (zoom, lat, lon a la vista del DOM) antes de abrir la ficha: al abrirla, el mapa se encuadra sobre lo que la ficha dibuja.
    await expect.poll(async () => (await vista(page)).lat).toBeGreaterThan(-16.39883);
    const v = await vista(page);
    await botonCentro(page).focus();
    await page.keyboard.press('Enter');
    await expect(ficha(page)).toBeVisible();
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    expect(lat).toBeCloseTo(v.lat, 4);
    expect(lon).toBeCloseTo(v.lon, 4);
  });

  test('sin el foco del teclado en el mapa, la mira no se ve', async ({ page }) => {
    await expect(page.locator('.mapa-mira')).toBeHidden();
  });
});

test.describe('controles del mapa en español', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('el zoom dice «Acercar» y «Alejar», la atribución no lleva el rótulo de Leaflet y conserva la de OpenStreetMap', async ({ page }) => {
    await expect(page.locator('.leaflet-control-zoom-in')).toHaveAccessibleName('Acercar');
    await expect(page.locator('.leaflet-control-zoom-out')).toHaveAccessibleName('Alejar');
    const atribucion = page.locator('.leaflet-control-attribution');
    await expect(atribucion).toContainText('OpenStreetMap');
    await expect(atribucion).not.toContainText('Leaflet');
    await expect(atribucion.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    // El control de zoom mide 44 px también con el ratón.
    for (const sel of ['.leaflet-control-zoom-in', '.leaflet-control-zoom-out']) {
      const c = (await page.locator(sel).boundingBox())!;
      expect(c.width, sel).toBeGreaterThanOrEqual(43.5);
      expect(c.height, sel).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('el botón de cerrar un cuadro dice «Cerrar» y mide 44 px', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await marcadorDeAviso(page, AVISO_1.titulo).click();
    const cerrar = page.locator('.leaflet-popup-close-button');
    await expect(cerrar).toHaveAccessibleName('Cerrar');
    const c = (await cerrar.boundingBox())!;
    expect(c.width).toBeGreaterThanOrEqual(43.5);
    expect(c.height).toBeGreaterThanOrEqual(43.5);
  });

  test('un enlace que se abre en otra pestaña lo dice a los lectores de pantalla (cuadro del aviso)', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await marcadorDeAviso(page, AVISO_1.titulo).click();
    await expect(page.locator('.leaflet-popup-content').getByRole('link', { name: 'Ver el aviso original (abre en otra pestaña)' })).toHaveAttribute('target', '_blank');
  });
});

test.describe('marcadores de aviso', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('llevan el número del aviso (el de su tarjeta) y ese número está en su nombre accesible; no son un punto naranja', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const marcadores = page.locator('.marcador-aviso');
    await expect(marcadores).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const m = marcadores.nth(i);
      const numero = (await m.locator('span').innerText()).trim();
      expect(numero).toMatch(/^\d+$/);
      await expect(m).toHaveAccessibleName(new RegExp(`^Aviso ${numero}: `));
      const estilo = await m.locator('span').evaluate((e) => ({ fondo: getComputedStyle(e).backgroundColor, texto: getComputedStyle(e).color, borde: getComputedStyle(e).borderTopColor, activo: Boolean(e.parentElement?.classList.contains('ent-activo')) }));
      expect(estilo.fondo).not.toBe('rgb(194, 65, 12)'); // el naranja de antes
      // Tinta del mapa y blanco: el aviso activo, relleno de tinta con el número en blanco; los demás, al revés.
      expect(estilo.fondo).toBe(estilo.activo ? 'rgb(28, 58, 107)' : 'rgb(255, 255, 255)');
      expect(estilo.texto).toBe(estilo.activo ? 'rgb(255, 255, 255)' : 'rgb(28, 58, 107)');
      expect(estilo.borde).toBe('rgb(28, 58, 107)');
    }
    // El número del marcador es el de la tarjeta del chat con el mismo título.
    const posicion = await page.locator('.avisos-mapa li', { hasText: AVISO_1.titulo }).locator('.tarjeta-posicion').innerText();
    // La tarjeta rotula «Aviso N»: solo importa el número.
    const numeroDeTarjeta = posicion.match(/\d+/)![0];
    await expect(marcadorDeAviso(page, AVISO_1.titulo)).toHaveAccessibleName(new RegExp(`^Aviso ${numeroDeTarjeta}: `));
  });

  test('el aviso activo se distingue por su relleno y su tamaño, no solo por el color', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    // Ningún aviso viene resaltado por defecto: se resalta al elegirlo en su tarjeta.
    await expect(page.locator('.marcador-aviso.ent-activo')).toHaveCount(0);
    await page.locator('.avisos-mapa li').first().getByRole('button', { name: /^Ver en el mapa:/ }).click();
    const activo = page.locator('.marcador-aviso.ent-activo span');
    await expect(activo).toHaveCount(1);
    const e = await activo.evaluate((x) => ({ fondo: getComputedStyle(x).backgroundColor, texto: getComputedStyle(x).color, transform: getComputedStyle(x).transform }));
    expect(e.fondo).toBe('rgb(28, 58, 107)');
    expect(e.texto).toBe('rgb(255, 255, 255)');
    expect(e.transform).not.toBe('none');
  });

  test('con el teclado, Enter o la barra espaciadora abre el cuadro y el foco entra en él; Esc lo cierra y el foco vuelve al marcador', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const marcador = marcadorDeAviso(page, AVISO_1.titulo);
    for (const tecla of ['Enter', 'Space']) {
      await marcador.focus();
      await page.keyboard.press(tecla);
      await expect(page.locator('.leaflet-popup')).toBeVisible();
      await expect(page.locator('.leaflet-popup-content').getByRole('link', { name: /Ver el aviso original/ })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('.leaflet-popup')).toHaveCount(0);
      await expect(marcador).toBeFocused();
    }
  });

  test('el cerrar del cuadro devuelve el foco al marcador', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const marcador = marcadorDeAviso(page, AVISO_1.titulo);
    await marcador.focus();
    await page.keyboard.press('Enter');
    await page.locator('.leaflet-popup-close-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    await expect(marcador).toBeFocused();
  });

  test('«Ver en el mapa» del chat abre el cuadro sin quitarle el foco al botón que se pulsó', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const boton = page.getByRole('button', { name: `Ver en el mapa: ${AVISO_1.titulo}` });
    await boton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.leaflet-popup-content')).toContainText(AVISO_1.titulo);
    await expect(boton).toBeFocused();
  });
});

test.describe('marcadores de aviso con el dedo', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('el área que se toca mide al menos 44 px y el dibujo queda centrado', async ({ page }) => {
    await abrir(page);
    await preguntar(page, CONSULTA_AVISOS);
    const marcador = page.locator('.marcador-aviso').first();
    await expect(marcador).toBeVisible();
    const caja = (await marcador.boundingBox())!;
    expect(caja.width).toBeGreaterThanOrEqual(43.5);
    expect(caja.height).toBeGreaterThanOrEqual(43.5);
    const dibujo = (await marcador.locator('span').boundingBox())!;
    expect(Math.abs(dibujo.x + dibujo.width / 2 - (caja.x + caja.width / 2))).toBeLessThan(1.5);
    expect(Math.abs(dibujo.y + dibujo.height / 2 - (caja.y + caja.height / 2))).toBeLessThan(1.5);
  });
});

test.describe('elementos de las capas con el teclado', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('cada capa dibujada trae su «Lista de elementos de esta vista»: elegir uno abre su cuadro, el foco entra en él y Esc lo cierra', async ({ page }) => {
    await activarCapa(page, 'Salud');
    const capa = capaEnPanel(page, 'Salud');
    await expect(capa.locator('.capa-estado')).toHaveText(/^\d+ elementos? en esta vista\.$/);
    const lista = capa.locator('details.capa-lista');
    await expect(lista.locator('summary')).toContainText(/^Lista de elementos de esta vista \(\d+\)$/);
    await lista.locator('summary').click();
    const elementos = lista.getByRole('button');
    expect(await elementos.count()).toBeGreaterThan(0);
    expect(await elementos.count()).toBeLessThanOrEqual(25);
    const titulo = (await elementos.first().locator('.capa-elemento-titulo').innerText()).trim();
    await elementos.first().click();
    // El panel se pliega para no tapar el cuadro, que se abre con el foco dentro.
    await expect(panelDeCapas(page)).toBeHidden();
    await expect(page.locator('.leaflet-popup-content .cuadro-aviso')).toContainText(titulo);
    await expect.poll(() => focoEnElCuadro(page)).toBe(true);
    // Mover el mapa vuelve a pedir la capa; el cuadro abierto se mantiene y conserva el foco.
    await page.waitForTimeout(1200);
    await expect(page.locator('.leaflet-popup-content .cuadro-aviso')).toContainText(titulo);
    expect(await focoEnElCuadro(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    // El panel está plegado: el foco vuelve al mapa y no se pierde.
    await expect(mapa(page)).toBeFocused();
  });

  test('la lista se puede recorrer solo con el teclado desde la casilla de la capa', async ({ page }) => {
    await abrirCapas(page);
    await casillaDeCapa(page, 'Salud').focus();
    await page.keyboard.press('Space');
    const capa = capaEnPanel(page, 'Salud');
    await expect(capa.locator('details.capa-lista summary')).toBeVisible();
    await capa.locator('details.capa-lista summary').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('.leaflet-popup')).toBeVisible();
    await expect.poll(() => focoEnElCuadro(page)).toBe(true);
  });

  test('un elemento sin controles (solo texto) recibe el foco en su cuadro, que es un grupo con nombre', async ({ page }) => {
    await activarCapa(page, 'Salud');
    const lista = capaEnPanel(page, 'Salud').locator('details.capa-lista');
    await lista.locator('summary').click();
    await lista.getByRole('button').first().click();
    const cuadro = page.locator('.leaflet-popup-content .cuadro-aviso');
    await expect(cuadro).toBeFocused();
    await expect(cuadro).toHaveAttribute('role', 'group');
    await expect(cuadro).toHaveAttribute('aria-label', /.+/);
  });
});

test.describe('errores de las capas con su «Reintentar»', () => {
  test('si una capa falla, el estado lo dice como estado, ofrece Reintentar y al reintentar se carga', async ({ page }) => {
    await page.route('**/api/capas/salud?*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'x' }) }));
    await abrir(page);
    await activarCapa(page, 'Salud');
    const capa = capaEnPanel(page, 'Salud');
    const estado = capa.getByRole('status');
    await expect(estado).toHaveText('No se pudo cargar esta capa. Revisa tu conexión y pulsa Reintentar.');
    const reintentar = capa.getByRole('button', { name: /Reintentar/ });
    await expect(reintentar).toBeVisible();
    expect((await reintentar.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.unroute('**/api/capas/salud?*');
    await reintentar.click();
    await expect(estado).toHaveText(/^\d+ elementos? en esta vista\.$/);
    await expect(capa.getByRole('button', { name: /Reintentar/ })).toHaveCount(0);
  });

  test('si falla la lista de capas, el panel lo dice como alerta y su botón Reintentar la vuelve a pedir', async ({ page }) => {
    await page.route('**/api/capas', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'x' }) }));
    await abrir(page);
    await botonDeCapas(page).click();
    await expect(alerta(page).filter({ hasText: 'No se pudo cargar la lista de capas' })).toContainText('Reintentar');
    await page.unroute('**/api/capas');
    await panelDeCapas(page).getByRole('button', { name: 'Reintentar' }).click();
    await expect(casillaDeCapa(page, 'Colegios')).toBeVisible();
    await expect(alerta(page).filter({ hasText: 'No se pudo cargar la lista de capas' })).toHaveCount(0);
  });

  test('la región de estado de una capa existe desde que se enciende: «Cargando…» se anuncia y se reemplaza por el recuento', async ({ page }) => {
    await page.route('**/api/capas/salud?*', async (ruta) => {
      await new Promise((r) => setTimeout(r, 500));
      await ruta.continue();
    });
    await abrir(page);
    await activarCapa(page, 'Salud');
    const estado = capaEnPanel(page, 'Salud').getByRole('status');
    await expect(estado).toHaveCount(1);
    await expect(estado).toHaveText('Cargando…');
    await expect(estado).toHaveText(/^\d+ elementos? en esta vista\.$/);
  });
});

test.describe('buscador: el error es del campo', () => {
  test('un texto muy corto manda el foco al campo, lo marca inválido y lo une al mensaje', async ({ page }) => {
    await abrir(page);
    const campo = page.getByRole('searchbox', { name: 'Buscar un lugar' });
    await campo.fill('a');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(campo).toBeFocused();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    await expect(campo).toHaveAccessibleDescription(/al menos 2 letras del lugar que buscas/);
    await expect(alerta(page)).toContainText('al menos 2 letras');
  });

  test('si no hay conexión, dice «No se pudo conectar» y qué hacer', async ({ page }) => {
    await abrir(page);
    await page.route('**/api/buscar*', (ruta) => ruta.abort('connectionrefused'));
    await page.getByRole('searchbox', { name: 'Buscar un lugar' }).fill('Cayma');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(alerta(page)).toContainText('No se pudo conectar');
    await expect(alerta(page)).toContainText('Revisa tu conexión');
  });
});

test.describe('movimiento reducido en el mapa', () => {
  test('sin preferencia, el mapa anima; con «reducir movimiento», no anima ni al hacer zoom ni al desplazarse con las flechas', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('.leaflet-container')).toHaveClass(/leaflet-fade-anim/);
    await expect(page.locator('.leaflet-proxy')).toHaveCount(1); // el elemento con que Leaflet anima el zoom
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await expect(page.locator('.leaflet-container')).not.toHaveClass(/leaflet-fade-anim/);
    await expect(page.locator('.leaflet-proxy')).toHaveCount(0);
    // Una flecha mueve el mapa de una vez: no queda ninguna animación de desplazamiento en curso.
    await mapa(page).focus();
    const antes = await vista(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.leaflet-map-pane.leaflet-pan-anim')).toHaveCount(0);
    await expect.poll(async () => (await vista(page)).lon).toBeGreaterThan(antes.lon);
  });
});
