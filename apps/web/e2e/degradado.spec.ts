/**
 * H10 · errores internos reales y límite por hora (429). Corre contra el servidor «degradado»: base vacía en memoria (toda consulta falla) y un límite de
 * 4 solicitudes por hora y por ruta. Las pruebas van en orden porque comparten ese contador; los demás servidores no se ven afectados.
 */
import { abrir, alerta, expect, test } from './apoyo.ts';

test.describe.configure({ mode: 'serial' });

const SIN_FILTRACIONES = /boom|stack|\bat\s+\S+\s*\(|node_modules|\.ts:\d+|relation|does not exist|PGlite|postgres/i;

test.describe('error interno', () => {
  test('la ficha responde 500 con un mensaje claro y sin detalles internos', async ({ request }) => {
    const r = await request.get('/api/ficha?lat=-16.39883&lon=-71.53697');
    expect(r.status()).toBe(500);
    const texto = await r.text();
    expect(JSON.parse(texto)).toEqual({ error: 'No se pudo armar la ficha de este punto. Intenta de nuevo.' });
    expect(texto).not.toMatch(SIN_FILTRACIONES);
  });

  test('la búsqueda de lugares responde 500 con un mensaje claro y sin detalles internos', async ({ request }) => {
    const r = await request.get('/api/buscar?q=plaza');
    expect(r.status()).toBe(500);
    const texto = await r.text();
    expect(JSON.parse(texto).error).toBe('No se pudo buscar el lugar. Intenta de nuevo.');
    expect(texto).not.toMatch(SIN_FILTRACIONES);
  });

  test('el chat muestra el mensaje del servidor, no una pila ni un error en blanco', async ({ page }) => {
    await abrir(page);
    await page.getByLabel('Tu consulta').fill('hola');
    await page.getByRole('button', { name: 'Enviar' }).click();
    const aviso = page.locator('.burbuja-error').filter({ hasText: 'No pude procesar tu consulta' });
    await expect(aviso).toBeVisible();
    expect(await aviso.innerText()).not.toMatch(SIN_FILTRACIONES);
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeEnabled();
  });

  test('la ficha del mapa muestra el mensaje del servidor y deja reintentar', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    const aviso = alerta(page).filter({ hasText: 'No se pudo armar la ficha de este punto' });
    await expect(aviso).toBeVisible();
    expect(await aviso.innerText()).not.toMatch(SIN_FILTRACIONES);
    await expect(aviso.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });
});

test.describe('límite por hora', () => {
  test('el agente responde 429 al pasar el límite, con el mensaje y sin llegar a la base', async ({ request }) => {
    const estados: number[] = [];
    let ultima: any = null;
    for (let i = 0; i < 10 && estados.at(-1) !== 429; i++) {
      const r = await request.post('/api/agente', { data: {} }); // sin mensaje: cuenta para el límite y se rechaza con 400
      estados.push(r.status());
      ultima = await r.json();
    }
    expect(estados.at(-1)).toBe(429);
    expect(estados.slice(0, -1).every((e) => e === 400)).toBe(true);
    expect(ultima.error).toBe('Llegaste al límite de consultas por hora. Intenta más tarde.');
  });

  test('la ficha responde 429 al pasar el límite', async ({ request }) => {
    let estado = 0;
    let cuerpo: any = null;
    for (let i = 0; i < 10 && estado !== 429; i++) {
      const r = await request.get('/api/ficha?lat=abc&lon=def');
      estado = r.status();
      cuerpo = await r.json();
    }
    expect(estado).toBe(429);
    expect(cuerpo.error).toBe('Llegaste al límite de fichas por hora. Intenta más tarde.');
  });

  test('en el chat, el límite se muestra como un aviso claro', async ({ page }) => {
    await abrir(page);
    await page.getByLabel('Tu consulta').fill('hola');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.burbuja-error').filter({ hasText: 'Llegaste al límite de consultas por hora' })).toBeVisible();
  });
});
