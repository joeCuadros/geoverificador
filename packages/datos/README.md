# @geoverificador/datos

**Capa 1: infraestructura.** PostgreSQL + PostGIS (o PGlite en local): migraciones, cargadores de `apps/estatica/public/data`, consultas espaciales, ingesta de avisos y CLI
(`pnpm bd:*`, `pnpm avisos:*`).

**Puede depender de:** solo `@geoverificador/dominio`. No de `agente` ni de `apps/*` ([ADR 0008](../../docs/adr/0008-monorepo-por-capas.md)).
