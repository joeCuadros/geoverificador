/**
 * La ficha del punto como se lee: lo esencial primero, un estado que no depende del color, lo repetido junto, el método y los límites plegados, la fuente y la fecha
 * siempre a la vista, y lo mismo en un teléfono y al imprimir. También los dos detalles del mapa que acompañan a la ficha: el cuadro de un aviso cerca del borde y el
 * botón «Ver ficha del centro del mapa» en un teléfono.
 */
import type { Page } from '@playwright/test';
import { abrir, alejar, clicEnMapa, expect, ficha, mapa, test } from './apoyo.ts';

async function abrirFichaDelCentro(page: Page) {
  const respuesta = page.waitForResponse((r) => r.url().includes('/api/ficha') && r.status() === 200);
  await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
  const reporte = await (await respuesta).json();
  await expect(ficha(page)).toBeVisible();
  return reporte;
}

const item = (page: Page, id: string) => ficha(page).locator(`li[data-item="${id}"]`);

test.describe('ficha: leerla', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('lo esencial va primero y cada frase lleva a su grupo', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const esencial = ficha(page).locator('.f-esencial');
    await expect(esencial.getByRole('heading', { level: 3, name: 'Lo esencial de este punto' })).toBeVisible();
    const enlaces = esencial.getByRole('link');
    expect(await enlaces.count()).toBeGreaterThanOrEqual(3);
    // Va antes que cualquier grupo.
    const yEsencial = (await esencial.boundingBox())!.y;
    const yPrimerGrupo = (await ficha(page).locator('section.f-grupo').first().boundingBox())!.y;
    expect(yEsencial).toBeLessThan(yPrimerGrupo);
    // Nada que parezca un veredicto: ni puntaje ni «buen lugar».
    await expect(esencial).not.toContainText(/puntaje|mejor|recomendad|buen lugar|\d+\s*\/\s*10/i);
    // Seguir una frase lleva el foco al título de su grupo.
    await esencial.getByRole('link', { name: /Cerca/ }).click();
    await expect(ficha(page).getByRole('heading', { level: 3, name: 'Qué hay cerca' })).toBeFocused();
  });

  test('el estado se dice con icono y texto, y lo informativo no se parece a un veredicto', async ({ page }) => {
    await abrirFichaDelCentro(page);
    for (const [clase, texto] of [
      ['estado-cumple', 'Cumple'],
      ['estado-no_cumple', 'No cumple'],
    ] as const) {
      const chip = ficha(page).locator(`.${clase}`).first();
      await expect(chip).toContainText(texto);
      expect(await chip.locator('svg').count()).toBe(1); // el icono acompaña al texto: el color no es lo único que informa
    }
    // Servicios y riesgos son datos de contexto: el grupo lo dice una vez y sus filas no repiten «Informativo».
    for (const id of ['servicios', 'riesgos']) {
      const grupo = ficha(page).locator(`#ficha-g-${id}`);
      await expect(grupo.locator('.f-grupo-cab .estado-informativo')).toContainText('Solo informativo');
      await expect(grupo.locator('li[data-item] .estado-informativo')).toHaveCount(0);
    }
    await expect(ficha(page)).not.toContainText(/INFORMATIVO\s*·/);
  });

  test('el colegio que sirve a tres niveles sale una vez, con un criterio por nivel y su cuánto falta frente a la referencia', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    const colegios = reporte.grupos.flatMap((g: any) => g.subgrupos.flatMap((s: any) => s.items)).filter((i: any) => i.id.startsWith('colegio-'));
    const nombres: string[] = colegios.map((c: any) => c.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
    // Cada colegio sale en una sola fila, y si sirve a varios niveles trae un criterio por nivel, no una fila por nivel.
    for (const c of colegios) {
      await expect(item(page, c.id), c.id).toHaveCount(1);
      const niveles: string[] = (c.criterios ?? []).map((k: any) => k.etiqueta);
      expect(new Set(niveles).size, c.id).toBe(niveles.length);
      await expect(item(page, c.id).locator('.f-criterio'), c.id).toHaveCount(niveles.length);
      for (const k of c.criterios ?? []) await expect(item(page, c.id).locator('.f-criterio', { hasText: k.etiqueta })).toHaveCount(1);
    }
    const conMedidor = colegios.find((c: any) => c.criterios?.length);
    if (conMedidor) await expect(item(page, conMedidor.id).locator('.f-criterio').first().getByRole('img')).toHaveAccessibleName(/\d+ m; referencia hasta/);
  });

  test('los escenarios volcánicos se resumen por el nivel más alto y el detalle queda plegado', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const volcan = item(page, 'peligro-volcanico');
    await expect(volcan).toContainText(/nivel más alto: /);
    const detalle = volcan.locator('details.f-mas').first();
    await expect(detalle).not.toHaveAttribute('open', '');
    await expect(detalle.locator('li').first()).toBeHidden();
    await detalle.locator('summary').click();
    expect(await detalle.locator('li').count()).toBeGreaterThanOrEqual(2);
    await expect(detalle.locator('li').first()).toBeVisible();
  });

  test('las cifras se escriben a la española y sin textos duplicados', async ({ page }) => {
    await abrirFichaDelCentro(page);
    await page.locator('.ficha details').evaluateAll((es) => es.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const texto = await ficha(page).innerText();
    expect(texto).not.toMatch(/Sin umbral:\s*Sin umbral/i);
    expect(texto).not.toMatch(/\d,\d{3}\s*m²/); // 10,132 m² (coma de miles) estaría mal
    expect(texto).not.toMatch(/\[object Object\]|undefined|NaN/);
    // El área verde lleva su superficie con el separador de miles y la coma decimal.
    await expect(item(page, 'area-verde')).toContainText(/\d[\d\s ]*m² \(\d+,\d+ ha\)/);
  });

  test('cada elemento muestra su fuente y su fecha sin abrir nada', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const items = ficha(page).locator('li[data-item]');
    const total = await items.count();
    for (let i = 0; i < total; i++) await expect(items.nth(i).locator('.f-fuente').first()).toBeVisible();
    // El método y lo que el dato no dice sí están plegados.
    const plegado = ficha(page).locator('#ficha-g-cerca details.f-mas-grupo');
    await expect(plegado).not.toHaveAttribute('open', '');
    await expect(plegado.locator('summary')).toContainText('Cómo se calculó');
    await expect(plegado.locator('.f-mas-bloque').first()).toBeHidden();
    await plegado.locator('summary').click();
    await expect(plegado.locator('.f-mas-bloque').first()).toBeVisible();
    await expect(plegado).toContainText('Qué no dice');
  });

  test('con el teclado se abre y se cierra el detalle de un grupo', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const plegado = ficha(page).locator('#ficha-g-moverse details.f-mas-grupo');
    await plegado.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(plegado).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(plegado).not.toHaveAttribute('open', '');
  });

  test('hay pasos concretos antes de decidir y solo las limitaciones que aplican, con el resto plegado', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const pasos = ficha(page).locator('#ficha-pasos');
    await expect(pasos.getByRole('heading', { level: 3, name: 'Antes de decidir' })).toBeVisible();
    await expect(pasos).toContainText(/Certificado de Zonificación/);
    await expect(pasos).toContainText(/Copia literal de la partida/);
    const limites = ficha(page).locator('.f-limites');
    const visibles = await limites.locator(':scope > ul > li').count();
    expect(visibles).toBeGreaterThanOrEqual(2);
    expect(visibles).toBeLessThanOrEqual(4);
    const todas = limites.locator('details.f-mas');
    await expect(todas.locator('summary')).toContainText(/Todas las limitaciones \(\d+\)/);
    await todas.locator('summary').click();
    expect(await todas.locator('li').count()).toBeGreaterThan(visibles);
  });

  test('la navegación por secciones lleva al grupo y deja el foco en su título', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const nav = ficha(page).getByRole('navigation', { name: 'Secciones de la ficha' });
    for (const [enlace, titulo] of [
      ['Riesgos', 'Riesgos y restricciones'],
      ['Moverse', 'Cómo moverse'],
    ] as const) {
      await nav.getByRole('link', { name: enlace }).click();
      await expect(ficha(page).getByRole('heading', { level: 3, name: titulo })).toBeFocused();
    }
  });

  test('un punto fuera del plano dice «Sin dato» en la zona y no inventa una', async ({ page }) => {
    await alejar(page, 5);
    await clicEnMapa(page, 150, 100);
    await expect(ficha(page)).toBeVisible();
    const zona = item(page, 'zona');
    await expect(zona.locator('.estado-sin_dato')).toContainText('Sin dato');
    await expect(zona).toContainText(/fuera del área zonificada/i);
    await expect(zona).not.toContainText(/ZRE|ZRP|ZRM/);
  });
});

test.describe('ficha: imprimir', () => {
  test('al imprimir se despliega todo y se quitan los controles', async ({ page }) => {
    await abrir(page);
    await abrirFichaDelCentro(page);
    expect(await ficha(page).locator('details:not([open])').count()).toBeGreaterThan(3);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect.poll(() => ficha(page).locator('details:not([open])').count()).toBe(0);
    await expect(ficha(page).getByRole('navigation', { name: 'Secciones de la ficha' })).toBeHidden();
    await expect(ficha(page).locator('.f-ver').first()).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await expect.poll(() => ficha(page).locator('details:not([open])').count()).toBeGreaterThan(3);
  });
});

test.describe('ficha en un teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('cabe en 390 px sin desplazamiento horizontal y los controles se pueden tocar', async ({ page }) => {
    await abrir(page);
    await abrirFichaDelCentro(page);
    await page.locator('.ficha details').evaluateAll((es) => es.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(ancho).toBeLessThanOrEqual(visible);
    // Nada de la ficha se sale del panel.
    const sobresale = await ficha(page).evaluate((raiz) => {
      const borde = raiz.getBoundingClientRect().right + 1;
      return [...raiz.querySelectorAll('*')].filter((e) => !e.closest('.f-nav') && e.getBoundingClientRect().right > borde).map((e) => `${e.tagName}.${e.className}: ${e.textContent?.slice(0, 40)}`);
    });
    expect(sobresale).toEqual([]);
    // Objetivos de al menos 44 px.
    for (const sel of ['.f-nav a', 'button.f-item-boton', '.f-esencial a', 'summary']) {
      const cajas = await ficha(page).locator(sel).evaluateAll((es) => es.map((e) => e.getBoundingClientRect().height));
      expect(cajas.length, sel).toBeGreaterThan(0);
      for (const h of cajas) expect(h, sel).toBeGreaterThanOrEqual(43.5);
    }
  });
});

test.describe('mapa: detalles que acompañan a la ficha', () => {
  const MOCK = {
    texto: 'Encontré 2 avisos.',
    tipo: 'resultado',
    estado: { consulta: null, pendiente: null },
    avisos: [
      { id: 1, titulo: 'Departamento norte (de prueba)', url: 'https://portal.example/1', lat: -16.3705, lon: -71.5435, cumplidos: 1, pedidos: 2, precio: 400000, moneda: 'PEN', distrito: 'CAYMA' },
      { id: 2, titulo: 'Departamento sur (de prueba)', url: 'https://portal.example/2', lat: -16.4105, lon: -71.5435, cumplidos: 1, pedidos: 2, precio: 420000, moneda: 'PEN', distrito: 'AREQUIPA' },
    ],
    mapa: { lugares: [], sectores: [], pideViaje: false },
  };

  for (const [nombre, vp, tactil] of [
    ['en escritorio', { width: 1280, height: 800 }, false],
    ['en un teléfono', { width: 390, height: 844 }, true],
  ] as const) {
    test.describe(nombre, () => {
      test.use({ viewport: vp, hasTouch: tactil, isMobile: tactil });

      test('el cuadro de un aviso pegado al borde de arriba queda entero dentro del mapa', async ({ page }) => {
        await page.route('**/api/agente', (ruta) => ruta.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) }));
        await abrir(page);
        await page.getByRole('searchbox').first().isVisible();
        await page.getByLabel('Tu consulta').fill('avisos');
        await page.getByRole('button', { name: 'Enviar' }).click();
        await expect(page.locator('.marcador-aviso')).toHaveCount(2);
        // El marcador más alto es el que más cerca queda del borde de arriba.
        const arriba = await page.locator('.marcador-aviso').evaluateAll((es) => es.map((e, i) => ({ i, y: e.getBoundingClientRect().top })).sort((a, b) => a.y - b.y)[0].i);
        await page.locator('.marcador-aviso').nth(arriba).click();
        const cuadro = page.locator('.leaflet-popup');
        await expect(cuadro).toBeVisible();
        await expect.poll(async () => {
          const m = (await mapa(page).boundingBox())!;
          const c = (await cuadro.boundingBox())!;
          return c.y >= m.y - 0.5 && c.x >= m.x - 0.5 && c.x + c.width <= m.x + m.width + 0.5 && c.y + c.height <= m.y + m.height + 0.5;
        }).toBe(true);
      });

      test('«Ver ficha del centro del mapa» no tapa nada del mapa', async ({ page }) => {
        await abrir(page);
        const boton = page.getByRole('button', { name: 'Ver ficha del centro del mapa' });
        const b = (await boton.boundingBox())!;
        const m = (await mapa(page).boundingBox())!;
        const choca = b.x < m.x + m.width && b.x + b.width > m.x && b.y < m.y + m.height && b.y + b.height > m.y;
        expect(choca, 'el botón está fuera del lienzo del mapa').toBe(false);
        expect(b.height).toBeGreaterThanOrEqual(43.5);
        expect(m.height).toBeGreaterThan(tactil ? 250 : 400);
        await expect(page.getByRole('button', { name: /Capas del mapa/ })).toBeVisible();
      });
    });
  }
});
