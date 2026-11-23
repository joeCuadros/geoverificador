import { AVISO_1, CONSULTA_AVISOS, abrir, expect, ficha, leerCoordenadas, preguntar, test } from './apoyo.ts';

test('de la pregunta a la ficha: el aviso del chat se ubica en el mapa y su botón abre la ficha del entorno', async ({ page }) => {
  await abrir(page);
  const r = await preguntar(page, CONSULTA_AVISOS);
  await expect(page.locator('.marcador-aviso')).toHaveCount(2);

  await r.getByRole('button', { name: new RegExp(`Ver ficha del entorno: ${AVISO_1.titulo}`) }).click();
  await expect(page.getByRole('tab', { name: 'Ficha del punto' })).toHaveAttribute('aria-selected', 'true');
  await expect(ficha(page)).toBeVisible();
  const { lat, lon } = leerCoordenadas(await page.getByTestId('ficha-coordenadas').innerText());
  expect(lat).toBeCloseTo(AVISO_1.lat, 4);
  expect(lon).toBeCloseTo(AVISO_1.lon, 4);
  await expect(ficha(page)).toContainText('Distrito de Yanahuara');
  await expect(ficha(page)).toContainText(/RENIPRESS.*datos del \d{4}-\d{2}-\d{2}/);

  // La conversación sigue donde estaba al volver al asistente.
  await page.getByRole('tab', { name: 'Asistente' }).click();
  await expect(page.locator('.burbuja-yo').last()).toContainText('Yanahuara');
  await expect(r).toBeVisible();
  await expect(page.locator('.marcador-aviso')).toHaveCount(2);
});

test('ningún enlace del chat es javascript: ni de otro esquema que http(s)', async ({ page }) => {
  await abrir(page);
  await preguntar(page, CONSULTA_AVISOS);
  const hrefs = await page.locator('.chat-log a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const h of hrefs) expect(h).toMatch(/^https?:\/\//);
});
