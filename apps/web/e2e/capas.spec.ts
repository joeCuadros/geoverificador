/**
 * Capas de datos del mapa: el control (accesible, con leyenda, nota y fuente con fecha de cada capa) y lo que se dibuja, pedido a la base por ventana y zoom.
 * Los datos son los reales de apps/estatica/public/data cargados en la base de pruebas; solo las pruebas que lo dicen simulan la respuesta del servidor.
 */
import { abrir, abrirCapas, activarCapa, alejar, alerta, botonDeCapas, capaEnPanel, capasDibujadas, casillaDeCapa, clicEnMapa, expect, mapa, panelDeCapas, test, vista } from './apoyo.ts';

const TODAS = [
  'Colegios', 'Salud', 'Consultorios médicos', 'Mercados', 'Supermercados', 'Centros comerciales y galerías', 'Bancos y cajeros', 'Restaurantes y cafés', 'Juegos infantiles',
  'Paraderos', 'Parques y áreas verdes', 'Puntos de acopio de agua', 'Concesión eléctrica', 'Zonificación (PDM 2016-2025)', 'Peligro volcánico (Misti)', 'Quebradas y ríos',
  'Peligros geológicos', 'Sismos reportados', 'Concesiones mineras', 'Rutas de combi y bus', 'Límites de distrito',
];

test.describe('control de capas', () => {
  test('está plegado al empezar, se abre con un botón y agrupa las capas por tema, todas apagadas', async ({ page }) => {
    const pedidas: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/capas\/[^/?]+/.test(r.url())) pedidas.push(r.url());
    });
    await abrir(page);
    await expect(botonDeCapas(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panelDeCapas(page)).toBeHidden();
    await botonDeCapas(page).click();
    await expect(botonDeCapas(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panelDeCapas(page)).toBeVisible();
    for (const grupo of ['Servicios', 'Zonificación', 'Riesgo', 'Movilidad', 'Límites']) await expect(panelDeCapas(page).locator('legend', { hasText: grupo })).toBeVisible();
    for (const titulo of TODAS) await expect(casillaDeCapa(page, titulo), titulo).not.toBeChecked();
    // Mientras ninguna capa esté encendida no se pide ningún dato de capa.
    expect(pedidas).toEqual([]);
    expect(await capasDibujadas(page)).toEqual({});
  });

  test('solo ofrece capas que la base tiene: no hay censo por manzana, riesgo del CENEPRED ni denuncias', async ({ page }) => {
    await abrir(page);
    await abrirCapas(page);
    await expect(casillaDeCapa(page, 'Colegios')).toBeVisible(); // la lista se pide al servidor
    const titulos = await panelDeCapas(page).getByRole('checkbox').evaluateAll((cs) => cs.map((c) => (c as HTMLInputElement).labels?.[0]?.textContent ?? ''));
    expect(titulos.sort()).toEqual([...TODAS].sort());
    for (const t of titulos) expect(t).not.toMatch(/censo|cenepred|denuncia|delito/i);
  });

  test('se maneja con el teclado: Enter abre el panel y Espacio enciende una capa', async ({ page }) => {
    await abrir(page);
    await botonDeCapas(page).focus();
    await page.keyboard.press('Enter');
    await expect(panelDeCapas(page)).toBeVisible();
    await casillaDeCapa(page, 'Salud').focus();
    await page.keyboard.press('Space');
    await expect(casillaDeCapa(page, 'Salud')).toBeChecked();
    await expect.poll(async () => (await capasDibujadas(page)).salud ?? 0).toBeGreaterThan(0);
    await expect(casillaDeCapa(page, 'Salud')).toBeFocused();
  });

  test('un botón y cada casilla miden al menos 44 px de alto en su zona de toque', async ({ page }) => {
    await abrir(page);
    await abrirCapas(page);
    expect((await botonDeCapas(page).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    const etiqueta = (await page.locator('.capa label').first().boundingBox())!;
    expect(etiqueta.height).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe('capas encendidas', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('encender una capa pide solo esa capa y la dibuja; el panel dice cuántos elementos hay, con su leyenda, su nota y su fuente con fecha', async ({ page }) => {
    const respuesta = page.waitForResponse((r) => /\/api\/capas\/colegios\?bbox=/.test(r.url()));
    await activarCapa(page, 'Colegios');
    const j = await (await respuesta).json();
    expect(j.features.length).toBeGreaterThan(0);
    await expect.poll(async () => (await capasDibujadas(page)).colegios).toBe(j.features.length);
    const capa = capaEnPanel(page, 'Colegios');
    await expect(capa.locator('.capa-estado')).toHaveText(new RegExp(`^${j.features.length} elementos en esta vista\\.$`));
    for (const nivel of ['Inicial', 'Primaria', 'Secundaria']) await expect(capa.getByRole('list', { name: 'Leyenda: Colegios' })).toContainText(nivel);
    await expect(capa.locator('.capa-nota')).toContainText('Padrón oficial de ESCALE');
    await expect(capa.locator('.capa-nota')).toContainText('aquí no se dibujan');
    await expect(capa.locator('.capa-fuente')).toContainText(/Fuente: Padrón de instituciones educativas de ESCALE.* · datos del \d{4}-\d{2}-\d{2}/);
    // Cada elemento trae su título y su detalle de la base: nada inventado.
    expect(j.features.every((f: any) => f.properties.titulo && ['inicial', 'primaria', 'secundaria'].includes(f.properties.nivel))).toBe(true);
  });

  test('las capas informativas dicen lo que no dicen y de qué fecha son sus datos', async ({ page }) => {
    const casos: [string, RegExp, RegExp][] = [
      ['Puntos de acopio de agua', /no son una conexión ni agua garantizada/, /SEDAPAR.* · datos del 2024-02-16/],
      ['Concesión eléctrica', /no dice que un predio esté conectado/, /MINEM.* · datos del \d{4}-\d{2}-\d{2}/],
      ['Concesiones mineras', /no dice que haya minería ni de quién es el predio/, /INGEMMET.* · datos del \d{4}-\d{2}-\d{2}/],
      ['Peligros geológicos', /no significa que el lugar sea seguro/, /INGEMMET.* · datos del \d{4}-\d{2}-\d{2}/],
      ['Peligro volcánico (Misti)', /No es una evaluación del predio/, /IGP.* · datos del 2026-11-03/],
    ];
    for (const [titulo, nota, fuente] of casos) {
      await activarCapa(page, titulo);
      const capa = capaEnPanel(page, titulo);
      await expect(capa.locator('.capa-nota'), titulo).toContainText(nota);
      await expect(capa.locator('.capa-fuente'), titulo).toContainText(fuente);
      await expect(capa.locator('.capa-estado'), titulo).not.toHaveText('Cargando…');
    }
  });

  test('una capa sin elementos en la vista lo dice y no dibuja nada', async ({ page }) => {
    await activarCapa(page, 'Concesiones mineras');
    await expect(capaEnPanel(page, 'Concesiones mineras').locator('.capa-estado')).toHaveText('Sin elementos en esta vista.');
    expect((await capasDibujadas(page)).mineria).toBe(0);
  });

  test('la zonificación se dibuja y su cuadro dice el código, la regla del plano y la fuente', async ({ page }) => {
    await activarCapa(page, 'Zonificación (PDM 2016-2025)');
    await expect.poll(async () => (await capasDibujadas(page)).zonificacion ?? 0).toBeGreaterThan(5);
    await botonDeCapas(page).click(); // plegar el panel para no tapar el mapa
    await clicEnMapa(page, 0, 0);
    const cuadro = page.locator('.leaflet-popup-content .cuadro-aviso');
    await expect(cuadro).toContainText('ZRE-CH');
    await expect(cuadro).toContainText('Reglamentación especial centro histórico');
    await expect(cuadro).toContainText('Fuente: Plano de zonificación del Plan de Desarrollo Metropolitano de Arequipa 2016-2025');
    await expect(cuadro).toContainText('sin fecha en la base');
  });

  test('con varias capas encendidas cada una tiene su estado y su leyenda; apagar una la quita y deja las demás', async ({ page }) => {
    await activarCapa(page, 'Salud');
    await activarCapa(page, 'Quebradas y ríos');
    await expect.poll(async () => Object.keys(await capasDibujadas(page)).sort()).toEqual(['quebradas', 'salud']);
    await expect(botonDeCapas(page)).toContainText('(2)');
    await casillaDeCapa(page, 'Salud').uncheck();
    await expect.poll(async () => Object.keys(await capasDibujadas(page))).toEqual(['quebradas']);
    await expect(capaEnPanel(page, 'Salud').locator('.leyenda')).toHaveCount(0);
    await expect(capaEnPanel(page, 'Salud').locator('.capa-estado')).toHaveCount(0);
    await expect(botonDeCapas(page)).toContainText('(1)');
  });

  test('al mover el mapa se vuelve a pedir la capa de la nueva ventana', async ({ page }) => {
    const primera = page.waitForRequest((r) => /\/api\/capas\/salud\?bbox=/.test(r.url()));
    await activarCapa(page, 'Salud');
    const bbox1 = new URL((await primera).url()).searchParams.get('bbox');
    const segunda = page.waitForRequest((r) => /\/api\/capas\/salud\?bbox=/.test(r.url()) && new URL(r.url()).searchParams.get('bbox') !== bbox1);
    await botonDeCapas(page).click();
    await page.locator('.leaflet-control-zoom-in').click();
    const url2 = new URL((await segunda).url());
    expect(Number(url2.searchParams.get('zoom'))).toBe(15);
    const [o1, , e1] = bbox1!.split(',').map(Number);
    const [o2, , e2] = url2.searchParams.get('bbox')!.split(',').map(Number);
    expect(e2 - o2).toBeLessThan(e1 - o1); // la ventana es más chica
  });

  test('lejos de lo que una capa admite pide acercar el mapa sin pedirla, y al acercarse la carga', async ({ page }) => {
    const pedidas: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/capas\/geologicos\?/.test(r.url())) pedidas.push(r.url());
    });
    await alejar(page, 4); // zoom 10: esta capa pide 11 o más
    await activarCapa(page, 'Peligros geológicos');
    await expect(capaEnPanel(page, 'Peligros geológicos').locator('.capa-estado')).toHaveText('Acerca el mapa (zoom 11 o más) para ver esta capa.');
    expect(pedidas).toEqual([]);
    expect(await capasDibujadas(page)).toEqual({});
    await page.locator('.leaflet-control-zoom-in').click();
    await expect.poll(async () => (await vista(page)).zoom).toBe(11);
    await expect.poll(async () => (await capasDibujadas(page)).geologicos ?? 0).toBeGreaterThan(0);
    await expect(capaEnPanel(page, 'Peligros geológicos').locator('.capa-estado')).toHaveText(/^\d+ elementos en esta vista\.$/);
  });

  test('con una ventana demasiado grande para la base pide acercar el mapa', async ({ page }) => {
    await alejar(page, 6); // zoom 8: la ventana abarca más de 2°
    await activarCapa(page, 'Zonificación (PDM 2016-2025)');
    await expect(capaEnPanel(page, 'Zonificación (PDM 2016-2025)').locator('.capa-estado')).toContainText(/Acerca el mapa|demasiado terreno/);
    expect(await capasDibujadas(page)).toEqual({});
  });

  test('si una capa falla en el servidor lo dice y no rompe las demás', async ({ page }) => {
    await page.route('**/api/capas/salud?*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo cargar la capa. Intenta de nuevo.' }) }));
    await activarCapa(page, 'Salud');
    await activarCapa(page, 'Colegios');
    await expect(capaEnPanel(page, 'Salud').locator('.capa-estado')).toHaveText('No se pudo cargar esta capa. Se vuelve a intentar al mover el mapa.');
    await expect.poll(async () => (await capasDibujadas(page)).colegios ?? 0).toBeGreaterThan(0);
    expect((await capasDibujadas(page)).salud).toBeUndefined();
  });

  test('si el servidor dice que la capa estaba recortada (simulado), el panel avisa que se muestran solo los primeros', async ({ page }) => {
    const features = Array.from({ length: 20 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-71.537 + i * 0.0003, -16.399] }, properties: { titulo: `Colegio ${i}`, detalle: 'Primaria', color: '#1c3a6b', nivel: 'primaria', letra: 'P' } }));
    await page.route('**/api/capas/colegios?*', (ruta) => ruta.fulfill({ contentType: 'application/json', body: JSON.stringify({ capa: 'colegios', recortada: true, features }) }));
    await activarCapa(page, 'Colegios');
    await expect(capaEnPanel(page, 'Colegios').locator('.capa-estado')).toHaveText('Se muestran los primeros 20: acerca el mapa para ver el resto.');
    expect((await capasDibujadas(page)).colegios).toBe(20);
  });

  test('un cuadro de un elemento trae su título, su detalle y la fuente con la fecha, sin HTML de los datos', async ({ page }) => {
    const features = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-71.53697, -16.39883] }, properties: { titulo: '<img src=x onerror="window.__xss=1">Hospital', detalle: '<b>III-1</b>', color: '#b0272b', letra: '+' } }];
    await page.route('**/api/capas/salud?*', (ruta) => ruta.fulfill({ contentType: 'application/json', body: JSON.stringify({ capa: 'salud', recortada: false, features }) }));
    await activarCapa(page, 'Salud');
    await expect.poll(async () => (await capasDibujadas(page)).salud).toBe(1);
    await botonDeCapas(page).click();
    await page.locator('.leaflet-marker-icon.ent-marcador').first().click();
    const cuadro = page.locator('.leaflet-popup-content .cuadro-aviso');
    await expect(cuadro).toContainText('<img src=x onerror="window.__xss=1">Hospital');
    await expect(cuadro).toContainText('Fuente: RENIPRESS');
    await expect(cuadro.locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });
});

test.describe('la lista de capas', () => {
  test('si falla, lo dice en el panel y se vuelve a pedir al abrirlo otra vez', async ({ page }) => {
    await page.route('**/api/capas', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo leer la lista de capas. Intenta de nuevo.' }) }));
    await abrir(page);
    await botonDeCapas(page).click();
    await expect(alerta(page).filter({ hasText: 'No se pudo cargar la lista de capas' })).toBeVisible();
    await page.unroute('**/api/capas');
    await botonDeCapas(page).click(); // plegar
    await botonDeCapas(page).click(); // volver a abrir: reintenta
    await expect(casillaDeCapa(page, 'Colegios')).toBeVisible();
    await expect(alerta(page).filter({ hasText: 'No se pudo cargar la lista de capas' })).toHaveCount(0);
  });
});

test.describe('capas en un teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('el panel cabe en la pantalla, se desplaza por dentro y no ensancha la página', async ({ page }) => {
    await abrir(page);
    await abrirCapas(page);
    await activarCapa(page, 'Salud');
    const panel = (await panelDeCapas(page).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    const caja = (await mapa(page).boundingBox())!;
    expect(panel.y + panel.height).toBeLessThanOrEqual(caja.y + caja.height + 1);
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(ancho).toBeLessThanOrEqual(visible);
    expect(await panelDeCapas(page).evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true); // lista larga: se desplaza dentro del panel
  });
});
