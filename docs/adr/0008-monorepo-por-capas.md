# 0008 · Monorepo por capas: aplicaciones arriba, paquetes debajo

- **Estado:** aceptada (decisión técnica, reversible).
- **Fecha:** 2026-11-23

> El número es 0008 y no 0003 porque `0003-presupuesto-mensual.md` ya existe.

## Contexto

La raíz del repositorio mezclaba tres aplicaciones y las herramientas de datos: el backend NestJS (`src/`, `test/`, `package.json` de la raíz), el front estático de siempre
(`public/`, las funciones de Vercel en `api/`, `vercel.json`), la aplicación Next.js (`web/`), los paquetes (`packages/*`) y los scripts de datos (`scripts/`). El
`package.json` de la raíz era el de la app Nest, así que cualquier dependencia de una pieza parecía de todas, y nada impedía que un paquete de bajo nivel importara
de una aplicación.

## Decisión

Un espacio de trabajo de pnpm (`pnpm-workspace.yaml`: `apps/*` y `packages/*`) con esta forma:

```
apps/api        @geoverificador/api        backend NestJS; sirve apps/estatica/public y /api
apps/web        @geoverificador/web        aplicación Next.js (con sus pruebas de Playwright)
apps/estatica   @geoverificador/estatica   front estático (public/), funciones de Vercel (api/) y vercel.json
packages/dominio   reglas puras                       (nivel 0)
packages/datos     infraestructura: PostGIS / PGlite  (nivel 1)
packages/agente    aplicación: diálogo, herramientas  (nivel 2)
tools/          descarga, conversión y recolección de datos (antes scripts/) y sus pruebas
data/           datos crudos locales de las herramientas (antes datos-crudos/, ignorada por git)
```

La raíz es un espacio de trabajo **privado** sin dependencias de aplicación: solo herramientas compartidas de desarrollo (Jest, Vitest, TypeScript, oxlint, Prettier) y
scripts que delegan con `pnpm --filter`. Los nombres de los comandos no cambian.

### Regla de dependencias

Las dependencias solo apuntan **hacia abajo**:

1. `apps/*` puede importar cualquier `packages/*`.
2. `packages/agente` puede importar `packages/datos` y `packages/dominio`.
3. `packages/datos` solo puede importar `packages/dominio`.
4. `packages/dominio` no importa ningún otro paquete del espacio de trabajo.
5. Ningún paquete importa de `apps/*`, y las aplicaciones no se importan entre sí.

La prueba `arquitectura/capas.test.ts` (`pnpm test:arquitectura`; también corre dentro de `pnpm test:nuevo`) la hace cumplir leyendo cada `package.json` (dependencias,
dev y peer) y todo el código fuente de cada espacio: nombres `@geoverificador/*` y rutas relativas que salen del espacio de trabajo. Un paquete nuevo sin nivel asignado
en la prueba falla hasta que se decida su capa.

### Deuda conocida

Dos imports rompen la regla 5 y están listados con su razón en `EXCEPCIONES` (`arquitectura/capas.ts`): `apps/api/src/chat.controller.ts` y
`apps/api/src/auth.controller.ts` cargan el núcleo CommonJS `apps/estatica/api/_lib/{gemini,auth}.js`, que comparten con las funciones de Vercel. La lista solo puede
encogerse: una excepción que ya no hace falta hace fallar la prueba. Se resuelve al retirar el front estático o al extraer ese núcleo a un paquete.

Otras dependencias son de archivos, no de código, y la prueba no las ve: `apps/api` sirve `apps/estatica/public/`, y `packages/datos` (CLI, pruebas) y `tools/` leen y escriben
los datos congelados en `apps/estatica/public/data/`. Esa carpeta es el contrato de archivos entre ellos; si el front estático se retira, los datos deberían pasar a una
carpeta propia.

## Consecuencia para Vercel

El sitio en producción se despliega desde la raíz del repositorio (`vercel.json` con `outputDirectory: public` y las funciones de `api/`). Esos archivos ahora están en
`apps/estatica/`, así que **el proyecto de Vercel debe configurarse con «Root Directory» = `apps/estatica`** (Settings → General; no se puede fijar desde el código).
Dentro de esa raíz el `vercel.json` no cambia: `outputDirectory`, `functions` e `includeFiles` (`public/js/...`, `api/_lib/auth.js`) siguen siendo relativos a la app. Hasta que
se cambie esa opción, un despliegue desde la rama fallará (no encontrará `public/`). GitHub Pages (`.github/workflows/pages.yml`) ya publica `apps/estatica/public`.

## Otros cambios que trae

- `packageManager` pasa de `pnpm@12.16.1` a `pnpm@11.9.0` (la versión verificada en la máquina de desarrollo; el `pnpm-lock.yaml` v9 es compatible). El CI deja de fijar la
  versión y usa la del `packageManager`.
- `apps/web/.env.local` (si existe) debe apuntar a la base con `DATABASE_URL=pglite://../../.pglite`: la ruta relativa cuenta desde la carpeta de la app.
- Jest corre las pruebas de siempre en tres proyectos (`apps/api`, `apps/estatica`, `tools`) con un solo comando; Vitest sigue para `packages/*`, `apps/web` y la regla de capas.
- `datos-crudos/` pasa a `data/` y las carpetas que el recolector de SmartBus se niega a escribir son ahora `apps/estatica/public`, `apps/estatica/api`, `apps/api/dist` y `dist`.

## Alternativas descartadas

- **Un solo paquete con carpetas** (como estaba): no hay forma de hacer cumplir la dirección de las dependencias ni de instalar solo lo de una app.
- **Mover `packages/*` dentro de las apps**: el dominio y los datos los usan varias aplicaciones.
- **Reglas de lint en lugar de una prueba**: oxlint no tiene una regla de límites entre paquetes; la prueba también revisa los `package.json`.
