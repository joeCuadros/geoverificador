# 0001 · D1 · Cambiar los principios del producto

- **Estado:** propuesta. Decide el dueño del producto.
- **Fecha:** 2026-11-16
- **Origen:** `docs/plan-producto.html`, sección «Decisiones previas».

## Contexto

`PRODUCT.md` y `docs/METODOLOGIA.md` prohíben hoy: un puntaje global, nombrar «la mejor zona», ordenar por precio y mostrar avisos.
La visión del plan (un agente que responde «quiero un departamento cerca de mi trabajo… que no cueste más de medio millón» con una lista corta
de avisos reales) contradice las cuatro prohibiciones tal como están escritas.

## Opciones

1. **Mantener los principios.** El agente solo describe zonas y puntos. No hay lista de avisos: la visión no se cumple.
2. **Puntaje único ponderado.** Simple de ordenar, pero opaco: la persona no puede saber por qué un aviso quedó primero.
3. **Orden por criterios cumplidos, cada uno visible (propuesta del plan).** Se mantiene «sin puntaje opaco». Cada aviso muestra cuántos de los
   criterios pedidos cumple y, por cada criterio, el valor medido, el dato y su fecha. El precio es un criterio más (un tope), no el orden.

## Propuesta

Opción 3, con estas reglas, que son las que implementa `packages/dominio/src-ts/agente/orden.ts`:

- El orden es: más criterios cumplidos primero; a igualdad, menos criterios «sin dato»; a igualdad, aviso visto más recientemente.
  No hay pesos ni puntaje numérico.
- Un criterio sin dato **no cuenta como cumplido** y se muestra como «sin dato», no se oculta.
- No se usa la frase «la mejor zona» ni «el mejor aviso». Se dice «cumple 5 de 5 criterios».
- Cada aviso lleva fecha de última vez visto y enlace al original.

## Qué cambia si se acepta

- `PRODUCT.md` y `docs/METODOLOGIA.md`: reescribir los cuatro principios afectados. **No se ha hecho**: lo firma el dueño del producto.
- Las pruebas que hoy afirman «no hay puntaje global» siguen valiendo: el orden nuevo no lo introduce.

## Qué pasa si se rechaza

La herramienta `buscar_avisos` y las tarjetas de aviso quedan apagadas (`AVISOS_PUBLICOS` sin definir) y el agente responde solo con zonas y puntos.
