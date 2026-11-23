import { AVISO_1, CONSULTA_AVISOS, PLAZA, abrir, alejar, alerta, clicEnMapa, expect, ficha, leerCoordenadas, preguntar, test } from './apoyo.ts';

test.describe('mapa', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('carga el mapa centrado en la Plaza de Armas, con zoom, escala y atribución', async ({ page }) => {
    await expect(page.locator('.leaflet-control-zoom-in')).toBeVisible();
    await expect(page.locator('.leaflet-control-scale')).toBeVisible();
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
    await expect(page.locator('.leaflet-tile-pane img.leaflet-tile').first()).toBeAttached();
    // Sin elegir nada todavía, la ficha explica qué hacer.
    await page.getByRole('tab', { name: 'Ficha del punto' }).click();
    await expect(page.getByText('Elige un punto en el mapa')).toBeVisible();
    await expect(ficha(page)).toHaveCount(0);
  });

  test('un clic en el mapa abre la ficha de ese punto, con su fuente y su fecha en cada sección', async ({ page }) => {
    await clicEnMapa(page, 80, -60);
    await expect(page.getByRole('tab', { name: 'Ficha del punto' })).toHaveAttribute('aria-selected', 'true');
    await expect(ficha(page)).toBeVisible();
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    // Cerca del centro (a unos 100 píxeles de la Plaza de Armas, menos de 0,02°) y dentro de Arequipa.
    expect(Math.abs(lat - PLAZA.lat)).toBeLessThan(0.02);
    expect(Math.abs(lon - PLAZA.lon)).toBeLessThan(0.02);
    await expect(ficha(page)).toContainText('Distrito de');
    await expect(ficha(page).getByRole('heading', { level: 3, name: 'Lo esencial de este punto' })).toBeVisible();
    for (const titulo of ['Qué se puede construir', 'Qué hay cerca', 'Cómo moverse', 'Servicios básicos', 'Riesgos y restricciones']) {
      await expect(ficha(page).getByRole('heading', { level: 3, name: titulo })).toBeVisible();
    }
    // Cada elemento dice su fuente, a la vista; la de salud, con la fecha de los datos.
    expect(await ficha(page).locator('.f-fuente').count()).toBeGreaterThanOrEqual(10);
    await expect(ficha(page).locator('li[data-item="salud"] .f-fuente')).toContainText(/RENIPRESS.*datos del \d{4}-\d{2}-\d{2}/);
    // El punto elegido se marca en el mapa.
    await expect(page.locator('.marcador-punto')).toHaveCount(1);
  });

  test('la ficha trae los avisos de siempre: informativa, distancias en línea recta, peligros como contexto y limitaciones', async ({ page }) => {
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page).getByRole('note').first()).toContainText('No es una recomendación de compra ni reemplaza los certificados municipales');
    await expect(ficha(page)).toContainText('Las distancias son en línea recta');
    await expect(ficha(page).getByRole('heading', { name: 'Lo que conviene tener presente' })).toBeVisible();
    await expect(ficha(page).getByRole('heading', { name: 'Riesgos y restricciones' })).toBeVisible();
    await expect(ficha(page)).toContainText('no significa que el lugar sea seguro');
    // La ficha no muestra secciones que la base todavía no calcula.
    await expect(ficha(page)).not.toContainText('No se calcul');
  });

  test('el botón del centro usa las coordenadas exactas del centro del mapa', async ({ page }) => {
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    await expect(ficha(page)).toBeVisible();
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    expect(lat).toBeCloseTo(PLAZA.lat, 4);
    expect(lon).toBeCloseTo(PLAZA.lon, 4);
    await expect(ficha(page)).toContainText('ZRE-CH');
    await expect(ficha(page)).toContainText('Distrito de Arequipa');
  });

  test('el botón del centro se alcanza y se activa con el teclado', async ({ page }) => {
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).focus();
    await page.keyboard.press('Enter');
    await expect(ficha(page)).toBeVisible();
  });

  test('un segundo clic reemplaza la ficha del primero', async ({ page }) => {
    await clicEnMapa(page, 80, -60);
    await expect(ficha(page)).toBeVisible();
    const primera = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    await page.getByRole('tab', { name: 'Asistente' }).click();
    await clicEnMapa(page, -150, 120);
    await expect(page.getByRole('tab', { name: 'Ficha del punto' })).toHaveAttribute('aria-selected', 'true');
    await expect(async () => {
      const segunda = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
      expect(Math.abs(segunda.lat - primera.lat)).toBeGreaterThan(0.001);
    }).toPass();
    await expect(page.locator('.marcador-punto')).toHaveCount(1);
  });

  test('si la ficha falla, lo dice y deja reintentar', async ({ page }) => {
    await page.route('**/api/ficha*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo armar la ficha de este punto. Intenta de nuevo.' }) }));
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    const aviso = alerta(page).filter({ hasText: 'No se pudo armar la ficha' });
    await expect(aviso).toBeVisible();
    await page.unroute('**/api/ficha*');
    await aviso.getByRole('button', { name: 'Reintentar' }).click();
    await expect(ficha(page)).toBeVisible();
    await expect(alerta(page).filter({ hasText: 'No se pudo armar la ficha' })).toHaveCount(0);
  });

  test('si no hay conexión con el servidor, la ficha lo dice', async ({ page }) => {
    await page.route('**/api/ficha*', (ruta) => ruta.abort('connectionrefused'));
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    await expect(alerta(page)).toContainText('No pude conectar');
  });

  test('un punto fuera de Arequipa recibe el rechazo real del servidor y no una ficha vacía', async ({ page }) => {
    // Con el mapa alejado a zoom 5, un clic a 300 píxeles del centro cae a unos 13° al este (fuera de Arequipa): el 400 viene del servidor, sin simular nada.
    await alejar(page, 9);
    const respuesta = page.waitForResponse((r) => r.url().includes('/api/ficha'));
    await clicEnMapa(page, 300, 0);
    expect((await respuesta).status()).toBe(400);
    await expect(alerta(page)).toContainText('fuera de Arequipa');
    await expect(ficha(page)).toHaveCount(0);
  });
});

test.describe('H8 y H9 · la ficha muestra lo que hay y no inventa lo que no hay', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  /**
   * Un punto de Arequipa fuera del plano y de todo distrito cargado, elegido sin arrastrar el mapa: con el zoom en 9 (cinco niveles más lejos) y un clic a
   * (150, 100) píxeles del centro, la latitud y la longitud salen de la proyección de Leaflet, sin depender del pulso del arrastre. Queda a 15 km del distrito
   * más cercano y a 39 km de una zona del plano: unos píxeles de diferencia no cambian el resultado.
   */
  async function elegirPuntoFueraDelPlano(page: import('@playwright/test').Page) {
    await alejar(page, 5);
    await clicEnMapa(page, 150, 100);
    await expect(ficha(page)).toBeVisible();
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    expect(lat).toBeCloseTo(-16.66, 1);
    expect(lon).toBeCloseTo(-71.12, 1);
  }

  test('un punto dentro del plano muestra la zona con su regla, el distrito y los peligros con su fuente y su fecha', async ({ page }) => {
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    await expect(ficha(page)).toBeVisible();
    const zona = ficha(page).locator('li[data-item="zona"]');
    await expect(zona).toContainText('ZRE-CH');
    await expect(zona).toContainText('Reglamentación especial centro histórico');
    await expect(zona).toContainText(/Plano de Zonificación del PDM/);
    await expect(ficha(page).locator('#ficha-g-construir')).toContainText('Parámetros del Reglamento del PDM Arequipa 2016-2025');
    await expect(ficha(page)).toContainText('Distrito de Arequipa');
    const volcan = ficha(page).locator('li[data-item="peligro-volcanico"]');
    await expect(volcan).toContainText('El punto está dentro de zonas de peligro volcánico del Misti');
    await expect(volcan.locator('.f-fuente')).toContainText(/IGP.*datos del \d{4}-\d{2}-\d{2}/);
    await expect(ficha(page).locator('li[data-item="cauce"]')).toContainText(/Río Chili/);
  });

  test('un punto de Arequipa fuera del plano dice «fuera del área zonificada», sin distrito y sin zona inventada', async ({ page }) => {
    await elegirPuntoFueraDelPlano(page);
    const zona = ficha(page).locator('li[data-item="zona"]');
    await expect(zona).toContainText(/fuera del área zonificada/i);
    await expect(zona.locator('.estado-sin_dato')).toContainText('Sin dato');
    await expect(zona).not.toContainText(/ZRE|Reglamentación|Condición/);
    // El resto de la ficha sigue trayendo su fuente: no se calló nada.
    expect(await ficha(page).locator('.f-fuente').count()).toBeGreaterThanOrEqual(5);
  });

  test('cuando el punto no cae en ningún distrito, la cabecera no inventa uno', async ({ page }) => {
    await elegirPuntoFueraDelPlano(page);
    const sub = await ficha(page).locator('.f-sub').innerText();
    expect(sub).not.toMatch(/Distrito de [A-Z]/);
    expect(sub).toMatch(/-?\d+,\d{5}; -?\d+,\d{5}/);
  });

  test('cada elemento con datos dice su fuente a la vista y la fecha en que se extrajeron los datos (la zonificación no trae fecha en la base)', async ({ page }) => {
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    await expect(ficha(page)).toBeVisible();
    const items = ficha(page).locator('li[data-item]');
    const total = await items.count();
    expect(total).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < total; i++) {
      const it = items.nth(i);
      const id = (await it.getAttribute('data-item'))!;
      const fuente = it.locator('.f-fuente').first();
      await expect(fuente, id).toBeVisible();
      const texto = await fuente.innerText();
      if (id === 'zona') expect(texto, id).toMatch(/sin fecha en la base/);
      else expect(texto, id).toMatch(/datos del \d{4}-\d{2}-\d{2}/);
    }
  });
});

test.describe('buscador de lugares', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('busca un lugar por su nombre, lo elige y abre su ficha', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Buscar un lugar' }).fill('Real Plaza');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const resultados = page.getByRole('list', { name: 'Resultados de la búsqueda' });
    await expect(resultados.getByRole('button')).not.toHaveCount(0);
    // Cada resultado dice de dónde sale y con qué precisión.
    await expect(resultados.getByRole('button').first()).toContainText(/precisión de unos \d+ m/);
    await resultados.getByRole('button', { name: /Real Plaza Arequipa/ }).first().click();
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page)).toContainText('Real Plaza Arequipa');
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    expect(Math.abs(lat - -16.39)).toBeLessThan(0.01);
    expect(Math.abs(lon - -71.55)).toBeLessThan(0.01);
    await expect(page.locator('.marcador-punto')).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Resultados de la búsqueda' })).toHaveCount(0);
  });

  test('un lugar que no existe en los datos se dice, sin inventar un resultado', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Buscar un lugar' }).fill('zzzxqwv');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page.getByText('No encontré «zzzxqwv» en los datos')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Resultados de la búsqueda' })).toHaveCount(0);
  });

  test('un texto demasiado corto se rechaza con un mensaje', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Buscar un lugar' }).fill('a');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(alerta(page)).toContainText('al menos 2 letras');
  });

  test('si la búsqueda falla en el servidor, muestra su mensaje', async ({ page }) => {
    await page.route('**/api/buscar*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo buscar el lugar. Intenta de nuevo.' }) }));
    await page.getByRole('searchbox', { name: 'Buscar un lugar' }).fill('Cayma');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(alerta(page)).toContainText('No se pudo buscar el lugar');
  });
});

test.describe('avisos del asistente en el mapa', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('un marcador abre su cuadro con el título, el precio y el enlace original, y resalta su tarjeta en el asistente', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await page.getByRole('tab', { name: 'Ficha del punto' }).click();
    const marcador = page.getByRole('button', { name: `Aviso: ${AVISO_1.titulo}`, exact: true });
    await expect(marcador).toBeVisible();
    await marcador.click();
    const cuadro = page.locator('.leaflet-popup-content .cuadro-aviso');
    await expect(cuadro).toContainText(AVISO_1.titulo);
    await expect(cuadro).toContainText('S/ 400 000');
    await expect(cuadro).toContainText('cumple 1 de 1 criterios');
    await expect(cuadro.getByRole('link', { name: 'Ver el aviso original' })).toHaveAttribute('href', AVISO_1.url);
    // La tarjeta del asistente queda resaltada y a la vista.
    await expect(page.getByRole('tab', { name: 'Asistente' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.avisos-mapa li[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('.avisos-mapa li[aria-current="true"]')).toContainText(AVISO_1.titulo);
  });

  test('desde el cuadro del marcador se abre la ficha de la ubicación del aviso', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await page.getByRole('button', { name: `Aviso: ${AVISO_1.titulo}`, exact: true }).click();
    await page.locator('.leaflet-popup-content').getByRole('button', { name: 'Ver ficha del entorno' }).click();
    await expect(ficha(page)).toBeVisible();
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    expect(lat).toBeCloseTo(AVISO_1.lat, 4);
    expect(lon).toBeCloseTo(AVISO_1.lon, 4);
    await expect(ficha(page)).toContainText(AVISO_1.titulo);
  });

  test('los marcadores y el botón de su cuadro se alcanzan con el teclado', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const marcador = page.getByRole('button', { name: `Aviso: ${AVISO_1.titulo}`, exact: true });
    await marcador.focus();
    await page.keyboard.press('Enter');
    const boton = page.locator('.leaflet-popup-content').getByRole('button', { name: 'Ver ficha del entorno' });
    await expect(boton).toBeVisible();
    await expect(page.locator('.avisos-mapa li[aria-current="true"]')).toContainText(AVISO_1.titulo);
    await boton.focus();
    await page.keyboard.press('Enter');
    await expect(ficha(page)).toBeVisible();
  });
});
