/**
 * El asistente como guía interactivo: entiende erratas y respuestas vagas, no pierde lo ya entendido, ofrece respuestas rápidas y deja corregir lo que entendió.
 * Incluye la conversación real de una persona que se quejó de que el asistente «no contestaba y no era interactivo». Los avisos son los de e2e/datos/avisos.json.
 */
import type { Locator, Page } from '@playwright/test';
import { AVISO_1, CONSULTA_AVISOS, abrir, clicEnMapa, expect, preguntar, test } from './apoyo.ts';

const ultimaBurbuja = (page: Page): Locator => page.locator('.burbuja-agente').last();
const chip = (r: Locator, clave: string): Locator => r.locator(`[data-chip="${clave}"]`);

/** Toca un botón de la última respuesta y espera la siguiente. */
async function tocar(page: Page, nombre: string | RegExp): Promise<Locator> {
  const antes = await page.locator('.burbuja-agente').count();
  await ultimaBurbuja(page).getByRole('button', { name: nombre }).first().click();
  await expect(page.locator('.burbuja-agente')).toHaveCount(antes + 1);
  await expect(page.locator('.pensando')).toHaveCount(0);
  return ultimaBurbuja(page);
}

test.describe('la conversación que no funcionaba', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('con erratas en el tipo y en los dos lugares, entiende, lo dice y busca', async ({ page }) => {
    const r = await preguntar(page, 'quiero un aprtamente cerca a la unsa y a mi trabajo en  el parquie idnustrial');
    await expect(r).toContainText('Entendí «aprtamente» como «apartamento»');
    await expect(r).toContainText('Entendí «parquie idnustrial» como «Parque Industrial»');
    await expect(chip(r, 'tipo')).toContainText('Departamento');
    await expect(chip(r, 'trabajo')).toContainText('Parque Industrial');
    await expect(chip(r, 'lugar')).toContainText('Universidad Nacional de San Agustín');
    // Hay resultados medidos contra esos dos lugares, no una ayuda genérica.
    await expect(r.locator('.tarjeta-aviso').first()).toBeVisible();
    await expect(r.locator('.criterio', { hasText: 'Llegar al trabajo' }).first()).toBeVisible();
    await expect(r.locator('.criterio', { hasText: 'Universidad Nacional de San Agustín' }).first()).toBeVisible();
    await expect(r).not.toContainText('Puedo buscar avisos de venta');
  });

  test('turno por turno: pregunta el tipo con botones, «departamente» lo completa sin perder los lugares y «cualquiera» se acepta', async ({ page }) => {
    const pregunta = await preguntar(page, 'quiero algo cerca a la unsa y a mi trabajo en el parquie idnustrial');
    await expect(pregunta).toContainText('¿Qué tipo de inmueble buscas');
    await expect(pregunta.getByRole('button', { name: 'Departamento' })).toBeVisible();
    await expect(pregunta.getByRole('button', { name: 'Cualquiera' })).toBeVisible();
    // Lo ya entendido se ve aunque falte el tipo.
    await expect(chip(pregunta, 'lugar')).toBeVisible();
    await expect(chip(pregunta, 'trabajo')).toBeVisible();

    const resultado = await preguntar(page, 'departamente');
    await expect(resultado.locator('.tarjeta-aviso').first()).toBeVisible();
    await expect(chip(resultado, 'tipo')).toContainText('Departamento');
    await expect(chip(resultado, 'lugar')).toBeVisible();
    await expect(chip(resultado, 'trabajo')).toBeVisible();

    const vaga = await preguntar(page, 'cualquiera');
    await expect(vaga).toContainText('no tienes preferencia');
    await expect(vaga.getByRole('button').first()).toBeVisible();
  });

  test('«cualquiera» como respuesta al tipo busca de todos los tipos', async ({ page }) => {
    await preguntar(page, 'quiero algo en Yanahuara');
    const r = await preguntar(page, 'cualquiera');
    await expect(r.locator('.tarjeta-aviso')).toHaveCount(3);
    await expect(chip(r, 'tipo')).toContainText('Cualquier tipo');
  });

  test('nunca contesta lo mismo dos veces cuando no entiende, y siempre ofrece qué hacer', async ({ page }) => {
    const textos = new Set<string>();
    for (const m of ['asdf qwer', 'zxcv uiop', 'qwerty', 'mnbv']) {
      const r = await preguntar(page, m);
      await expect(r.getByRole('button').first()).toBeVisible();
      const t = (await r.locator('.burbuja-texto').innerText()).replace(/«[^»]*»/g, '«…»');
      expect(textos.has(t), t).toBe(false);
      textos.add(t);
    }
  });
});

test.describe('respuestas rápidas y resumen editable', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('al empezar dice qué cubre el asistente y ofrece ejemplos que se tocan', async ({ page }) => {
    await expect(page.locator('.burbuja-cobertura')).toContainText('Tengo 4 avisos vigentes en 2 distritos');
    const ejemplos = page.getByRole('group', { name: 'Ejemplos para empezar' });
    await expect(ejemplos.getByRole('button')).toHaveCount(4);
    await ejemplos.getByRole('button').first().click();
    await expect(page.locator('.burbuja-yo').last()).toContainText('Un departamento');
    await expect(page.locator('.burbuja-agente')).toHaveCount(2);
  });

  test('una respuesta rápida se activa con el teclado', async ({ page }) => {
    const pregunta = await preguntar(page, 'quiero algo en Yanahuara');
    await pregunta.getByRole('button', { name: 'Departamento' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.burbuja-agente')).toHaveCount(3);
    await expect(ultimaBurbuja(page)).toContainText('Encontré');
  });

  test('quitar un dato del resumen repite la búsqueda sin él', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r.locator('.criterio', { hasText: 'Colegio' }).first()).toBeVisible();
    await expect(chip(r, 'criterio:colegio')).toContainText('a 1,5 km o menos');
    await expect(chip(r, 'distrito')).toContainText('Yanahuara');
    await expect(chip(r, 'precio')).toContainText('S/ 450 000');
    const sin = await tocar(page, /Quitar de tu búsqueda: Colegio/);
    await expect(page.locator('.burbuja-yo').last()).toContainText('Quitar «Colegio');
    await expect(sin).toContainText('Quité el criterio «Colegio»');
    await expect(sin.locator('.tarjeta-aviso')).toHaveCount(3);
    await expect(sin.locator('.criterio')).toHaveCount(0);
    await expect(chip(sin, 'criterio:colegio')).toHaveCount(0);
    await expect(chip(sin, 'distrito')).toContainText('Yanahuara');
  });

  test('cambiar un dato del resumen: otra distancia vuelve a medir', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await chip(r, 'criterio:colegio').getByRole('button', { name: /Activar para cambiarlo/ }).click();
    await expect(chip(r, 'criterio:colegio').getByRole('button', { name: /Activar para cambiarlo/ })).toHaveAttribute('aria-expanded', 'true');
    const nuevo = await tocar(page, 'A 150 m');
    await expect(nuevo.locator('.criterio-pie').first()).toContainText('Pediste: a 150 m o menos');
    await expect(chip(nuevo, 'criterio:colegio')).toContainText('a 150 m o menos');
  });

  test('solo la última respuesta tiene el resumen y los botones activos', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const segunda = await preguntar(page, 'sin el colegio');
    await expect(page.locator('.entendido')).toHaveCount(1);
    await expect(segunda.locator('.entendido')).toHaveCount(1);
  });

  test('sin resultados dice qué filtro los excluyó y un toque lo quita', async ({ page }) => {
    const vacio = await preguntar(page, 'una casa en Cayma hasta 100 mil soles');
    await expect(vacio).toContainText('Con el tope de precio de S/ 100 000 no hay avisos; sin ese tope hay 1 y el más barato cuesta S/ 650 000');
    await expect(vacio.getByRole('button', { name: 'Subir el tope a S/ 650 000' })).toBeVisible();
    await expect(page.locator('.marcador-aviso')).toHaveCount(0);
    const r = await tocar(page, 'Quitar el tope de precio');
    await expect(r.locator('.tarjeta-aviso')).toHaveCount(1);
    await expect(r).toContainText('Casa de prueba en Cayma');
    await expect(chip(r, 'precio')).toHaveCount(0);
    await expect(page.locator('.marcador-aviso')).toHaveCount(1);
  });

  test('seguimientos en contexto: «sin el colegio», «¿y en Cayma?» y «más barato»', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const sin = await preguntar(page, 'sin el colegio');
    await expect(sin.locator('.criterio')).toHaveCount(0);
    await expect(chip(sin, 'tipo')).toContainText('Departamento');
    const otro = await preguntar(page, '¿y en Cayma?');
    await expect(chip(otro, 'distrito')).toContainText('Cayma');
    await expect(chip(otro, 'tipo')).toContainText('Departamento');
    await expect(otro).toContainText('En Cayma no hay avisos con esos filtros; en cualquier distrito hay 3');
    const barato = await preguntar(page, 'y más barato');
    await expect(chip(barato, 'precio')).toContainText('S/ 360 000');
  });

  test('«más barato» sin tope pregunta el tope en vez de inventarlo', async ({ page }) => {
    await preguntar(page, 'un departamento en Yanahuara');
    const pregunta = await preguntar(page, 'más barato');
    await expect(pregunta).toContainText('¿Hasta cuánto quieres pagar?');
    await expect(pregunta.getByRole('button', { name: 'Sin tope de precio' })).toBeVisible();
    const r = await preguntar(page, 'hasta 410 mil soles');
    await expect(r.locator('.tarjeta-aviso')).toHaveCount(2);
  });
});

test.describe('lo que el asistente responde del mapa y entre avisos', () => {
  test.beforeEach(async ({ page }) => abrir(page));

  test('con un punto elegido en el mapa, «¿qué hay aquí?» responde desde la ficha, con fuente y fecha', async ({ page }) => {
    await clicEnMapa(page);
    await page.getByRole('tab', { name: 'Asistente' }).click();
    await expect(page.locator('.punto-elegido')).toContainText('Punto elegido en el mapa');
    await page.getByRole('button', { name: '¿Qué hay aquí?' }).click();
    const r = ultimaBurbuja(page);
    await expect(r.locator('.ficha-chat')).toBeVisible();
    await expect(r.locator('.criterio', { hasText: 'Salud' })).toContainText('RENIPRESS');
    await expect(r.locator('.criterio', { hasText: 'Salud' }).locator('.criterio-pie')).toContainText(/datos del \d{4}-\d{2}-\d{2}/);
    expect(await r.innerText()).not.toMatch(/puntaje|ganador|la mejor|el mejor/i);
  });

  test('preguntarlo escrito también funciona, y sin punto elegido explica cómo elegirlo', async ({ page }) => {
    const sin = await preguntar(page, '¿qué hay en este punto?');
    await expect(sin).toContainText('primero elígelo en el mapa');
    await expect(page.locator('.punto-elegido')).toHaveCount(0);
    await clicEnMapa(page);
    await page.getByRole('tab', { name: 'Asistente' }).click();
    const con = await preguntar(page, 'qué hay en este punto');
    await expect(con.locator('.ficha-chat')).toBeVisible();
  });

  test('compara dos avisos lado a lado, sin puntaje ni ganador', async ({ page }) => {
    await preguntar(page, CONSULTA_AVISOS);
    const r = await preguntar(page, 'compara el 1 y el 2');
    await expect(r.locator('.comparacion table')).toBeVisible();
    await expect(r.locator('.comparacion thead th')).toHaveCount(3);
    await expect(r.locator('.comparacion tbody th', { hasText: 'Precio' })).toBeVisible();
    await expect(r.locator('.comparacion tbody th', { hasText: 'Colegio' })).toBeVisible();
    await expect(r).toContainText('No hay puntaje ni una opción ganadora');
    expect(await r.innerText()).not.toMatch(/\bla mejor\b|\bel mejor\b|recomendad/i);
    await expect(r.getByRole('link', { name: AVISO_1.titulo })).toHaveAttribute('href', AVISO_1.url);
  });

  test('sin una lista previa, comparar explica qué hace falta', async ({ page }) => {
    const r = await preguntar(page, 'compara el 1 y el 2');
    await expect(r).toContainText('Para comparar necesito una lista');
    await expect(r.locator('.comparacion')).toHaveCount(0);
  });
});

test.describe('estado de espera y distribución', () => {
  test('mientras responde muestra qué hace, con un texto fijo y sin anunciarse (lo que se anuncia es el titular de la respuesta)', async ({ page }) => {
    await abrir(page);
    await page.route('**/api/agente', async (ruta) => {
      await new Promise((f) => setTimeout(f, 1500));
      await ruta.continue();
    });
    await page.getByLabel('Tu consulta').fill(CONSULTA_AVISOS);
    await page.getByRole('button', { name: 'Enviar' }).click();
    const espera = page.locator('.pensando');
    await expect(espera).toBeVisible();
    await expect(espera).not.toHaveAttribute('role', /./);
    await expect(espera).toContainText('Entendiendo tu mensaje');
    const texto = await espera.innerText();
    await page.waitForTimeout(1000); // el texto no cambia por pasos: una región viva lo volvería a leer cada vez
    expect(await espera.innerText()).toBe(texto);
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await expect(page.locator('.burbuja-agente')).toHaveCount(2);
    await expect(espera).toHaveCount(0);
  });

  test('con movimiento reducido la espera no anima', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await page.route('**/api/agente', async (ruta) => {
      await new Promise((f) => setTimeout(f, 1000));
      await ruta.continue();
    });
    await page.getByLabel('Tu consulta').fill('hola');
    await page.getByLabel('Tu consulta').press('Enter');
    const punto = page.locator('.pensando-puntos i').first();
    await expect(punto).toBeVisible();
    expect(await punto.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  test('la última tarjeta no queda tapada por el campo de escribir (escritorio)', async ({ page }) => {
    await abrir(page);
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r.locator('.tarjeta-aviso')).toHaveCount(3);
    await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.cuerpo-panel:not([hidden])')!;
      panel.scrollTop = panel.scrollHeight;
    });
    const ultima = (await r.locator('.tarjeta-aviso').last().boundingBox())!;
    const campo = (await page.locator('.compositor').boundingBox())!;
    expect(ultima.y + ultima.height).toBeLessThanOrEqual(campo.y + 1);
    // Y la respuesta nueva se lee desde su primera línea, no desde el final.
    const nueva = await preguntar(page, 'un departamento en Yanahuara cerca de un mercado');
    const panel = (await page.locator('.cuerpo-panel:not([hidden])').boundingBox())!;
    const arriba = (await nueva.boundingBox())!;
    expect(arriba.y).toBeGreaterThanOrEqual(panel.y - 1);
    expect(arriba.y).toBeLessThan(panel.y + 200);
  });

  test('la ayuda de arranque llega de /api/agente/estado con cifras de la base', async ({ request }) => {
    const j = await (await request.get('/api/agente/estado')).json();
    expect(j.cobertura).toMatchObject({ publicacionActiva: true, vigentes: 4 });
    expect(j.cobertura.distritos.map((d: any) => d.nombre).sort()).toEqual(['CAYMA', 'YANAHUARA']);
    expect(j.resumen).toContain('4 avisos vigentes');
    expect(j.modelo).toBe(false);
  });
});

test.describe('en un teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('los botones se tocan bien, nada desborda y la última tarjeta queda sobre el campo de escribir', async ({ page }) => {
    await abrir(page);
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r.locator('.tarjeta-aviso')).toHaveCount(3);
    for (const b of [...(await r.locator('.sugerencia').all()), ...(await r.locator('.chip-quitar').all()), ...(await r.locator('.boton-secundario').all()), ...(await r.locator('.boton-enlace').all())]) {
      const caja = (await b.boundingBox())!;
      expect(caja.height, await b.innerText()).toBeGreaterThanOrEqual(43.5);
    }
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(ancho).toBeLessThanOrEqual(visible);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const ultima = (await r.locator('.tarjeta-aviso').last().boundingBox())!;
    const campo = (await page.locator('.compositor').boundingBox())!;
    expect(ultima.y + ultima.height).toBeLessThanOrEqual(campo.y + 1);
  });

  test('la comparación y la ficha del punto caben en la pantalla', async ({ page }) => {
    await abrir(page);
    await preguntar(page, CONSULTA_AVISOS);
    await preguntar(page, 'compara el 1 y el 2');
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(ancho).toBeLessThanOrEqual(visible);
  });
});
