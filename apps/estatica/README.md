# @geoverificador/estatica

**Capa:** aplicación (front de siempre). HTML y JavaScript sin compilar en `public/` (con los datos congelados en `public/data/`), más las funciones serverless de
Vercel en `api/` y su `vercel.json`. Sus pruebas Jest están en `test/`.

**Puede depender de:** cualquier `packages/*`. No importa de otra aplicación. `public/js` es la fuente de la que `tools/generar-dominio.mjs` genera `packages/dominio`.

**Despliegue:** en Vercel, «Root Directory» = `apps/estatica` (ver [ADR 0008](../../docs/adr/0008-monorepo-por-capas.md)). En local lo sirve `apps/api`
(`pnpm dev:estatica` es un atajo de `pnpm dev:api`).
