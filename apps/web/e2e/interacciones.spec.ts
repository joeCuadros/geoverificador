/**
 * Cómo se influyen el mapa, la ficha y el asistente: lo que la ficha devolvió se dibuja y se resalta en los dos sentidos; el asistente enfoca sus avisos,
 * dibuja el trabajo que ubicó y la combi o bus que midió. Las pruebas que dicen «simulado» sustituyen la respuesta del servidor para un caso que los datos de prueba
 * no producen (no hay sectores, el asistente nunca ubica un «lugar pedido»).
 */
import { AVISO_1, AVISO_2, CONSULTA_AVISOS, abrir, expect, ficha, leerCoordenadas, mapa, preguntar, test, vista } from './apoyo.ts';

const CONSULTA_TRABAJO = 'un departamento en Yanahuara cerca de mi trabajo en el Parque Industrial hasta 450 mil soles';
const filaDe = (page: import('@playwright/test').Page, id: string) => ficha(page).locator(`li[data-item="${id}"]`);
const itemsDe = (reporte: any): any[] => reporte.grupos.flatMap((g: any) => g.subgrupos.flatMap((x: any) => x.items));
const botonDe = (page: import('@playwright/test').Page, id: string) => filaDe(page, id).locator('button.f-item-boton');

/** Ningún aviso viene elegido: la persona elige uno con su tarjeta («Ver en el mapa»), y recién entonces se mide y se dibuja su ruta al trabajo. */
const elegirPrimerAviso = (page: import('@playwright/test').Page) => page.locator('.avisos-mapa li').first().getByRole('button', { name: /^Ver en el mapa:/ }).click();

async function abrirFichaDelCentro(page: import('@playwright/test').Page) {
  const respuesta = page.waitForResponse((r) => r.url().includes('/api/ficha') && r.status() === 200);
  await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
  const reporte = await (await respuesta).json();
  await expect(ficha(page)).toBeVisible();
  return reporte;
}

test.describe('ficha y mapa', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('al abrir la ficha, el mapa dibuja exactamente los lugares que la ficha devolvió y se encuadra sobre ellos', async ({ page }) => {
    const antes = await vista(page);
    const reporte = await abrirFichaDelCentro(page);
    const nombres: string[] = reporte.lugares.map((l: any) => l.nombre);
    expect(nombres.length).toBeGreaterThan(8);
    await expect(page.locator('.ent-ficha')).toHaveCount(reporte.lugares.length);
    const titulos = await page.locator('.ent-ficha').evaluateAll((es) => es.map((e) => e.getAttribute('title') ?? ''));
    for (const l of reporte.lugares) expect(titulos.some((t) => t.startsWith(l.nombre)), l.nombre).toBe(true);
    // Sin lugares de más: cada marcador es uno de la respuesta.
    for (const t of titulos) expect(nombres.some((n) => t.startsWith(n)), t).toBe(true);
    await expect.poll(async () => (await vista(page)).zoom).toBeGreaterThan(antes.zoom);
    // El punto elegido queda encima de los lugares.
    await expect(page.locator('.marcador-punto')).toHaveCount(1);
  });

  test('cada elemento con lugar es un solo botón «Ver en el mapa»; los que no tienen lugar no lo son', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    const items = itemsDe(reporte);
    const conLugar = items.filter((i) => i.lugarId);
    expect(conLugar.map((i) => i.id)).toEqual(expect.arrayContaining(['salud', 'transporte', 'area-verde', 'cauce']));
    expect(conLugar.some((i) => i.id.startsWith('colegio-'))).toBe(true);
    for (const i of conLugar) await expect(botonDe(page, i.id), i.id).toBeVisible();
    await expect(botonDe(page, 'zona')).toHaveCount(0);
    await expect(botonDe(page, 'peligro-volcanico')).toHaveCount(0);
    // El botón tiene la altura mínima para tocar y un nombre que dice qué muestra.
    const caja = (await botonDe(page, 'salud').boundingBox())!;
    expect(caja.height).toBeGreaterThanOrEqual(44);
    await expect(botonDe(page, 'salud')).toHaveAccessibleName(/^Ver en el mapa: Establecimiento de salud: /);
  });

  test('pulsar un elemento resalta el lugar en el mapa, abre su cuadro con su fuente y lo marca en la ficha', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    const salud = reporte.lugares.find((l: any) => l.filas.includes('Salud'));
    await botonDe(page, 'salud').click();
    const activo = page.locator('.ent-ficha.ent-activo');
    await expect(activo).toHaveCount(1);
    await expect(activo).toHaveAttribute('title', new RegExp(`^${salud.nombre}`));
    const cuadro = page.locator('.leaflet-popup-content .cuadro-aviso');
    await expect(cuadro).toContainText(salud.nombre);
    await expect(cuadro).toContainText('Fuente: RENIPRESS');
    await expect(cuadro).toContainText(/\d+ m en línea recta/);
    await expect(filaDe(page, 'salud')).toHaveAttribute('aria-current', 'true');
    await expect(botonDe(page, 'salud')).toHaveAttribute('aria-pressed', 'true');
    await expect(filaDe(page, 'transporte')).not.toHaveAttribute('aria-current', 'true');
  });

  test('pulsar otro elemento mueve el resalte y el cuadro', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    await botonDe(page, 'salud').click();
    await botonDe(page, 'transporte').click();
    const transporte = reporte.lugares.find((l: any) => l.filas.includes('Transporte'));
    await expect(page.locator('.ent-ficha.ent-activo')).toHaveCount(1);
    await expect(page.locator('.ent-ficha.ent-activo')).toHaveAttribute('title', new RegExp(`^${transporte.nombre}`));
    await expect(filaDe(page, 'salud')).not.toHaveAttribute('aria-current', 'true');
    await expect(filaDe(page, 'transporte')).toHaveAttribute('aria-current', 'true');
  });

  test('con el teclado, el elemento resalta el lugar', async ({ page }) => {
    await abrirFichaDelCentro(page);
    await botonDe(page, 'area-verde').focus();
    await page.keyboard.press('Enter');
    await expect(filaDe(page, 'area-verde')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.ent-ficha.ent-activo')).toHaveCount(1);
  });

  test('tocar un lugar en el mapa marca su elemento en la ficha, aunque se estuviera en el asistente', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    const salud = reporte.lugares.find((l: any) => l.filas.includes('Salud'));
    await page.getByRole('tab', { name: 'Asistente' }).click();
    await page.locator(`.ent-ficha[title^="${salud.nombre}"]`).click();
    await expect(page.getByRole('tab', { name: 'Ficha del punto' })).toHaveAttribute('aria-selected', 'true');
    await expect(filaDe(page, 'salud')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.leaflet-popup-content')).toContainText(salud.nombre);
  });

  test('el cauce cercano también se dibuja, con su elemento y su botón', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    const cauce = itemsDe(reporte).find((i) => i.id === 'cauce');
    const lugar = reporte.lugares.find((l: any) => l.id === cauce.lugarId);
    expect(lugar.forma.type).toMatch(/LineString/);
    await ficha(page).getByRole('button', { name: `Ver en el mapa: ${cauce.titulo}: ${cauce.nombre}` }).click();
    await expect(page.locator('.ent-ficha.ent-activo')).toHaveCount(1);
    await expect(page.locator('.leaflet-popup-content')).toContainText(cauce.nombre);
    await expect(ficha(page).locator(`li[data-lugar="${cauce.lugarId}"]`)).toHaveAttribute('aria-current', 'true');
  });

  test('la zona volcánica no tiene botón: su polígono no se repite, está en la capa «Peligro volcánico»', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const volcan = filaDe(page, 'peligro-volcanico');
    await expect(volcan).toBeVisible();
    await expect(volcan.locator('button.f-item-boton')).toHaveCount(0);
  });

  test('una ficha nueva reemplaza los lugares de la anterior', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const segunda = page.waitForResponse((r) => r.url().includes('/api/ficha') && r.status() === 200);
    await page.getByRole('tab', { name: 'Asistente' }).click();
    const caja = (await mapa(page).boundingBox())!;
    await page.mouse.click(caja.x + caja.width / 2 + 150, caja.y + caja.height / 2 - 100);
    const reporte = await (await segunda).json();
    await expect(page.locator('.ent-ficha')).toHaveCount(reporte.lugares.length);
    await expect(page.locator('.ent-ficha.ent-activo')).toHaveCount(0);
  });

  test('si la ficha falla, no queda ningún lugar dibujado', async ({ page }) => {
    await abrirFichaDelCentro(page);
    await expect(page.locator('.ent-ficha').first()).toBeVisible();
    await page.route('**/api/ficha*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo armar la ficha de este punto. Intenta de nuevo.' }) }));
    await page.getByRole('tab', { name: 'Asistente' }).click();
    const caja = (await mapa(page).boundingBox())!;
    await page.mouse.click(caja.x + caja.width / 2 + 150, caja.y + caja.height / 2 - 100);
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await expect(page.locator('.ent-ficha')).toHaveCount(0);
  });
});

test.describe('asistente y mapa', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('«Ver en el mapa» de una tarjeta enfoca su marcador, lo resalta y abre su cuadro', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const tarjeta = page.locator('.avisos-mapa li', { hasText: AVISO_2.titulo });
    await tarjeta.getByRole('button', { name: `Ver en el mapa: ${AVISO_2.titulo}` }).click();
    await expect(page.locator('.marcador-aviso.ent-activo')).toHaveCount(1);
    await expect(page.locator('.marcador-aviso.ent-activo')).toHaveAttribute('title', new RegExp(`^Aviso \\d+: ${AVISO_2.titulo}$`));
    await expect(page.locator('.leaflet-popup-content')).toContainText(AVISO_2.titulo);
    await expect(tarjeta).toHaveAttribute('aria-current', 'true');
    const v = await vista(page);
    expect(v.zoom).toBeGreaterThanOrEqual(16);
    expect(Math.abs(v.lat - AVISO_2.lat)).toBeLessThan(0.002);
    expect(Math.abs(v.lon - AVISO_2.lon)).toBeLessThan(0.002);
  });

  test('ningún aviso empieza resaltado (el orden de la lista no es una preferencia); al elegir uno el resalte es suyo y pasa a otro al elegirlo', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await expect(page.locator('.avisos-mapa li')).toHaveCount(2);
    await expect(page.locator('.avisos-mapa li[aria-current="true"]')).toHaveCount(0);
    await expect(page.locator('.marcador-aviso.ent-activo')).toHaveCount(0);
    await page.getByRole('button', { name: `Ver en el mapa: ${AVISO_1.titulo}` }).click();
    await expect(page.locator('.avisos-mapa li[aria-current="true"] .aviso-nombre')).toHaveText(AVISO_1.titulo);
    await page.getByRole('button', { name: `Ver en el mapa: ${AVISO_2.titulo}` }).click();
    await expect(page.locator('.avisos-mapa li[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('.avisos-mapa li[aria-current="true"] .aviso-nombre')).toHaveText(AVISO_2.titulo);
  });

  test('el trabajo que el asistente ubicó se dibuja con su nombre; la combi o bus se traza solo para el aviso que la persona elige', async ({ page }) => {
    let pedidos = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/viaje')) pedidos++;
    });
    await preguntar(page, CONSULTA_TRABAJO);
    await expect(page.getByRole('button', { name: 'Trabajo: Parque Industrial' })).toBeVisible();
    // Sin aviso elegido no se mide ni se dibuja ninguna ruta, y se le dice a la persona cómo verla.
    await expect(page.getByText('Para ver la ruta al trabajo en el mapa, elige un aviso')).toBeVisible();
    await expect(mapa(page)).not.toHaveAttribute('data-viaje', /\d/);
    expect(pedidos).toBe(0);
    const viaje = page.waitForResponse((r) => r.url().includes('/api/viaje'));
    await page.locator('.avisos-mapa li').first().getByRole('button', { name: /^Ver en el mapa:/ }).click();
    await expect(page.getByText('Para ver la ruta al trabajo en el mapa, elige un aviso')).toHaveCount(0);
    const respuesta = await viaje;
    expect(respuesta.status()).toBe(200);
    const datos = await respuesta.json();
    const url = new URL(respuesta.url());
    expect(Number(url.searchParams.get('destinoLat'))).toBeCloseTo(-16.4179, 3); // el destino es el que ubicó el asistente
    await expect(page.getByRole('button', { name: 'Trabajo: Parque Industrial' })).toBeVisible();
    expect(datos.hayRuta).toBe(true);
    // Lo dibujado es lo que devolvió la API: un tramo por línea y un punto de trasbordo si lo hay.
    await expect(mapa(page)).toHaveAttribute('data-viaje', new RegExp(`^\\d+\\|${datos.trazado.tramos.length}\\|${datos.trazado.trasbordos.length}$`));
    const texto = await page.getByTestId('viaje-estado').innerText();
    expect(texto).toContain(datos.mejor.lineas.join(' → '));
    expect(texto).toMatch(/Ruta al trabajo dibujada en el mapa para el aviso seleccionado/);
    expect(texto).toContain(datos.mejor.trasbordos ? 'con un trasbordo' : 'directa');
    if (datos.mejor.minutos !== null) expect(texto).toContain(`unos ${datos.mejor.minutos} min sin contar la espera`);
    expect(texto).toContain('Tiempo aproximado'); // la nota de que no es una medición
  });

  test('al elegir otro aviso se pide y se dibuja su viaje, no el del anterior', async ({ page }) => {
    await preguntar(page, CONSULTA_TRABAJO);
    await elegirPrimerAviso(page);
    await expect(mapa(page)).toHaveAttribute('data-viaje', /^\d+\|/);
    const primero = (await mapa(page).getAttribute('data-viaje'))!.split('|')[0];
    const tarjetas = page.locator('.avisos-mapa li');
    const otra = tarjetas.and(page.locator(':not([aria-current="true"])')).first();
    const titulo = await otra.locator('.aviso-nombre').innerText();
    const pedido = page.waitForRequest((r) => r.url().includes('/api/viaje'));
    await otra.getByRole('button', { name: `Ver en el mapa: ${titulo}` }).click();
    const q = new URL((await pedido).url()).searchParams;
    const aviso = titulo === AVISO_1.titulo ? AVISO_1 : AVISO_2;
    expect(Number(q.get('origenLat'))).toBeCloseTo(aviso.lat, 4);
    await expect.poll(async () => (await mapa(page).getAttribute('data-viaje'))?.split('|')[0]).not.toBe(primero);
  });

  test('sin ruta en los datos el asistente lo dice y no se dibuja ningún trazado (respuesta del viaje simulada)', async ({ page }) => {
    await page.route('**/api/viaje*', (ruta) => ruta.fulfill({ contentType: 'application/json', body: JSON.stringify({ distanciaM: 9000, hayRuta: false, mejor: null, directas: 0, conTrasbordo: 0, nota: 'x', trazado: null }) }));
    await preguntar(page, CONSULTA_TRABAJO);
    await elegirPrimerAviso(page);
    await expect(page.getByTestId('viaje-estado')).toContainText('No hay una ruta directa ni con un trasbordo en los datos');
    await expect(mapa(page)).toHaveAttribute('data-viaje', '');
  });

  test('si el viaje no se puede medir, lo dice', async ({ page }) => {
    await page.route('**/api/viaje*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo medir el viaje. Intenta de nuevo.' }) }));
    await preguntar(page, CONSULTA_TRABAJO);
    await elegirPrimerAviso(page);
    await expect(page.getByTestId('viaje-estado')).toHaveText('No se pudo medir el viaje. Intenta de nuevo.');
  });

  test('sin criterio de trabajo no se pide ningún viaje ni se dibuja un trabajo', async ({ page }) => {
    let pedidos = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/viaje')) pedidos++;
    });
    await preguntar(page, CONSULTA_AVISOS);
    await expect(page.locator('.marcador-aviso')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^Trabajo:/ })).toHaveCount(0);
    expect(pedidos).toBe(0);
  });

  test('una búsqueda nueva sin trabajo borra el trabajo y el viaje de la anterior', async ({ page }) => {
    await preguntar(page, CONSULTA_TRABAJO);
    await expect(page.getByRole('button', { name: 'Trabajo: Parque Industrial' })).toBeVisible();
    await elegirPrimerAviso(page);
    await expect(mapa(page)).toHaveAttribute('data-viaje', /^\d+\|/);
    await preguntar(page, CONSULTA_AVISOS);
    await expect(page.getByRole('button', { name: /^Trabajo:/ })).toHaveCount(0);
    await expect(mapa(page)).toHaveAttribute('data-viaje', '');
    await expect(page.getByTestId('viaje-estado')).toHaveCount(0);
  });

  test('los sectores de una búsqueda de zonas se numeran en el mapa (respuesta del asistente simulada: con los datos de prueba no hay sectores)', async ({ page }) => {
    const sectores = [
      { n: 1, nombre: 'Cerca de la UNSA', distrito: 'AREQUIPA', hectareas: 12, lat: -16.4, lon: -71.52 },
      { n: 2, nombre: null, distrito: 'CAYMA', hectareas: 7, lat: -16.37, lon: -71.55 },
    ];
    await page.route('**/api/agente', (ruta) =>
      ruta.fulfill({ contentType: 'application/json', body: JSON.stringify({ texto: 'Encontré 2 sectores.', tipo: 'resultado', estado: { consulta: null, pendiente: null }, avisos: [], mapa: { lugares: [], sectores, pideViaje: false } }) }),
    );
    await preguntar(page, 'zonas con salud y colegio');
    await expect(page.locator('.ent-sector')).toHaveCount(2);
    await page.getByRole('button', { name: 'Sector 1: Cerca de la UNSA' }).click();
    const cuadro = page.locator('.leaflet-popup-content');
    await expect(cuadro).toContainText('Sector 1 · cerca de Cerca de la UNSA');
    await expect(cuadro).toContainText('Cumple los criterios pedidos según los datos.');
    await expect(cuadro).not.toContainText('todo lo que pediste');
    await expect(cuadro).toContainText('su contorno no se dibuja');
  });
});

test.describe('el círculo de «cerca de»', () => {
  const chipLugar = (page: import('@playwright/test').Page) => page.locator('.burbuja-agente').last().locator('[data-chip="lugar"]');

  test('«cerca de la UNSA» dibuja un círculo con el radio de «cerca», lo sigue al cambiarlo y desaparece al quitar el criterio', async ({ page }) => {
    await abrir(page);
    await preguntar(page, 'un departamento cerca de la UNSA');
    // Centro en la UNSA y radio de referencia (1,5 km), a la vista del DOM como el resto de lo dibujado.
    await expect(mapa(page)).toHaveAttribute('data-circulo', /^-16\.\d{5}\|-71\.\d{5}\|1500$/);
    const [lat, lon] = ((await mapa(page).getAttribute('data-circulo')) ?? '').split('|').map(Number);
    await expect(page.locator('.circulo-cerca')).toHaveCount(1);
    await expect(page.locator('.etiqueta-circulo')).toHaveText('1,5 km');
    // El lugar queda marcado en el centro del círculo.
    await expect(page.locator('.ent-respuesta')).toHaveCount(1);
    await expect(page.locator('.ent-respuesta')).toHaveAttribute('title', /^Lugar pedido: Universidad Nacional de San Agustín/);
    // Tiene tamaño en el mapa y no tapa los clics: un clic encima sigue eligiendo un punto.
    const caja = (await page.locator('.circulo-cerca').boundingBox())!;
    expect(caja.width).toBeGreaterThan(40);
    await expect(page.locator('.circulo-cerca')).toHaveCSS('pointer-events', 'none');

    // Cambiar el radio en «Lo que entendí» cambia el círculo y su rótulo; el centro no se mueve.
    await chipLugar(page).getByRole('button', { name: /Activar para cambiarlo/ }).click();
    await page.locator('.burbuja-agente').last().getByRole('button', { name: 'A 800 m' }).click();
    await expect(mapa(page)).toHaveAttribute('data-circulo', `${lat.toFixed(5)}|${lon.toFixed(5)}|800`);
    await expect(page.locator('.etiqueta-circulo')).toHaveText('800 m');
    await expect(page.locator('.circulo-cerca')).toHaveCount(1);

    // Quitar el criterio quita el círculo (y su rótulo).
    await chipLugar(page).getByRole('button', { name: /Quitar de tu búsqueda: Cerca de/ }).click();
    await expect(mapa(page)).toHaveAttribute('data-circulo', '');
    await expect(page.locator('.circulo-cerca')).toHaveCount(0);
    await expect(page.locator('.etiqueta-circulo')).toHaveCount(0);
  });

  test('sin un lugar pedido no hay círculo (cerca de un colegio no es un lugar con nombre); con un lugar, un círculo y solo uno', async ({ page }) => {
    await abrir(page);
    await preguntar(page, CONSULTA_AVISOS);
    await expect(mapa(page)).toHaveAttribute('data-circulo', '');
    await expect(page.locator('.circulo-cerca')).toHaveCount(0);
    await preguntar(page, 'un departamento cerca de la UNSA');
    await expect(mapa(page)).toHaveAttribute('data-circulo', /\|1500$/);
    await expect(page.locator('.circulo-cerca')).toHaveCount(1);
    await expect(page.locator('.etiqueta-circulo')).toHaveCount(1);
  });

  test('el círculo se ve en el tema claro y en el oscuro (el mapa de fondo es siempre claro: la tinta del círculo no cambia con el tema)', async ({ page }) => {
    for (const esquema of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: esquema });
      await abrir(page);
      await preguntar(page, 'un departamento cerca de la UNSA');
      await expect(page.locator('.circulo-cerca')).toHaveCount(1);
      const trazo = await page.locator('.circulo-cerca').evaluate((el) => getComputedStyle(el).stroke);
      expect(trazo, esquema).toBe('rgb(28, 58, 107)');
      const etiqueta = await page.locator('.etiqueta-circulo').evaluate((el) => ({ color: getComputedStyle(el).color, fondo: getComputedStyle(el).backgroundColor }));
      expect(etiqueta, esquema).toEqual({ color: 'rgb(28, 58, 107)', fondo: 'rgb(255, 255, 255)' });
    }
  });
});

test.describe('de la pregunta a la ficha y de vuelta', () => {
  test('el aviso del asistente, su marcador, su ficha y sus lugares forman un solo recorrido', async ({ page }) => {
    await abrir(page);
    await preguntar(page, CONSULTA_AVISOS);
    await page.getByRole('button', { name: `Ver ficha del punto: ${AVISO_1.titulo}` }).click();
    await expect(ficha(page)).toBeVisible();
    const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
    expect(lat).toBeCloseTo(AVISO_1.lat, 4);
    expect(lon).toBeCloseTo(AVISO_1.lon, 4);
    await expect(page.locator('.ent-ficha').first()).toBeVisible();
    await expect(page.locator('.marcador-aviso')).toHaveCount(2); // los avisos siguen en el mapa junto a los lugares de la ficha
    await botonDe(page, 'salud').click();
    await expect(page.locator('.ent-ficha.ent-activo')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Asistente' }).click();
    await expect(page.locator('.avisos-mapa li[aria-current="true"]')).toContainText(AVISO_1.titulo);
  });
});
