# 0002 · D2 · Base legal para mostrar avisos de terceros

- **Estado:** propuesta. Decide el dueño del producto **con revisión de un abogado**.
- **Fecha:** 2026-11-16

## Contexto

Lo que recoge `pnpm datos:avisos` está marcado «no se publican ni se redistribuyen» (`tools/lib/avisos/salida.js`) y se guarda en
`data/`, fuera de git. Facebook prohíbe el acceso automatizado en su `robots.txt`. Nexo permite el rastreo. Urbania y Adondevivir se leen
por Apify. Ningún portal ha dado permiso por escrito para mostrar sus avisos en otro producto.

## Opciones

1. **Datos mínimos más enlace al original.** Mostrar solo tipo, precio, área, dormitorios, distrito y zona, con enlace al aviso. Sin fotos, sin
   descripción, sin datos del vendedor. Reduce el riesgo, no lo elimina: sigue siendo reutilización de una base de datos ajena.
2. **Acuerdos con portales o inmobiliarias.** Permiso por escrito o un feed. Es la vía sólida; depende de terceros.
3. **Carga propia.** Agentes o propietarios cargan sus avisos en GeoVerificador. Sin riesgo de terceros; empieza con cero avisos.

## Propuesta

Empezar por la opción 1 **solo con Nexo** (su `robots.txt` permite el rastreo) mientras se tramita la opción 2, y dejar preparada la opción 3.
Nada se publica hasta que un abogado revise los términos de uso de cada portal.

## Cómo queda reflejado en el código

- La tabla `aviso` guarda solo campos del inmueble (los del esquema de `tools/lib/avisos/esquema.js`): no hay vendedor, teléfono, correo, fotos ni
  descripción.
- Cada `fuente` de avisos tiene `permite_publicar` (falso por defecto). `buscar_avisos` solo devuelve avisos de fuentes con `permite_publicar = true`
  cuando `AVISOS_PUBLICOS=1`; en otro caso devuelve cero avisos y el motivo. En desarrollo local se activa con `AVISOS_PUBLICOS=todas`.
- Toda tarjeta de aviso lleva el enlace al original y la fecha de última vez visto.

## Pendiente de una persona

- Revisión legal de los términos de uso de Nexo, Urbania y Adondevivir.
- Pedir permiso por escrito a cada portal (o un acuerdo de datos).
- Activar `permite_publicar` fuente por fuente cuando haya respaldo.
