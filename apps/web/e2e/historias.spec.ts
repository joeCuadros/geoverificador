/**
 * Historias de la búsqueda con el asistente (H1 a H5) y reglas del producto (R1, R3 a R8) sobre la aplicación en marcha.
 * Los avisos son los de e2e/datos/avisos.json: cuatro avisos de prueba (tres departamentos en Yanahuara, uno sin coordenadas, y una casa en Cayma).
 */
import { AVISO_1, AVISO_2, CONSULTA_AVISOS, abrir, expect, marcadorDeAviso, preguntar, test } from './apoyo.ts';

const LIMITES = [
  'GeoVerificador informa: no es asesoría legal ni financiera.',
  'Agua, luz y desagüe son la cobertura de la manzana en el censo de 2017, no una garantía del servicio en el predio.',
  'Cada aviso lleva la fecha en que se vio por última vez y el enlace al original: confirma precio y disponibilidad ahí.',
  'Las distancias son en línea recta.',
];
const URL_3 = 'https://portal.example/inmueble/e2e-yanahuara-3';
const sinEspacios = (t: string) => t.replace(/\s+/g, '');

test.beforeEach(async ({ page }) => abrir(page));

const FUENTE_Y_FECHA = /Fuente: .+ · datos del \d{4}-\d{2}-\d{2}/;

test.describe('H1 · búsqueda con criterios', () => {
  test('cada aviso trae su marca por criterio con el valor, la fuente y la fecha, los criterios con dato que cumplen y la última vez visto', async ({ page }) => {
    const r = await preguntar(page, 'un departamento en Yanahuara a menos de 150 m de un colegio');
    // Cumple, no cumple y sin dato: las tres marcas son un icono dibujado más su texto (el color nunca es lo único), con su valor, su fuente y la fecha de los datos.
    const cumple = r.locator('.criterio-cumple', { hasText: 'Colegio' });
    await expect(cumple).toHaveCount(1);
    await expect(cumple.locator('.estado-cumple')).toHaveText('Cumple');
    await expect(cumple.locator('.estado svg')).toHaveCount(1);
    await expect(cumple).toContainText('142 m');
    await expect(cumple.locator('.criterio-pie')).toContainText(FUENTE_Y_FECHA);
    const noCumple = r.locator('.criterio-no_cumple', { hasText: 'Colegio' });
    await expect(noCumple.locator('.estado-no_cumple')).toHaveText('No cumple');
    await expect(noCumple.locator('.estado svg')).toHaveCount(1);
    await expect(noCumple).toContainText('157 m');
    await expect(noCumple.locator('.criterio-pie')).toContainText(FUENTE_Y_FECHA);
    const sinDato = r.locator('.criterio-sin_dato', { hasText: 'Colegio' });
    await expect(sinDato.locator('.estado-sin_dato')).toHaveText('Sin dato');
    await expect(sinDato.locator('.estado svg')).toHaveCount(1);
    await expect(sinDato).toContainText('sin dato (el aviso no tiene coordenadas)');
    const resumenes = r.locator('.aviso-resumen');
    await expect(resumenes.filter({ hasText: 'Criterios con dato que cumplen: 1 de 1 · 0 sin dato' })).toHaveCount(1);
    await expect(resumenes.filter({ hasText: 'Criterios con dato que cumplen: 0 de 1 · 0 sin dato' })).toHaveCount(1);
    await expect(resumenes.filter({ hasText: 'Ningún criterio con dato · 1 sin dato' })).toHaveCount(1);
    // Es un recuento, no una barra ni una nota: no hay segmentos dibujados.
    await expect(r.locator('.resumen-barras, .seg')).toHaveCount(0);
    await expect(r.locator('.aviso-fuente')).toHaveText([/Visto por última vez el \d{4}-\d{2}-\d{2}/, /Visto por última vez el \d{4}-\d{2}-\d{2}/, /Visto por última vez el \d{4}-\d{2}-\d{2}/]);
    for (const url of [AVISO_1.url, AVISO_2.url, URL_3]) await expect(r.locator(`a.boton-enlace[href="${url}"]`)).toHaveCount(1);
  });

  test('R6 · no hay puntaje ni ganador: el orden es solo por criterios cumplidos y no se nombra «la mejor»', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    const texto = await r.innerText();
    expect(texto).not.toMatch(/puntaje|puntos|score|ranking|ganador|\bla mejor\b|\bel mejor\b|recomendad[oa]|\d+ ?\/ ?10\b|estrellas/i);
    await expect(r.locator('.resultados-orden')).toContainText('no una calificación ni una recomendación');
    await expect(page.locator('.avisos-mapa')).not.toContainText(/puntaje|ganador|mejor opci/i);
  });

  test('R5 · las líneas de límites cierran la respuesta, después de la última tarjeta y en su orden', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    const limites = r.locator('.limites');
    await expect(limites).toBeVisible();
    await expect(limites.locator('li')).toHaveText(LIMITES);
    // En el documento, el bloque de límites va después de la última tarjeta de aviso.
    const despues = await r.evaluate((burbuja) => {
      const tarjetas = [...burbuja.querySelectorAll('.tarjeta-aviso')];
      const bloque = burbuja.querySelector('.limites')!;
      return tarjetas.length > 0 && tarjetas.every((t) => Boolean(t.compareDocumentPosition(bloque) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(despues).toBe(true);
  });

  test('R3 · «sin dato» es un estado propio: se marca con su icono («?») y su texto, y nunca cuenta como cumplido ni como cero', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    const sinDato = r.locator('.criterio-sin_dato');
    await expect(sinDato).toHaveCount(1);
    await expect(sinDato.locator('.estado-sin_dato')).toHaveText('Sin dato');
    await expect(sinDato.locator('.estado svg')).toHaveCount(1);
    await expect(sinDato).toContainText('sin dato (el aviso no tiene coordenadas)');
    await expect(r.locator('.criterio-cumple, .criterio-no_cumple').filter({ hasText: /sin dato/i })).toHaveCount(0);
    expect(await r.innerText()).not.toMatch(/Colegio\s*0 m/);
    await expect(r.locator('.aviso-resumen').filter({ hasText: 'Ningún criterio con dato · 1 sin dato' })).toHaveCount(1);
    await expect(r.locator('.notas-resultado')).toContainText('sus criterios de cercanía figuran como «sin dato»');
  });

  test('R4 · cada criterio medido dice su fuente y la fecha de los datos', async ({ page }) => {
    const r = await preguntar(page, 'un departamento en Yanahuara cerca de un colegio y de un mercado');
    const medidos = r.locator('.criterio-cumple, .criterio-no_cumple');
    expect(await medidos.count()).toBeGreaterThanOrEqual(4);
    for (const pie of await medidos.locator('.criterio-pie').allInnerTexts()) expect(pie, pie).toMatch(FUENTE_Y_FECHA);
  });
});

test.describe('H2 · una pregunta por turno y la respuesta completa la consulta', () => {
  test('pregunta solo la moneda y, al responderla, conserva el tipo, el distrito y el precio', async ({ page }) => {
    const pregunta = await preguntar(page, 'Quiero una casa en Cayma hasta 700 mil');
    await expect(pregunta).toContainText('¿El precio máximo es en soles o en dólares?');
    expect(((await pregunta.innerText()).match(/¿/g) ?? []).length).toBe(1);
    await expect(page.locator('.avisos-mapa')).toHaveCount(0);
    const resultado = await preguntar(page, 'soles');
    await expect(resultado).toContainText('Encontré 1 aviso');
    await expect(resultado).toContainText('Casa de prueba en Cayma');
    await expect(resultado).not.toContainText('Departamento de prueba');
    await expect(page.locator('.marcador-aviso')).toHaveCount(1);
  });

  test('con dos datos pendientes los pide de a uno, en orden', async ({ page }) => {
    const primera = await preguntar(page, 'Quiero un departamento cerca de mi trabajo y que no cueste más de medio millón');
    await expect(primera).toContainText('¿Dónde queda tu trabajo?');
    const segunda = await preguntar(page, 'Parque Industrial');
    await expect(segunda).toContainText('¿El precio máximo es en soles o en dólares?');
    expect(((await segunda.innerText()).match(/¿/g) ?? []).length).toBe(1);
    const final = await preguntar(page, 'soles');
    await expect(final).toContainText('Encontré');
    await expect(final).toContainText('Llegar al trabajo');
  });
});

test.describe('H3 · la distancia que pone la persona se respeta', () => {
  test('con 800 m, el colegio a 157 m cumple; con 150 m, no cumple, y el de 142 m sigue cumpliendo', async ({ page }) => {
    const amplio = await preguntar(page, 'un departamento en Yanahuara a menos de 800 m de un colegio');
    await expect(amplio.locator('.criterio-cumple', { hasText: '157 m' })).toHaveCount(1);
    await expect(amplio.locator('.criterio-pie').first()).toContainText('Pediste: a 800 m o menos');
    const estricto = await preguntar(page, 'un departamento en Yanahuara a menos de 150 m de un colegio');
    await expect(estricto.locator('.criterio-no_cumple', { hasText: '157 m' })).toHaveCount(1);
    await expect(estricto.locator('.criterio-cumple', { hasText: '142 m' })).toHaveCount(1);
  });

  test('«5 cuadras» se entiende como una distancia pedida y la convención del asistente no se anuncia', async ({ page }) => {
    const r = await preguntar(page, 'un departamento en Yanahuara a 1 cuadra de un mercado');
    const texto = await r.innerText();
    expect(texto).not.toContain('es una convención del agente');
  });

  test('si la persona no pone distancia en un criterio que es convención del asistente, lo dice con el valor usado', async ({ page }) => {
    const r = await preguntar(page, 'un departamento en Yanahuara cerca de un mercado');
    await expect(r).toContainText('«Mercado o supermercado»: usé 800 m como referencia; es una convención del agente, puedes pedir otra.');
    const conDistancia = await preguntar(page, 'un departamento en Yanahuara a 600 m de un mercado');
    await expect(conDistancia).not.toContainText('es una convención del agente');
  });
});

test.describe('H4 · de dónde sale un dato', () => {
  test('responde con la fuente, la fecha de los datos, la licencia, el límite y el enlace', async ({ page }) => {
    const r = await preguntar(page, 'de dónde sale el dato de los paraderos');
    const texto = (await r.innerText()).replace(/\s+/g, ' ');
    expect(texto).toMatch(/OpenStreetMap — datos del \d{4}-\d{2}-\d{2} — licencia: ODbL — límite: OpenStreetMap es colaborativo/);
    await expect(r.getByRole('link', { name: 'https://www.openstreetmap.org/copyright' })).toBeVisible();
    await expect(page.locator('.avisos-mapa')).toHaveCount(0);
  });
});

test.describe('H5 · búsqueda de zonas', () => {
  test('cuando no hay sectores que cumplan todo, lo dice sin inventar ninguno', async ({ page }) => {
    const r = await preguntar(page, 'zonas con salud y colegio');
    await expect(r).toContainText('No encontré sectores que cumplan todo a la vez.');
    await expect(page.locator('.marcador-aviso')).toHaveCount(0);
  });
});

test.describe('R8 · lo que no está disponible se dice', () => {
  test('al pedir seguridad, avisa que no tiene ese dato y que no lo usó para filtrar', async ({ page }) => {
    const r = await preguntar(page, 'un departamento en Yanahuara con seguridad y silencio');
    await expect(r).toContainText('No tengo datos de: la seguridad de la zona; no lo usé para filtrar.');
    await expect(r).toContainText('Encontré 3 avisos');
  });
});

test.describe('R1 y R2 · todo sale de la respuesta de la API y las tarjetas no llevan fotos ni datos del vendedor', () => {
  test('cada enlace, precio y marcador del chat y del mapa corresponde a un aviso de la respuesta', async ({ page }) => {
    const respuesta = page.waitForResponse((x) => x.url().endsWith('/api/agente'));
    const r = await preguntar(page, CONSULTA_AVISOS);
    const api = await (await respuesta).json();
    const urls: string[] = api.avisos.map((a: any) => a.url);
    const hrefs = await r.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.length).toBe(urls.length);
    for (const h of hrefs) expect(urls).toContain(h);
    // Los precios de la respuesta escrita y de las tarjetas son los de la API.
    const precios = new Set<string>(api.avisos.map((a: any) => `S/${a.precio}`));
    // Lo que se compara son los precios de los avisos; el tope que puso la persona (en «Lo que entendí») es suyo, no de un aviso.
    const escritos = sinEspacios(await r.locator('.resultados').innerText()).match(/S\/\d+/g) ?? [];
    expect(escritos.length).toBeGreaterThan(0);
    for (const p of escritos) expect(precios, p).toContain(p);
    // Un marcador por aviso con coordenadas, y ninguno para el que no las tiene.
    const conUbicacion = api.avisos.filter((a: any) => a.lat !== null && a.lon !== null);
    expect(conUbicacion.length).toBeLessThan(api.avisos.length);
    await expect(page.locator('.marcador-aviso')).toHaveCount(conUbicacion.length);
    for (const a of conUbicacion) await expect(marcadorDeAviso(page, a.titulo)).toBeVisible();
    await expect(page.getByRole('button', { name: /sin ubicación/ })).toHaveCount(0);
  });

  test('las tarjetas del chat y el cuadro del marcador no muestran fotos, descripción ni datos del vendedor', async ({ page }) => {
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r.locator('img, picture, video, iframe')).toHaveCount(0);
    await marcadorDeAviso(page, AVISO_1.titulo).click();
    const cuadro = page.locator('.leaflet-popup-content');
    await expect(cuadro).toBeVisible();
    await expect(cuadro.locator('img, picture, video, iframe')).toHaveCount(0);
    for (const t of [await r.innerText(), await cuadro.innerText()]) expect(t).not.toMatch(/tel[eé]fono|whatsapp|vendedor|propietari|correo|@\w+\.\w+|descripci[oó]n/i);
  });
});

test.describe('R7 · límite de 600 caracteres', () => {
  test('el campo de texto no admite más de 600 caracteres', async ({ page }) => {
    const campo = page.getByLabel('Tu consulta');
    await expect(campo).toHaveAttribute('maxlength', '600');
    await campo.focus();
    await page.keyboard.insertText('x'.repeat(700));
    expect((await campo.inputValue()).length).toBe(600);
  });
});
