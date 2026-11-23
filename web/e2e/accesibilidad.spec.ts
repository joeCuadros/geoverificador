import { abrir, clicEnMapa, expect, ficha, mapa, preguntar, test, CONSULTA_AVISOS } from './apoyo.ts';

test.describe('estructura y accesibilidad', () => {
  test('la página tiene idioma, título, un solo h1 y las regiones principales', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/GeoVerificador/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mapa' })).toBeVisible();
    await expect(page.getByRole('group', { name: /Mapa de Arequipa/ })).toBeVisible();
  });

  test('el enlace para saltar lleva al panel', async ({ page }) => {
    await abrir(page);
    await page.keyboard.press('Tab');
    const saltar = page.getByRole('link', { name: 'Saltar al asistente y la ficha' });
    await expect(saltar).toBeFocused();
    await saltar.press('Enter');
    await expect(page).toHaveURL(/#panel$/);
  });

  test('las pestañas siguen el patrón de WAI-ARIA y se cambian con las flechas', async ({ page }) => {
    await abrir(page);
    const asistente = page.getByRole('tab', { name: 'Asistente' });
    const fichaTab = page.getByRole('tab', { name: 'Ficha del punto' });
    await expect(asistente).toHaveAttribute('aria-selected', 'true');
    await expect(fichaTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tabpanel', { name: 'Asistente' })).toBeVisible();
    await asistente.focus();
    await page.keyboard.press('ArrowRight');
    await expect(fichaTab).toBeFocused();
    await expect(fichaTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Ficha del punto' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Asistente' })).toBeHidden();
  });

  test('el registro de la conversación anuncia las respuestas y los campos tienen etiqueta', async ({ page }) => {
    await abrir(page);
    const log = page.getByRole('log', { name: 'Conversación con el asistente' });
    await expect(log).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByLabel('Tu consulta')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Buscar un lugar' })).toBeVisible();
    await expect(page.getByRole('search', { name: 'Buscar un lugar' })).toBeVisible();
  });

  test('los botones principales miden al menos 44 px de alto', async ({ page }) => {
    await abrir(page);
    for (const boton of [page.getByRole('button', { name: 'Enviar' }), page.getByRole('button', { name: 'Buscar', exact: true }), page.getByRole('button', { name: 'Ver ficha del centro del mapa' }), page.getByRole('tab', { name: 'Asistente' })]) {
      const caja = (await boton.boundingBox())!;
      expect(caja.height).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('el foco es visible en los controles', async ({ page }) => {
    await abrir(page);
    await page.getByLabel('Tu consulta').focus();
    const contorno = await page.getByLabel('Tu consulta').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(contorno).not.toBe('none');
  });

  test('con movimiento reducido, el mapa se mueve sin animación', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await preguntar(page, CONSULTA_AVISOS);
    await expect(page.locator('.marcador-aviso')).toHaveCount(2);
    await expect(page.locator('.leaflet-map-pane.leaflet-zoom-anim')).toHaveCount(0);
  });

  test('la ficha se arma con encabezados y listas, sin HTML crudo de los datos', async ({ page }) => {
    await abrir(page);
    await clicEnMapa(page);
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page).getByRole('heading', { level: 3 }).first()).toBeVisible();
    expect(await ficha(page).getByRole('list').count()).toBeGreaterThan(3);
    expect(await ficha(page).locator('script, iframe, object, embed').count()).toBe(0);
    expect(await mapa(page).count()).toBe(1);
  });
});

test.describe('diseño adaptable', () => {
  test('en escritorio, el panel queda a la izquierda del mapa', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await abrir(page);
    const panel = (await page.getByRole('main').boundingBox())!;
    const caja = (await mapa(page).boundingBox())!;
    expect(panel.x + panel.width).toBeLessThanOrEqual(caja.x + 1);
    expect(caja.width).toBeGreaterThan(panel.width);
  });

  test.describe('en un teléfono', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('el mapa va arriba, el panel debajo y no hay desplazamiento horizontal', async ({ page }) => {
      await abrir(page);
      const panel = (await page.getByRole('main').boundingBox())!;
      const caja = (await mapa(page).boundingBox())!;
      expect(caja.y + caja.height).toBeLessThanOrEqual(panel.y + 1);
      expect(caja.height).toBeGreaterThan(250);
      const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(ancho).toBeLessThanOrEqual(visible);
    });

    test('se puede preguntar, tocar un aviso y leer la ficha sin desbordar la pantalla', async ({ page }) => {
      await abrir(page);
      const r = await preguntar(page, CONSULTA_AVISOS);
      await r.getByRole('button', { name: /Ver ficha del entorno/ }).first().tap();
      await expect(ficha(page)).toBeVisible();
      const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(ancho).toBeLessThanOrEqual(visible);
    });

    test('tocar el mapa elige un punto', async ({ page }) => {
      await abrir(page);
      const caja = (await mapa(page).boundingBox())!;
      await page.touchscreen.tap(caja.x + caja.width / 2 + 40, caja.y + caja.height / 2 - 60);
      await expect(ficha(page)).toBeVisible();
    });
  });
});
