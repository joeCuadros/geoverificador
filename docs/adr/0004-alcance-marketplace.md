# 0004 · D4 · Alcance de Marketplace

- **Estado:** propuesta. Decide el dueño del producto.
- **Fecha:** 2026-11-16

## Contexto

Marketplace es la fuente más cara de mantener y la de mayor riesgo legal (Facebook prohíbe el acceso automatizado en su `robots.txt`). La prueba del
14 de noviembre de 2026 con `apify/facebook-marketplace-scraper` devolvió 10 artículos de Florida.

El 15 de noviembre (commit `79d4e22`) el mapeo se corrigió: lee el precio de `listing_price.amount_with_offset_in_currency` y descarta lo que está
fuera de Arequipa o no es un inmueble. Eso evita que entren datos malos, pero no resuelve que el actor ignore la ubicación ni el riesgo legal.

## Propuesta

Dejar Marketplace **fuera de la primera versión**.

## Cómo queda reflejado en el código

- `marketplace` no está en `FUENTES_POR_DEFECTO` (`scripts/lib/avisos/cli.js`): solo corre si alguien lo pide con `--fuente marketplace`.
- La corrida programada (`.github/workflows/avisos.yml`) no lo incluye.
- La fuente `marketplace` se crea en la base con `permite_publicar = false`.

## Si se aprueba incluirlo más adelante (tarea 3.9)

1. Conseguir una URL o un parámetro del actor que fije Arequipa y comprobarlo con una corrida de 10 registros.
2. Mantener los dos filtros que ya existen (inmueble y Arequipa) y medir cuántos registros descartan.
3. Resolver antes D2 para esta fuente en particular.
