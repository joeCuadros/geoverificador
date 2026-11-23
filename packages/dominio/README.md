# @geoverificador/dominio

**Capa 0 (la más baja): reglas puras.** Cálculos, viaje, sectores, asistente, avisos. Sin DOM, sin base de datos y sin red.

**Puede depender de:** ningún otro paquete del espacio de trabajo. Nadie por debajo, nada de `apps/*`. Lo hace cumplir `pnpm test:arquitectura`
([ADR 0008](../../docs/adr/0008-monorepo-por-capas.md)).

`src/nucleo/*.js` y `cjs/` se **generan** desde `apps/estatica/public/js` con `pnpm dominio:generar` (ver [ADR 0007](../../docs/adr/0007-paquete-de-dominio.md)).
