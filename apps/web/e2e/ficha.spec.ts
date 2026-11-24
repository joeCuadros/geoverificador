/**
 * La ficha del punto como se lee: lo esencial primero, un estado que no depende del color, lo repetido junto, el método y los límites plegados, la fuente y la fecha
 * siempre a la vista, y lo mismo en un teléfono y al imprimir. También los dos detalles del mapa que acompañan a la ficha: el cuadro de un aviso cerca del borde y el
 * botón «Ver ficha del centro del mapa» en un teléfono.
 */
import type { Page } from '@playwright/test';
import { AVISO_1, CONSULTA_AVISOS, abrir, alejar, clicEnMapa, expect, ficha, mapa, preguntar, test } from './apoyo.ts';

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

test.describe('ficha: jerarquía, desconocidos y lectura', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('lo esencial cuenta las distancias de cada grupo con icono y texto, sin total ni puntaje, y «sin dato» no se mezcla con «no cumple»', async ({ page }) => {
    const reporte = await abrirFichaDelCentro(page);
    for (const g of reporte.grupos) {
      const conteo = ficha(page).locator(`#ficha-g-${g.id} > .f-conteo`);
      const esperado = g.conteo.cumple + g.conteo.noCumple + g.conteo.sinDato;
      await expect(conteo, g.id).toHaveCount(esperado > 0 ? 1 : 0);
      if (esperado === 0) continue;
      for (const [clase, n] of [
        ['cumple', g.conteo.cumple],
        ['no_cumple', g.conteo.noCumple],
        ['sin_dato', g.conteo.sinDato],
      ] as const) {
        const parte = conteo.locator(`.f-conteo-${clase}`);
        await expect(parte, `${g.id} ${clase}`).toHaveCount(n > 0 ? 1 : 0);
        if (n > 0) {
          await expect(parte).toContainText(String(n));
          expect(await parte.locator('svg').count(), `${g.id} ${clase}: el icono acompaña al texto`).toBe(1);
        }
      }
      // El mismo recuento aparece en lo esencial, junto a la frase que lleva al grupo.
      await expect(ficha(page).locator(`.f-esencial a[href="#ficha-g-${g.id}"] .f-conteo`)).toHaveCount(1);
    }
    await expect(ficha(page).locator('.f-conteo').first()).not.toContainText(/puntaje|mejor|recomendad|\d+\s*\/\s*\d+|total/i);
  });

  test('un dato sin dato se ve distinto de un «no cumple»: línea discontinua, fondo hundido y su propio dibujo', async ({ page }) => {
    await alejar(page, 5);
    await clicEnMapa(page, 150, 100);
    await expect(ficha(page)).toBeVisible();
    const zona = item(page, 'zona');
    await expect(zona).toHaveAttribute('data-estado', 'sin_dato');
    expect(await zona.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe('dashed');
    const chip = zona.locator('.estado-sin_dato');
    expect(await chip.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('dashed');
    await expect(chip.locator('svg')).toHaveCount(1);
    // Ningún elemento sin dato lleva el chip de un veredicto.
    await expect(ficha(page).locator('li[data-estado="sin_dato"] :is(.estado-cumple, .estado-no_cumple)')).toHaveCount(0);
  });

  test('el origen de cada dato se lee con su fuente rotulada y, si falta la fecha, lo dice', async ({ page }) => {
    await abrirFichaDelCentro(page);
    await expect(item(page, 'salud').locator('.f-fuente')).toContainText(/Fuente: .*RENIPRESS.* · datos del \d{4}-\d{2}-\d{2}/s);
    await expect(item(page, 'zona').locator('.f-fuente')).toContainText(/Fuente: .* · sin fecha en la base/s);
    await expect(ficha(page).locator('.f-fecha time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  });

  test('la prosa va en Source Serif 4 con renglones de 65 caracteres y los datos en Public Sans', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const fuentes = await ficha(page).evaluate((raiz) => {
      const de = (sel: string) => [...raiz.querySelectorAll(sel)].map((e) => getComputedStyle(e).fontFamily);
      return { prosa: de('.f-grupo-resumen, .f-aviso, .f-texto'), datos: de('.f-distancia, .f-fuente, .estado') };
    });
    expect(fuentes.prosa.length).toBeGreaterThan(2);
    for (const f of fuentes.prosa) expect(f).toContain('Source Serif 4');
    expect(fuentes.datos.length).toBeGreaterThan(2);
    for (const f of fuentes.datos) expect(f).toContain('Public Sans');
    // Ningún párrafo de prosa pasa de 65ch (65 × el ancho de «0» de su tipografía).
    const pasados = await ficha(page).locator('.f-prosa').evaluateAll((es) =>
      es
        .map((e) => {
          const cs = getComputedStyle(e);
          const lienzo = document.createElement('canvas').getContext('2d')!;
          lienzo.font = `${cs.fontSize} ${cs.fontFamily}`;
          const cero = lienzo.measureText('0').width;
          return { texto: (e.textContent ?? '').slice(0, 30), ancho: e.getBoundingClientRect().width, limite: 65 * cero + 1 };
        })
        .filter((m) => m.ancho > m.limite),
    );
    expect(pasados).toEqual([]);
  });

  test('el botón de un elemento con lugar lleva el estado y la fuente como descripción para el lector de pantalla', async ({ page }) => {
    await abrirFichaDelCentro(page);
    const boton = ficha(page).locator('button.f-item-boton').first();
    expect(await boton.getAttribute('aria-describedby')).toMatch(/^ficha-i-/);
    await expect(boton).toHaveAccessibleName(/^Ver en el mapa: /);
    await expect(boton).toHaveAccessibleDescription(/(Cumple|No cumple|Informativo|Sin dato)[\s\S]*Fuente: /);
  });

  test('los encabezados bajan de a un nivel: ficha (2), grupos (3), subgrupos y detalles (4)', async ({ page }) => {
    await abrirFichaDelCentro(page);
    await page.locator('.ficha details').evaluateAll((es) => es.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const niveles = await ficha(page).evaluate((raiz) => [...raiz.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1])));
    expect(niveles[0]).toBe(2);
    for (let i = 1; i < niveles.length; i++) expect(niveles[i] - niveles[i - 1], `encabezado ${i}`).toBeLessThanOrEqual(1);
    expect(niveles).not.toContain(5);
  });

  test('un anuncio para lectores de pantalla dice cuándo se arma y cuándo está lista la ficha', async ({ page }) => {
    await page.route('**/api/ficha*', async (ruta) => {
      await new Promise((f) => setTimeout(f, 600));
      await ruta.continue();
    });
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    const anuncio = page.getByRole('tabpanel', { name: 'Ficha del punto' }).getByRole('status');
    await expect(anuncio).toHaveText(/^Armando la ficha de /);
    await expect(ficha(page)).toBeVisible();
    await expect(anuncio).toHaveText(/ está lista\.$/);
  });

  test('si el foco se quedó sin lugar (se tocó un botón del asistente que ya no se ve), pasa al título de la ficha', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await r.getByRole('button', { name: new RegExp(`Ver ficha del punto: ${AVISO_1.titulo}`) }).click();
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page).getByRole('heading', { level: 2, name: 'Ficha del punto' })).toBeFocused();
  });

  test('si falla la ficha y se reintenta, el foco llega al título y no se queda en el botón que desapareció', async ({ page }) => {
    await page.route('**/api/ficha*', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo armar la ficha de este punto. Intenta de nuevo.' }) }));
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    const reintentar = page.getByRole('button', { name: 'Reintentar' });
    await expect(reintentar).toBeVisible();
    await page.unroute('**/api/ficha*');
    await reintentar.click();
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page).getByRole('heading', { level: 2, name: 'Ficha del punto' })).toBeFocused();
  });

  test('si el foco está en el mapa, abrir la ficha no se lo quita', async ({ page }) => {
    await clicEnMapa(page);
    await expect(ficha(page)).toBeVisible();
    await expect(ficha(page).getByRole('heading', { level: 2, name: 'Ficha del punto' })).not.toBeFocused();
  });

  test('con movimiento reducido, la ficha no hace transiciones', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrirFichaDelCentro(page);
    const duraciones = await ficha(page).locator('.f-esencial a, .f-nav a, button.f-item-boton').evaluateAll((es) => es.map((e) => getComputedStyle(e).transitionDuration));
    expect(duraciones.length).toBeGreaterThan(3);
    for (const d of duraciones) expect(d).toBe('0s');
  });

  test('en el tema oscuro el ámbar sigue siendo solo del aviso y el estado se lee con contraste', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await abrirFichaDelCentro(page);
    const luz = (rgb: string) => {
      const [r, g, b] = rgb
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contraste = (a: string, b: string) => {
      const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const aviso = await ficha(page).locator('.f-aviso').evaluate((e) => ({ fondo: getComputedStyle(e).backgroundColor, texto: getComputedStyle(e).color }));
    expect(aviso.fondo).toBe('rgb(53, 40, 10)');
    expect(contraste(aviso.fondo, aviso.texto)).toBeGreaterThanOrEqual(4.5);
    // El texto de cada estado contra el fondo de su fila (el del panel, #171d2b, si la fila no tiene uno propio).
    for (const clase of ['estado-cumple', 'estado-no_cumple', 'estado-sin_dato']) {
      const c = ficha(page).locator(`.${clase}`).first();
      if (!(await c.count())) continue;
      const m = await c.evaluate((e) => {
        const fila = e.closest('li');
        const fondo = fila ? getComputedStyle(fila).backgroundColor : 'rgba(0, 0, 0, 0)';
        return { fondo, texto: getComputedStyle(e).color };
      });
      const fondo = m.fondo === 'rgba(0, 0, 0, 0)' ? 'rgb(23, 29, 43)' : m.fondo;
      expect(contraste(fondo, m.texto), clase).toBeGreaterThanOrEqual(4.5);
    }
    const ambar = await ficha(page).evaluate((raiz) => [...raiz.querySelectorAll('*')].filter((e) => getComputedStyle(e).backgroundColor === 'rgb(53, 40, 10)' && !e.classList.contains('f-aviso')).length);
    expect(ambar).toBe(0);
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

test.describe('ficha a 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('cabe sin desplazamiento horizontal, con objetivos de 44 px y sin que nada se salga del panel', async ({ page }) => {
    await abrir(page);
    await abrirFichaDelCentro(page);
    await page.locator('.ficha details').evaluateAll((es) => es.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(ancho).toBeLessThanOrEqual(visible);
    const sobresale = await ficha(page).evaluate((raiz) => {
      const borde = raiz.getBoundingClientRect().right + 1;
      return [...raiz.querySelectorAll('*')].filter((e) => !e.closest('.f-nav') && e.getBoundingClientRect().right > borde).map((e) => `${e.tagName}.${e.className}`);
    });
    expect(sobresale).toEqual([]);
    for (const sel of ['.f-nav a', 'button.f-item-boton', '.f-esencial a', 'summary', '.f-acciones button']) {
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
