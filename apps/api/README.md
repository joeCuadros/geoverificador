# @geoverificador/api

**Capa:** aplicación (backend). Servidor NestJS: sirve el front estático de `../estatica/public` y expone `GET /api`, `/api/chat` y `/api/auth/*`.

**Puede depender de:** cualquier `packages/*`. **No** puede depender de otra aplicación (ver [ADR 0008](../../docs/adr/0008-monorepo-por-capas.md)); la excepción
conocida son los dos controladores que cargan `apps/estatica/api/_lib` (`EXCEPCIONES` en `arquitectura/capas.ts`).

```bash
pnpm start:dev      # desde la raíz: recarga automática en http://localhost:3000
pnpm build          # compila a apps/api/dist
pnpm test           # Jest (también corre desde la raíz)
pnpm test:e2e       # GET / y GET /api
```

Lee `.env.local` y `.env` de esta carpeta o de la raíz del repositorio (`GEMINI_API_KEY`, ver `.env.example`).
