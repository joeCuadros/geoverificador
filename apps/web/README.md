# @geoverificador/web

**Capa:** aplicación (Next.js). Chat, mapa y ficha de un punto sobre la base de `packages/datos`; sus pruebas de extremo a extremo (Playwright) están en `e2e/`.

**Puede depender de:** cualquier `packages/*` (hoy `agente`, `datos` y `dominio`). No importa de otra aplicación.

```bash
pnpm dev:web        # desde la raíz
pnpm web:build
pnpm web:e2e        # Playwright con el Chrome instalado
```

La base local se indica con `DATABASE_URL`; un `.env.local` de esta carpeta que use PGlite en la raíz del repositorio es `pglite://../../.pglite`.
