/**
 * R2 · ADR 0002: con AVISOS_PUBLICAR sin definir (la configuración por omisión), no se muestra ningún aviso de terceros.
 * Corre contra el servidor «sin publicar» (otro puerto, copia de la misma base con los mismos avisos guardados).
 */
import { abrir, CONSULTA_AVISOS, expect, preguntar, test } from './apoyo.ts';

test.describe('publicación de avisos desactivada', () => {
  test('la API no devuelve avisos y dice el motivo', async ({ request }) => {
    const r = await request.post('/api/agente', { data: { mensaje: CONSULTA_AVISOS } });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.avisos).toEqual([]);
    expect(j.tipo).toBe('vacio');
    expect(j.texto).toContain('La publicación de avisos de terceros no está activada (ADR 0002).');
    expect(j.texto).not.toContain('portal.example');
  });

  test('el chat dice el motivo y el mapa no dibuja ningún marcador', async ({ page }) => {
    await abrir(page);
    const r = await preguntar(page, CONSULTA_AVISOS);
    await expect(r).toContainText('La publicación de avisos de terceros no está activada');
    await expect(r.getByRole('link')).toHaveCount(0);
    await expect(page.locator('.avisos-mapa')).toHaveCount(0);
    await expect(page.locator('.marcador-aviso')).toHaveCount(0);
  });

  test('tampoco aparecen avisos al pedir otro tipo de inmueble', async ({ request }) => {
    const j = await (await request.post('/api/agente', { data: { mensaje: 'una casa en Cayma hasta 700 mil soles' } })).json();
    expect(j.tipo === 'vacio' || j.tipo === 'pregunta').toBe(true);
    expect(j.avisos).toEqual([]);
  });

  test('la ficha de un punto y el buscador de lugares siguen funcionando', async ({ page, request }) => {
    expect((await request.get('/api/ficha?lat=-16.39883&lon=-71.53697')).status()).toBe(200);
    await abrir(page);
    await page.getByRole('button', { name: 'Ver ficha del centro del mapa' }).click();
    await expect(page.getByTestId('ficha')).toBeVisible();
  });
});
