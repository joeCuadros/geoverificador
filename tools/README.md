# tools

Herramientas de datos (antes `scripts/`): descarga, conversión y recolección (`pnpm datos:*`), `verificar-datos.mjs`, `generar-dominio.mjs`, y las bibliotecas que
usan en `lib/` con sus pruebas Jest en `test/`. No es un paquete del espacio de trabajo ni parte de las capas: es código de línea de comandos que lee y escribe
`apps/estatica/public/data` y deja los datos crudos locales en `data/` (ignorada por git).
