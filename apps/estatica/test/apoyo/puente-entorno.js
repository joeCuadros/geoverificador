/**
 * puente-entorno.js — Solo para `pnpm test:dominio` (jest.dominio.config.ts).
 *
 * Varias pruebas entregan CONFIG, Services, Calculos y Rutas a las bibliotecas con `Object.assign(globalThis, { … })`, que era la forma de hacerlo
 * cuando se cargaban como scripts. El paquete de dominio no lee variables globales: las recibe con `configurar()`. Para correr esas pruebas sin
 * tocarlas, aquí cada asignación a una de esas globales se reenvía a `configurar()` del paquete.
 */
const NOMBRES = ['CONFIG', 'Services', 'Calculos', 'Rutas'];
const valores = {};

for (const nombre of NOMBRES) {
  Object.defineProperty(globalThis, nombre, {
    configurable: true,
    enumerable: true,
    get: () => valores[nombre],
    set: (v) => {
      valores[nombre] = v;
      require('../../../../packages/dominio/src/nucleo/entorno.js').configurar({ [nombre]: v });
    },
  });
}

// Si una prueba vacía el registro de módulos (jest.resetModules), el entorno nuevo recibe lo ya entregado.
globalThis.__reentregarEntorno = () => require('../../../../packages/dominio/src/nucleo/entorno.js').configurar(valores);
