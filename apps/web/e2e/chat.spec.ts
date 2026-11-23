import { AVISO_1, AVISO_2, CONSULTA_AVISOS, abrir, expect, preguntar, test } from './apoyo.ts';

test.describe('chat', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('empieza con la bienvenida y un campo etiquetado para escribir', async ({ page }) => {
    await expect(page.getByRole('log', { name: 'Conversación con el asistente' })).toContainText('Cuéntame qué buscas en Arequipa');
    await expect(page.getByLabel('Tu consulta')).toBeEditable();
    await expect(page.getByText('Revisa siempre el aviso original')).toBeVisible();
  });

  test('un saludo recibe la explicación de lo que el asistente puede hacer', async ({ page }) => {
    const r = await preguntar(page, 'hola');
    await expect(r).toContainText('Puedo buscar avisos de venta en Arequipa');
    await expect(page.locator('.burbuja-yo').last()).toHaveText(/hola/);
    await expect(page.locator('.avisos-mapa')).toHaveCount(0);
  });

  test('pregunta una sola cosa cuando falta un dato y la conversación sigue con la respuesta', async ({ page }) => {
    const pregunta = await preguntar(page, 'Quiero un departamento cerca de mi trabajo y que no cueste más de medio millón');
    await expect(pregunta).toContainText('¿Dónde queda tu trabajo?');
    const siguiente = await preguntar(page, 'Parque Industrial');
    // El asistente recordó la consulta anterior: ya no repite la pregunta del trabajo.
    await expect(siguiente).not.toContainText('¿Dónde queda tu trabajo?');
  });

  test('una búsqueda con resultados lista los avisos con su enlace original y los ubica en el mapa', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r).toContainText('Encontré 3 avisos');
    // Cada aviso es una tarjeta con su enlace al original (ADR 0002: enlace y fecha de última vez visto).
    await expect(r.locator('.tarjeta-aviso')).toHaveCount(3);
    await expect(r.getByRole('link', { name: new RegExp(`Abrir el aviso original de ${AVISO_1.titulo}`) })).toHaveAttribute('href', AVISO_1.url);
    await expect(r.getByRole('link', { name: new RegExp(`Abrir el aviso original de ${AVISO_2.titulo}`) })).toHaveAttribute('href', AVISO_2.url);
    await expect(r.getByRole('link', { name: new RegExp(`Abrir el aviso original de ${AVISO_1.titulo}`) })).toHaveAttribute('rel', /noopener/);
    await expect(r.locator('.aviso-fuente').first()).toContainText('Visto por última vez el');
    await expect(r).toContainText('S/ 400 000');
    // Dos de los tres avisos tienen coordenadas: los dos aparecen en el mapa y el tercero se dice aparte, en su propia lista.
    await expect(r.locator('.avisos-mapa .avisos-titulo')).toHaveText('2 avisos ubicados en el mapa');
    await expect(r.locator('.avisos-mapa li.tarjeta-aviso')).toHaveCount(2);
    await expect(r.locator('.avisos-sin-mapa .avisos-titulo')).toContainText('1 aviso sin ubicación conocida');
    await expect(r.locator('.avisos-sin-mapa .aviso-sin-mapa')).toContainText('no aparece en el mapa');
    await expect(page.locator('.marcador-aviso')).toHaveCount(2);
  });

  test('una búsqueda nueva reemplaza los marcadores y una sin resultados los quita', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await expect(page.locator('.marcador-aviso')).toHaveCount(2);
    const casa = await preguntar(page, 'una casa en Cayma hasta 700 mil soles');
    await expect(casa).toContainText('Casa de prueba en Cayma');
    await expect(page.locator('.marcador-aviso')).toHaveCount(1);
    const vacio = await preguntar(page, 'un terreno en Yura hasta 100 mil soles');
    await expect(vacio).toContainText('No encontré avisos con lo que pides');
    await expect(vacio.locator('.avisos-mapa')).toHaveCount(0);
    await expect(page.locator('.marcador-aviso')).toHaveCount(0);
  });

  test('un saludo no borra los marcadores de la búsqueda anterior', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    await preguntar(page, 'hola');
    await expect(page.locator('.marcador-aviso')).toHaveCount(2);
  });

  test('no envía un mensaje vacío', async ({ page }) => {
    let pedidos = 0;
    await page.route('**/api/agente', (ruta) => {
      pedidos++;
      return ruta.continue();
    });
    await page.getByLabel('Tu consulta').fill('   ');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.burbuja-yo')).toHaveCount(0);
    expect(pedidos).toBe(0);
  });

  test('se envía con Enter y el foco vuelve al campo', async ({ page }) => {
    await page.getByLabel('Tu consulta').fill('hola');
    await page.getByLabel('Tu consulta').press('Enter');
    await expect(page.locator('.burbuja-agente')).toHaveCount(2);
    await expect(page.getByLabel('Tu consulta')).toBeFocused();
  });

  test('si el servidor no responde, lo dice y deja volver a intentar', async ({ page }) => {
    await page.route('**/api/agente', (ruta) => ruta.abort('connectionrefused'));
    const r = await preguntar(page, 'hola');
    await expect(r).toContainText('No pude conectar');
    await expect(r).toContainText('Reintentar');
    // Dice qué falló y qué hacer; el error es parte de la conversación (no una alerta anidada en el registro: la región `status` lo anuncia).
    await expect(r).not.toHaveAttribute('role', 'alert');
    await expect(page.locator('.chat').getByRole('status')).toContainText('No pude conectar');
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    // Lo escrito vuelve al campo para no tener que escribirlo de nuevo.
    await expect(page.getByLabel('Tu consulta')).toHaveValue('hola');
    await page.unroute('**/api/agente');
    const ok = await preguntar(page, 'hola');
    await expect(ok).toContainText('Puedo buscar avisos');
  });

  test('«Reintentar» vuelve a enviar el mismo mensaje sin repetirlo en la conversación', async ({ page }) => {
    await page.route('**/api/agente', (ruta) => ruta.abort('connectionrefused'));
    const error = await preguntar(page, 'hola');
    await page.unroute('**/api/agente');
    await error.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.locator('.burbuja-agente').last()).toContainText('Puedo buscar avisos');
    await expect(page.locator('.burbuja-error')).toHaveCount(0);
    await expect(page.locator('.burbuja-yo')).toHaveCount(1);
  });

  test('muestra el mensaje del servidor cuando responde con un error', async ({ page }) => {
    await page.route('**/api/agente', (ruta) => ruta.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Llegaste al límite de consultas por hora. Intenta más tarde.' }) }));
    const r = await preguntar(page, 'hola');
    await expect(r).toContainText('Llegaste al límite de consultas por hora');
    await expect(r).not.toHaveAttribute('role', 'alert');
    await expect(page.locator('.chat').getByRole('status')).toContainText('Llegaste al límite de consultas por hora');
  });

  test('un texto con HTML se muestra como texto y no se ejecuta', async ({ page }) => {
    const r = await preguntar(page, '<img src=x onerror="window.__xss=1"> hola');
    await expect(r).toBeVisible();
    await expect(page.locator('.burbuja-yo').last()).toContainText('<img src=x onerror=');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    await expect(page.locator('.burbuja-yo img')).toHaveCount(0);
  });
});
