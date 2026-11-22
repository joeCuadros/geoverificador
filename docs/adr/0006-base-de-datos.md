# 0006 · PostgreSQL + PostGIS y la rama `feature/base-de-datos` (MySQL)

- **Estado:** propuesta. Decide el equipo.
- **Fecha:** 2026-11-16

## Contexto

El plan (`docs/plan-producto.html`, fase 2) pide PostgreSQL con PostGIS de un proveedor del Marketplace de Vercel y afirma «no hay base de datos».
Sin embargo, la rama `origin/feature/base-de-datos` (octubre de 2026, sin integrar a `main`) ya tiene unas 4.100 líneas sobre **MySQL**:
migraciones espaciales, un importador, una cuadrícula precalculada, una API de búsqueda de zonas en NestJS y un modo de búsqueda guiada.
Esa rama parte de un `main` 135 commits más antiguo y el plan no la menciona.

## Opciones

1. **PostgreSQL + PostGIS (lo que dice el plan).** Tipos `geography`, índices GiST, `ST_DWithin`, `ST_AsMVT` para teselas y pgRouting para la red
   peatonal (tarea 4.2). Lo ofrecen los proveedores del Marketplace de Vercel.
2. **MySQL (lo que hay en la rama).** Aprovecha el trabajo hecho, pero MySQL no tiene equivalente a `ST_AsMVT` ni a pgRouting, sus índices
   espaciales exigen SRID fijo por columna y la API de esa rama vive en NestJS, que el plan retira (tarea 5.8).

## Propuesta

Opción 1. De la rama MySQL se **reutiliza la idea, no el código**:

- La cuadrícula precalculada con métricas por celda es la base de `buscar_zonas`; aquí se sirve con la búsqueda por cuadrícula del núcleo de dominio
  (`asistente.js`), que es la que ya tiene pruebas.
- El modo de búsqueda guiada es un antecedente del chat del agente (fase 6.8).

La rama **no se ha integrado ni borrado**. Queda en el remoto tal como está.

## Pendiente de una persona

- Confirmar con quien escribió la rama (sharonconpan) que se sigue con PostGIS.
- Crear la base de producción en el Marketplace de Vercel (tarea 2.1) y escribir `DATABASE_URL` en cada entorno.
