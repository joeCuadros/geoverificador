/**
 * La base de la página: metadatos y adaptación a la pantalla, iconos, tipografías, y lo que oyen y sienten quienes usan teclado o lector de pantalla
 * cuando una acción en el mapa o en el buscador abre o cierra la ficha. Con los datos de prueba (e2e/datos/avisos.json).
 */
import { AVISO_1, CONSULTA_AVISOS, abrir, clicEnMapa, expect, ficha, marcadorDeAviso, preguntar, test } from './apoyo.ts';

const anuncioDePestana = (page: import('@playwright/test').Page) => page.getByTestId('anuncio-de-pestana');

test.describe('metadatos e iconos', () => {
  test('idioma es-PE, descripción que no recomienda, robots, tema y adaptación a pantallas con muesca', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-PE');
    const descripcion = (await page.locator('meta[name="description"]').getAttribute('content'))!;
    expect(descripcion).toContain('Consulta datos públicos de un punto de Arequipa');
    expect(descripcion).toContain('sin recomendar ni calificar');
    expect(descripcion).not.toMatch(/busca vivienda|mejor|recomend(?!ar ni)/i);
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toMatch(/index/);
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');
    expect(await page.locator('meta[name="color-scheme"]').getAttribute('content')).toBe('light dark');
    const colores = await page.locator('meta[name="theme-color"]').evaluateAll((es) => es.map((e) => [e.getAttribute('media'), e.getAttribute('content')]));
    expect(colores).toEqual([
      ['(prefers-color-scheme: light)', '#fffcf7'],
      ['(prefers-color-scheme: dark)', '#1c1713'],
    ]);
    expect(await page.locator('meta[property="og:site_name"]').getAttribute('content')).toBe('GeoVerificador');
    expect(await page.locator('meta[property="og:locale"]').getAttribute('content')).toBe('es_PE');
  });

  test('el título sigue el patrón de la página', async ({ page }) => {
    await abrir(page);
    await expect(page).toHaveTitle('GeoVerificador · Predios de Arequipa');
  });

  test('los iconos existen: /favicon.ico ya no da 404 y la página no pide nada que falte', async ({ page, request }) => {
    const fallos: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && new URL(r.url()).origin === new URL(page.url() || 'http://x').origin) fallos.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    await abrir(page);
    for (const ruta of ['/favicon.ico', '/icono.svg', '/apple-touch-icon.png']) {
      const r = await request.get(ruta);
      expect(r.status(), ruta).toBe(200);
      expect(r.headers()['content-type'], ruta).toMatch(/^image\//);
    }
    const iconos = await page.locator('link[rel~="icon"], link[rel="apple-touch-icon"]').evaluateAll((es) => es.map((e) => e.getAttribute('href')));
    expect(iconos).toEqual(expect.arrayContaining(['/icono.svg', '/favicon.ico', '/apple-touch-icon.png']));
    expect(fallos.filter((f) => !/\/api\//.test(f))).toEqual([]);
  });
});

test.describe('tipografías', () => {
  test('Instrument Sans y Bricolage Grotesque se cargan de verdad y son las que usan el texto y los títulos', async ({ page }) => {
    await abrir(page);
    const leer = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        const primera = (el: Element) => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
        return {
          cargadas: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/^["']|["']$/g, '')),
          cuerpo: primera(document.body),
          titulo: primera(document.querySelector('h1')!),
        };
      });
    await expect.poll(async () => (await leer()).cargadas.length).toBeGreaterThanOrEqual(2);
    const f = await leer();
    expect(f.cargadas).toContain(f.cuerpo);
    expect(f.cargadas).toContain(f.titulo);
    expect(f.cuerpo).not.toBe(f.titulo);
    expect(f.cuerpo).not.toMatch(/^(system-ui|sans-serif|Georgia)$/);
  });

  test('el tamaño de letra del navegador se respeta: el cuerpo mide 1 rem', async ({ page }) => {
    await abrir(page);
    const { cuerpo, raiz } = await page.evaluate(() => ({ cuerpo: getComputedStyle(document.body).fontSize, raiz: getComputedStyle(document.documentElement).fontSize }));
    expect(cuerpo).toBe(raiz);
    await page.evaluate(() => (document.documentElement.style.fontSize = '125%'));
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('20px');
  });
});

test.describe('la ficha se abre desde el mapa y el buscador', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('un clic en el mapa abre la ficha y lo anuncia una vez, con un texto distinto al de la ficha', async ({ page }) => {
    await expect(anuncioDePestana(page)).toHaveText('');
    await clicEnMapa(page);
    await expect(anuncioDePestana(page)).toHaveText('Se abrió la ficha del punto, junto al asistente.');
    await expect(ficha(page)).toBeVisible();
    // La ficha dice por su lado «Armando…» y «… está lista»: no repite el anuncio de la apertura.
    await expect(page.getByRole('region', { name: 'Ficha del punto' }).getByRole('status')).toHaveText(/ está lista\.$/);
    await expect(anuncioDePestana(page)).not.toHaveText(/lista|Armando/);
  });

  test('el anuncio es una región de estado única y permanente, y se vacía solo', async ({ page }) => {
    await expect(page.locator('[role="status"][data-testid="anuncio-de-pestana"]')).toHaveCount(1);
    await expect(anuncioDePestana(page)).toHaveClass(/solo-lectores/);
    await clicEnMapa(page);
    await expect(anuncioDePestana(page)).not.toHaveText('');
    await expect(anuncioDePestana(page)).toHaveText('', { timeout: 9_000 });
    await expect(page.locator('[data-testid="anuncio-de-pestana"]')).toHaveCount(1);
  });

  test('elegir otro punto con la ficha ya abierta no repite el anuncio', async ({ page }) => {
    await clicEnMapa(page);
    await expect(ficha(page)).toBeVisible();
    await expect(anuncioDePestana(page)).toHaveText('', { timeout: 9_000 });
    await clicEnMapa(page, 60, 40);
    await expect(ficha(page)).toBeVisible();
    await expect(anuncioDePestana(page)).toHaveText('');
  });

  test('cerrar la ficha lo anuncia', async ({ page }) => {
    await clicEnMapa(page);
    await expect(ficha(page)).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar la ficha del punto' }).click();
    await expect(anuncioDePestana(page)).toHaveText('Se cerró la ficha del punto.');
  });

  test('un marcador de aviso abre el asistente y lo anuncia', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await expect(anuncioDePestana(page)).toHaveText('');
    await marcadorDeAviso(page, AVISO_1.titulo).click();
    await expect(anuncioDePestana(page)).toHaveText('El aviso quedó resaltado en el asistente.');
  });

  test('al elegir un resultado del buscador, el foco no cae al inicio de la página: pasa al título de la ficha, también mientras se arma', async ({ page }) => {
    await page.route('**/api/ficha*', async (ruta) => {
      await new Promise((f) => setTimeout(f, 800));
      await ruta.continue();
    });
    await page.getByRole('searchbox', { name: 'Buscar un lugar' }).fill('Real Plaza');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('list', { name: 'Resultados de la búsqueda' }).getByRole('button', { name: /Real Plaza Arequipa/ }).first().click();
    await expect(anuncioDePestana(page)).toHaveText('Se abrió la ficha del punto, junto al asistente.');
    // Mientras se arma: el título del estado «Armando la ficha…».
    await expect(page.locator('.ficha-estado').getByRole('heading', { level: 2, name: 'Ficha del punto' })).toBeFocused();
    // Ya lista: el título de la ficha completa.
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page).getByRole('heading', { level: 2, name: 'Ficha del punto' })).toBeFocused();
  });

  test('si el foco sigue en un control visible (el botón del centro del mapa), no se le quita', async ({ page }) => {
    const boton = page.getByRole('button', { name: 'Ver ficha del centro del mapa' });
    await boton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Ficha del punto' })).toBeVisible();
    await expect(ficha(page)).toBeVisible();
    await expect(boton).toBeFocused();
  });

  test('Esc sigue cerrando la lista de resultados del buscador y devolviendo el foco al campo', async ({ page }) => {
    const campo = page.getByRole('searchbox', { name: 'Buscar un lugar' });
    await campo.fill('Real Plaza');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const lista = page.getByRole('list', { name: 'Resultados de la búsqueda' });
    await expect(lista).toBeVisible();
    await campo.press('ArrowDown');
    await expect(lista.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(lista).toHaveCount(0);
    await expect(campo).toBeFocused();
  });
});
