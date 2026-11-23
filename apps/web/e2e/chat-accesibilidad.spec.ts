/**
 * El chat visto con lectores de pantalla, teclado y la regla del producto de no ordenar, puntuar ni recomendar:
 * anuncios, encabezados, foco, etiquetas del punto de contacto con el modelo de lenguaje, el campo de 600 caracteres y las sugerencias de alivio.
 */
import type { Page } from '@playwright/test';
import { CONSULTA_AVISOS, abrir, clicEnMapa, expect, preguntar, test } from './apoyo.ts';

const estado = (page: Page) => page.locator('.chat').getByRole('status');

test.describe('lectores de pantalla', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('un h2 «Asistente» y los encabezados de las respuestas no saltan de nivel (h1, h2, h3)', async ({ page }) => {
    await expect(page.locator('.chat').getByRole('heading', { level: 2, name: 'Asistente' })).toHaveCount(1);
    await preguntar(page, CONSULTA_AVISOS);
    const niveles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].filter((h) => !h.closest('[hidden]')).map((h) => Number(h.tagName[1])),
    );
    expect(niveles[0]).toBe(1);
    for (let i = 1; i < niveles.length; i++) expect(niveles[i] - niveles[i - 1], `encabezados ${niveles.join(',')}`).toBeLessThanOrEqual(1);
    expect(niveles).toContain(3);
  });

  test('solo el titular de la respuesta se anuncia, por una única región «status» que existe desde el principio', async ({ page }) => {
    await expect(estado(page)).toHaveCount(1);
    await expect(estado(page)).toHaveText('');
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(estado(page)).toHaveCount(1);
    await expect(estado(page)).toContainText('Encontré 3 avisos');
    // Es el titular, no la respuesta entera: no repite tarjetas, criterios ni enlaces.
    const anunciado = (await estado(page).innerText()).trim();
    expect(anunciado).not.toMatch(/Fuente:|Abrir el aviso|https?:/);
    expect(await r.innerText()).toContain(anunciado.replace(/\s+/g, ' ').slice(0, 20));
    // Una sola región sobre el contenido de la burbuja: ni alertas ni estados anidados dentro de la conversación.
    await expect(page.locator('.chat-log [role="status"], .chat-log [role="alert"]')).toHaveCount(0);
  });

  test('una respuesta que viene de un botón deja el foco en su burbuja, con un nombre corto (no se lee toda la tarjeta)', async ({ page }) => {
    await page.getByRole('group', { name: 'Ejemplos para empezar' }).getByRole('button').first().click();
    const respuesta = page.locator('.burbuja-agente').last();
    await expect(page.locator('.burbuja-agente')).toHaveCount(2);
    await expect(respuesta).toBeFocused();
    await expect(respuesta).toHaveAttribute('role', 'group');
    await expect(respuesta).toHaveAttribute('aria-label', 'Respuesta del asistente');
  });

  test('un chip abierto controla un elemento que existe; cerrado no apunta a nada', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    const boton = r.locator('[data-chip="criterio:colegio"]').getByRole('button', { name: /Activar para cambiarlo/ });
    await expect(boton).not.toHaveAttribute('aria-controls', /./);
    await boton.click();
    const id = await boton.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  });

  test('las listas sin viñetas conservan su rol, los enlaces externos dicen que abren otra pestaña y la tabla que se desplaza es una región con teclado', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    for (const clase of ['ul.chips', 'ul.tarjetas', 'ul.notas-resultado', '.sugerencias ul']) {
      const listas = r.locator(clase);
      expect(await listas.count(), clase).toBeGreaterThan(0);
      for (const l of await listas.all()) await expect(l, clase).toHaveAttribute('role', 'list');
    }
    const enlace = r.getByRole('link', { name: /Abrir el aviso original/ }).first();
    await expect(enlace).toHaveAccessibleName(/\(abre en otra pestaña\)/);
    const comparacion = await preguntar(page, 'compara el 1 y el 2');
    const region = comparacion.getByRole('region', { name: /Comparación lado a lado/ });
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(comparacion.getByRole('link', { name: /Departamento de prueba/ }).first()).toHaveAccessibleName(/\(abre en otra pestaña\)/);
    await region.focus();
    await expect(region).toBeFocused();
  });
});

test.describe('lo que no es una clasificación', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('«Aviso 1» es una etiqueta con contorno y sin relleno; el recuento no es una barra', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    const etiquetas = r.locator('.tarjeta-aviso .tarjeta-posicion');
    await expect(etiquetas).toHaveText(['Aviso 1', 'Aviso 2', 'Aviso 3']);
    for (const e of await etiquetas.all()) {
      const estilo = await e.evaluate((el) => {
        const c = getComputedStyle(el);
        return { fondo: c.backgroundColor, borde: c.borderTopWidth, redondo: c.borderTopLeftRadius };
      });
      expect(estilo.fondo).toBe('rgba(0, 0, 0, 0)');
      expect(estilo.borde).not.toBe('0px');
    }
    await expect(r.locator('.resumen-barras, .seg')).toHaveCount(0);
    await expect(r.locator('.aviso-resumen').first()).toContainText('Criterios con dato que cumplen');
  });

  test('«Compara el 1 y el 2» (no «los dos primeros») y la comparación repite que el orden es de lectura', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r.getByRole('button', { name: 'Compara el 1 y el 2' })).toBeVisible();
    await expect(r.getByText(/dos primeros/i)).toHaveCount(0);
    await expect(r.locator('.resultados-orden')).toContainText('no una calificación ni una recomendación');
    const c = await preguntar(page, 'compara el 1 y el 2');
    await expect(c.locator('.resultados-orden')).toContainText('orden de lectura, no una calificación ni una recomendación');
    await expect(c.locator('thead .tarjeta-posicion')).toHaveText(['Aviso 1', 'Aviso 2']);
  });

  test('el botón de alivio usa el estilo neutro, no el relleno de la acción principal', async ({ page }) => {
    const r = await preguntar(page, 'una casa en Cayma hasta 100 mil soles');
    const alivio = r.getByRole('button', { name: 'Quitar el tope de precio' });
    const colores = await alivio.evaluate((el) => {
      const sonda = document.createElement('i');
      sonda.style.background = 'var(--tinta)';
      document.body.append(sonda);
      const tinta = getComputedStyle(sonda).backgroundColor;
      sonda.remove();
      return { fondo: getComputedStyle(el).backgroundColor, tinta };
    });
    expect(colores.fondo).not.toBe(colores.tinta);
    await page.mouse.move(0, 0); // sin el cursor encima (el relleno de «hover» es otro tono)
    const enviar = await page.getByRole('button', { name: 'Enviar' }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(enviar).toBe(colores.tinta); // el relleno de tinta queda para la acción principal
  });
});

test.describe('foco y campo para escribir', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('el anillo de foco de un chip va por dentro (el chip recorta lo que sobresale)', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    const quitar = r.locator('[data-chip="criterio:colegio"] .chip-quitar');
    await r.locator('[data-chip="criterio:colegio"] .chip-cuerpo').focus();
    await page.keyboard.press('Tab');
    await expect(quitar).toBeFocused();
    const contorno = await quitar.evaluate((el) => ({ estilo: getComputedStyle(el).outlineStyle, desfase: getComputedStyle(el).outlineOffset }));
    expect(contorno.estilo).not.toBe('none');
    expect(Number.parseFloat(contorno.desfase)).toBeLessThan(0);
  });

  test('lo que recibe el foco no queda debajo del campo de escribir', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.cuerpo-panel:not([hidden])')!;
      panel.scrollTop = 0;
    });
    const ultimo = r.locator('.tarjeta-aviso').last().getByRole('button', { name: /Ver ficha del punto/ }).or(r.locator('.tarjeta-aviso').last().getByRole('link', { name: /Abrir el aviso original/ })).last();
    await ultimo.focus();
    const caja = (await ultimo.boundingBox())!;
    const campo = (await page.locator('.compositor').boundingBox())!;
    expect(caja.y + caja.height).toBeLessThanOrEqual(campo.y + 1);
  });

  test('en una pantalla de menos de 480 px de alto el campo de escribir no va pegado abajo', async ({ page }) => {
    const posicion = () => page.locator('.compositor').evaluate((el) => getComputedStyle(el).position);
    expect(await posicion()).toBe('sticky');
    await page.setViewportSize({ width: 800, height: 460 });
    await expect.poll(posicion).toBe('static');
    await expect(page.locator('.chat')).toHaveCSS('--alto-compositor', '0px');
  });

  test('la etiqueta «Tu consulta» se ve y el contador dice cuántos de los 600 caracteres se usaron', async ({ page }) => {
    const etiqueta = page.locator('label[for="mensaje"]');
    await expect(etiqueta).toBeVisible();
    await expect(etiqueta).toHaveText('Tu consulta');
    await expect(page.locator('#mensaje-contador')).toHaveText('0 de 600 caracteres');
    await expect(page.getByLabel('Tu consulta')).toHaveAttribute('aria-describedby', 'mensaje-contador');
    await page.getByLabel('Tu consulta').fill('hola');
    await expect(page.locator('#mensaje-contador')).toHaveText('4 de 600 caracteres');
    await page.getByLabel('Tu consulta').fill('x'.repeat(600));
    await expect(page.locator('#mensaje-contador')).toContainText('llegaste al límite');
    await expect(page.locator('form.mensaje-form')).toHaveCount(1); // el paso de la guía de primera visita apunta a este formulario
  });

  test('el punto elegido en el mapa se escribe «lat, lon» con punto decimal', async ({ page }) => {
    await clicEnMapa(page);
    await page.getByRole('tab', { name: 'Asistente' }).click();
    const texto = await page.locator('.punto-elegido p').innerText();
    expect(texto).toMatch(/-?\d+\.\d{5}, -?\d+\.\d{5}/);
    expect(texto).not.toContain(';');
  });
});

test.describe('privacidad: lo que sale hacia Google', () => {
  /** Responde /api/agente/estado como si el servidor tuviera clave de Gemini. */
  async function conModelo(page: Page, modelo: boolean) {
    await page.route('**/api/agente/estado', async (ruta) => {
      const r = await ruta.fetch();
      await ruta.fulfill({ response: r, json: { ...(await r.json()), modelo } });
    });
  }

  test('con el modelo activo el aviso está junto al campo desde antes de enviar, en un tamaño legible y fiel a lo que se envía', async ({ page }) => {
    await conModelo(page, true);
    await abrir(page);
    const aviso = page.getByTestId('aviso-modelo');
    await expect(aviso).toBeVisible();
    await expect(page.locator('.compositor').getByTestId('aviso-modelo')).toHaveCount(1);
    await expect(aviso).toContainText('Google');
    await expect(aviso).toContainText('tu mensaje');
    await expect(aviso).toContainText('lo que se entendió de tu búsqueda');
    await expect(aviso).toContainText('un resumen de los resultados, sin coordenadas');
    expect(await aviso.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    // Está encima del campo, no debajo.
    const a = (await aviso.boundingBox())!;
    const campo = (await page.getByLabel('Tu consulta').boundingBox())!;
    expect(a.y + a.height).toBeLessThanOrEqual(campo.y);
    await expect(page.locator('.nota-pie')).not.toContainText('Google');
  });

  test('con el modelo apagado no hay aviso de Google', async ({ page }) => {
    await conModelo(page, false);
    await abrir(page);
    await expect(page.getByText('Revisa siempre el aviso original')).toBeVisible();
    await expect(page.getByTestId('aviso-modelo')).toHaveCount(0);
  });
});
