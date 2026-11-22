# 0007 · Paquete de dominio generado mientras dure la migración

- **Estado:** aceptada (decisión técnica, reversible).
- **Fecha:** 2026-11-16

## Contexto

La tarea 5.2 pide mover las bibliotecas puras de `public/js` a un paquete con módulos ES y tipos, sin variables globales ni la carga doble
`typeof X !== 'undefined' ? X : require()`, y que las pruebas sigan pasando **sin cambiar lo que afirman**. A la vez, el plan exige que la aplicación
actual (`public/index.html`, que carga esas bibliotecas como `<script>` con globales) siga publicada hasta que la nueva la iguale (tarea 5.8).

Las dos cosas no caben en un solo archivo: un módulo ES no se puede cargar como script clásico.

## Decisión

Mientras convivan las dos aplicaciones:

- `public/js/*.js` sigue siendo la fuente que edita el equipo (la aplicación vieja está congelada: solo correcciones).
- `pnpm dominio:generar` (`scripts/generar-dominio.mjs`) produce `packages/dominio/src/*.js`: los mismos archivos como módulos ES, con `import` en
  lugar de la carga doble y `export default` en lugar de la variable global. `tsc` genera los tipos (`packages/dominio/tipos/`).
- `pnpm dominio:verificar` falla en CI si el paquete no coincide con lo que se generaría: no puede haber deriva.
- `pnpm test:dominio` corre **las mismas pruebas, sin tocarlas**, contra el paquete: `jest.dominio.config.ts` redirige cada
  `require('../public/js/x.js')` al módulo ES equivalente.
- El código nuevo (herramientas del agente, consultas a la base, avisos) se escribe directamente en TypeScript en `packages/dominio/src-ts/`.

## Al terminar la migración (tarea 5.8)

Se borra `public/js`, `packages/dominio/src` pasa a ser la fuente, se borra el generador y las pruebas importan del paquete.
