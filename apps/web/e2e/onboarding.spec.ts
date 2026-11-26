/**
 * La guía de primera visita y el botón «Ayuda»: se abre sola la primera vez, se recorre con Siguiente y Atrás, se omite o se cierra con Esc, se recuerda en el navegador,
 * se reabre desde «Ayuda», funciona sin almacenamiento, atrapa el foco y cabe en un teléfono de 375 px sin tapar el control que explica.
 * Las demás pruebas no la ven: e2e/apoyo.ts deja marcada la guía como vista (aquí se apaga con `onboardingVisto: false`).
 */
import type { Page } from '@playwright/test';
import { CLAVE_VISTO, PASOS } from '../lib/onboarding.ts';
import { abrir, expect, test } from './apoyo.ts';

test.use({ onboardingVisto: false });

const dialogo = (page: Page) => page.getByRole('dialog');
const botonAyuda = (page: Page) => page.getByRole('button', { name: 'Ayuda' });
const siguiente = (page: Page) => dialogo(page).getByRole('button', { name: /^(Siguiente|Entendido)$/ });
const guardado = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), CLAVE_VISTO);
const resaltado = (page: Page) => page.locator('[data-onb-destacado]');
const estadoDelModelo = (page: Page, modelo: boolean) => page.route('**/api/agente/estado', (r) => r.fulfill({ json: { modelo } }));

async function irAlPaso(page: Page, id: string) {
  const destino = PASOS.findIndex((p) => p.id === id);
  for (let i = 0; i < destino; i++) await siguiente(page).click();
  await expect(dialogo(page).getByRole('heading', { level: 2 })).toHaveText(PASOS[destino].titulo);
}

test.describe('primera visita', () => {
  test('se abre sola como diálogo modal, con su título, el paso 1 y el foco en «Siguiente»', async ({ page }) => {
    await abrir(page);
    await expect(dialogo(page)).toBeVisible();
    await expect(dialogo(page)).toHaveAttribute('aria-modal', 'true');
    const titulo = dialogo(page).getByRole('heading', { level: 2 });
    await expect(titulo).toHaveText(PASOS[0].titulo);
    await expect(dialogo(page)).toHaveAccessibleName(PASOS[0].titulo);
    await expect(dialogo(page)).toContainText(`Paso 1 de ${PASOS.length}`);
    await expect(siguiente(page)).toBeFocused();
    // En el primer paso no hay «Atrás» y sí «Omitir guía».
    await expect(dialogo(page).getByRole('button', { name: 'Atrás' })).toHaveCount(0);
    await expect(dialogo(page).getByRole('button', { name: 'Omitir guía' })).toBeVisible();
    expect(await guardado(page)).toBeNull();
  });

  test('se recorre con Siguiente y Atrás: cada paso resalta su control, y solo la bienvenida lleva la nota ámbar de consulta referencial', async ({ page }) => {
    await estadoDelModelo(page, false);
    await abrir(page);
    for (let i = 0; i < PASOS.length; i++) {
      const paso = PASOS[i];
      await expect(dialogo(page).getByRole('heading', { level: 2 })).toHaveText(paso.titulo);
      await expect(dialogo(page)).toContainText(`Paso ${i + 1} de ${PASOS.length}`);
      await expect(resaltado(page)).toHaveCount(paso.objetivo ? 1 : 0);
      if (paso.objetivo) await expect(page.locator(paso.objetivo)).toHaveAttribute('data-onb-destacado', '');
      await expect(page.locator('.onb-aviso')).toHaveCount(paso.aviso ? 1 : 0);
      if (i < PASOS.length - 1) await siguiente(page).click();
    }
    // El último paso es el de privacidad y se termina con «Entendido»; no ofrece «Omitir».
    await expect(siguiente(page)).toHaveText('Entendido');
    await expect(dialogo(page).getByRole('button', { name: 'Omitir guía' })).toHaveCount(0);
    // «Atrás» vuelve un paso y quita el resalte del paso que se deja.
    await dialogo(page).getByRole('button', { name: 'Atrás' }).click();
    await expect(dialogo(page).getByRole('heading', { level: 2 })).toHaveText(PASOS[PASOS.length - 2].titulo);
    await expect(resaltado(page)).toHaveCount(1);
    await siguiente(page).click();
    await siguiente(page).click();
    await expect(dialogo(page)).toBeHidden();
    await expect(resaltado(page)).toHaveCount(0);
    expect(await guardado(page)).toBe('1');
    await expect(botonAyuda(page)).toBeFocused();
  });

  test('el paso de privacidad dice qué sale hacia Google y si el modelo está activo en este servidor', async ({ page }) => {
    await estadoDelModelo(page, true);
    await abrir(page);
    await irAlPaso(page, 'privacidad');
    const texto = dialogo(page);
    await expect(texto).toContainText('GEMINI_API_KEY');
    await expect(texto).toContainText('tu mensaje, lo que se entendió de tu búsqueda y un resumen de lo que devolvieron las herramientas, sin coordenadas');
    await expect(page.getByTestId('onboarding-modelo')).toContainText('el modelo de lenguaje (Gemini) está activo');
    await expect(page.getByTestId('onboarding-modelo').locator('svg')).toHaveCount(1);
  });

  test('con el modelo apagado en el servidor, lo dice sin prometer más', async ({ page }) => {
    await estadoDelModelo(page, false);
    await abrir(page);
    await irAlPaso(page, 'privacidad');
    await expect(page.getByTestId('onboarding-modelo')).toContainText('el modelo de lenguaje no está activo: tu mensaje no se envía a Google');
  });

  test('si el servidor no responde, el paso de privacidad se muestra igual, solo sin la línea del estado', async ({ page }) => {
    await page.route('**/api/agente/estado', (r) => r.abort());
    await abrir(page);
    await irAlPaso(page, 'privacidad');
    await expect(dialogo(page)).toContainText('GEMINI_API_KEY');
    await expect(page.getByTestId('onboarding-modelo')).toHaveCount(0);
  });
});

test.describe('cerrar y volver', () => {
  test('Esc la cierra, devuelve el foco a «Ayuda» y no vuelve a salir al recargar', async ({ page }) => {
    await abrir(page);
    await expect(dialogo(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogo(page)).toBeHidden();
    await expect(botonAyuda(page)).toBeFocused();
    expect(await guardado(page)).toBe('1');
    await page.reload();
    await expect(page.locator('.mapa[data-listo="si"]')).toBeVisible();
    await expect(botonAyuda(page)).toBeVisible();
    await expect(dialogo(page)).toHaveCount(0);
  });

  test('«Omitir guía» la cierra y la recuerda', async ({ page }) => {
    await abrir(page);
    await dialogo(page).getByRole('button', { name: 'Omitir guía' }).click();
    await expect(dialogo(page)).toBeHidden();
    expect(await guardado(page)).toBe('1');
  });

  test('«Ayuda» la reabre desde el paso 1, también cuando ya se vio, y el foco vuelve al botón al cerrar', async ({ page }) => {
    await abrir(page);
    await siguiente(page).click();
    await siguiente(page).click();
    await page.keyboard.press('Escape');
    await expect(dialogo(page)).toBeHidden();
    await botonAyuda(page).click();
    await expect(dialogo(page)).toBeVisible();
    await expect(dialogo(page).getByRole('heading', { level: 2 })).toHaveText(PASOS[0].titulo);
    await expect(botonAyuda(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await page.keyboard.press('Escape');
    await expect(botonAyuda(page)).toBeFocused();
  });

  test('el botón «Ayuda» mide al menos 44 px y está en la banda superior', async ({ page }) => {
    await abrir(page);
    await page.keyboard.press('Escape');
    const caja = (await botonAyuda(page).boundingBox())!;
    const banda = (await page.getByRole('banner').boundingBox())!;
    expect(caja.height).toBeGreaterThanOrEqual(43.5);
    expect(caja.y).toBeGreaterThanOrEqual(banda.y - 1);
    expect(caja.y + caja.height).toBeLessThanOrEqual(banda.y + banda.height + 1);
  });
});

test.describe('con la guía ya vista', () => {
  test.use({ onboardingVisto: true });

  test('no se abre sola y no bloquea la aplicación; «Ayuda» sigue disponible', async ({ page }) => {
    await abrir(page);
    await expect(dialogo(page)).toHaveCount(0);
    await expect(page.getByLabel('Tu consulta')).toBeEnabled();
    await expect(botonAyuda(page)).toBeVisible();
  });
});

test.describe('foco', () => {
  test('Tab y Mayús+Tab dan la vuelta dentro del cuadro, y el foco que se escapa vuelve', async ({ page }) => {
    await abrir(page);
    await siguiente(page).click(); // paso 2: «Omitir guía», «Atrás» y «Siguiente»
    const dentro = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    const nombre = () => page.evaluate(() => document.activeElement?.textContent?.trim());
    await expect(siguiente(page)).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await nombre()).toBe('Omitir guía');
    await page.keyboard.press('Shift+Tab');
    expect(await nombre()).toBe('Siguiente');
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      expect(await dentro()).toBe(true);
    }
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await dentro()).toBe(true);
    }
    // Aunque algo enfoque un control de la página, el foco regresa al cuadro.
    await page.evaluate(() => (document.querySelector('form[role="search"] input[name="q"]') as HTMLElement).focus());
    await expect(siguiente(page)).toBeFocused();
    // Un clic en el velo no la cierra por accidente.
    await page.mouse.click(5, 400);
    await expect(dialogo(page)).toBeVisible();
  });
});

test.describe('sin almacenamiento', () => {
  test('si el navegador no deja leer ni escribir, la guía se muestra, se cierra y la aplicación sigue entera', async ({ page }) => {
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('El almacenamiento está bloqueado', 'SecurityError');
        },
      });
    });
    await abrir(page);
    await expect(dialogo(page)).toBeVisible();
    await siguiente(page).click();
    await page.keyboard.press('Escape');
    await expect(dialogo(page)).toBeHidden();
    await expect(botonAyuda(page)).toBeFocused();
    await botonAyuda(page).click();
    await expect(dialogo(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Tu consulta')).toBeEnabled();
    expect(errores).toEqual([]);
  });
});

test.describe('presentación', () => {
  test('respeta prefers-reduced-motion: el cuadro no se anima', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await expect(dialogo(page)).toBeVisible();
    expect(await dialogo(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  test('con movimiento normal, el cuadro entra con una animación breve', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await abrir(page);
    expect(await dialogo(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('onb-entra');
  });

  test('usa la superficie y la tinta del tema, en claro y en oscuro, con radio de 18 px', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await abrir(page);
    const estilo = () => dialogo(page).evaluate((el) => ({ fondo: getComputedStyle(el).backgroundColor, radio: getComputedStyle(el).borderTopLeftRadius }));
    expect(await estilo()).toEqual({ fondo: 'rgb(255, 252, 247)', radio: '18px' });
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await estilo()).toEqual({ fondo: 'rgb(38, 32, 27)', radio: '18px' });
  });

  test('la nota de consulta referencial es el único elemento ámbar y lleva icono y texto', async ({ page }) => {
    await abrir(page);
    const aviso = page.locator('.onb-aviso');
    await expect(aviso).toContainText('Consulta referencial');
    await expect(aviso.locator('svg')).toHaveCount(1);
    expect(await aviso.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(247, 233, 198)');
    expect(await dialogo(page).locator('button').evaluateAll((bs) => bs.map((b) => getComputedStyle(b).backgroundColor))).not.toContain('rgb(247, 233, 198)');
  });
});

for (const tamano of [
  { nombre: 'teléfono de 375 px', ancho: 375, alto: 812 },
  { nombre: 'escritorio de 1280 px', ancho: 1280, alto: 800 },
]) {
  test.describe(`en un ${tamano.nombre}`, () => {
    test.use({ viewport: { width: tamano.ancho, height: tamano.alto } });

    test('cada paso cabe en la pantalla, sin desborde horizontal, con botones de 44 px y sin tapar el control que explica', async ({ page }) => {
      await abrir(page);
      for (let i = 0; i < PASOS.length; i++) {
        const paso = PASOS[i];
        await expect(dialogo(page).getByRole('heading', { level: 2 })).toHaveText(paso.titulo);
        const caja = (await dialogo(page).boundingBox())!;
        expect(caja.x, paso.id).toBeGreaterThanOrEqual(0);
        expect(caja.y, paso.id).toBeGreaterThanOrEqual(0);
        expect(caja.x + caja.width, paso.id).toBeLessThanOrEqual(tamano.ancho);
        expect(caja.y + caja.height, paso.id).toBeLessThanOrEqual(tamano.alto);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), paso.id).toBeLessThanOrEqual(tamano.ancho);
        for (const boton of await dialogo(page).getByRole('button').all()) expect((await boton.boundingBox())!.height, paso.id).toBeGreaterThanOrEqual(43.5);
        if (paso.objetivo) {
          const objetivo = (await resaltado(page).boundingBox())!;
          const separados = caja.y + caja.height <= objetivo.y || objetivo.y + objetivo.height <= caja.y || caja.x + caja.width <= objetivo.x || objetivo.x + objetivo.width <= caja.x;
          expect(separados, `el cuadro no tapa «${paso.id}»`).toBe(true);
          expect(objetivo.y, paso.id).toBeGreaterThanOrEqual(0);
          expect(objetivo.y + objetivo.height, paso.id).toBeLessThanOrEqual(tamano.alto);
        }
        if (i < PASOS.length - 1) await siguiente(page).click();
      }
    });
  });
}
