# GeoVerificador

Ficha de un predio en Arequipa metropolitana, con datos públicos. Se elige un punto en el mapa y la aplicación evalúa **5 variables**, cada una por separado y con su fuente:

| Variable | Qué muestra | Umbral | Fuente |
|---|---|---|---|
| V1a Zonificación vigente | Zona, nombre, parámetros (pisos, coeficiente, área libre, lote), m² construibles según el lote y alerta si otra zona queda a 20 m o menos | 20 m (convención del proyecto) | Plano y Reglamento del PDM Arequipa 2016-2025 |
| V1b Zonificación proyectada | Solo un aviso de texto sobre el estado del PDM nuevo; aparece únicamente si `CONFIG.estadoPDM` tiene fuente y fecha. No hay mapa | — | Diario Correo (nota de prensa) |
| V2 Salud | Establecimiento de salud más cercano | 1000 m (convención del proyecto) | OpenStreetMap |
| V3 Educación | Colegio más cercano por nivel: inicial, primaria y secundaria | 500 / 1500 / 3000 m (MINEDU, Cuadro N.° 1 del Instructivo FTE; RVM 104-2019 y 208-2019-MINEDU) | OpenStreetMap |
| V4 Transporte | Paradero más cercano | 400 m (convención del proyecto) | OpenStreetMap |
| V5 Área verde | Área verde de al menos 5000 m² a 300 m o menos (y, como sensibilidad, de al menos 1 ha) | 300 m / 5000 m² (OMS Europa, 2016) | OpenStreetMap |

Cada resultado tiene la forma `{ estado: 'CUMPLE' | 'NO CUMPLE' | 'SIN DATO', nombre, distanciaM, umbralM, fuente, fecha, metodo }`. Las distancias son **en línea recta** (haversine, R = 6 371 008,8 m), no recorrido a pie. Los cálculos están en `public/js/calculos.js`, como funciones puras con pruebas en `test/calculos.spec.ts`.

La aplicación **no recomienda** dónde comprar ni construir y **no da un puntaje global**: no hay base para decidir cuánto pesa cada variable. Cada dato indica qué no cubre.

### Módulos fuera de alcance

Seguridad (denuncias), desastre (peligros geológicos), zona sísmica y registro de riesgos siguen en el código, pero están ocultos (`CONFIG.modulos` en `public/js/config.js`). Para mostrarlos se usa el parámetro `?modulos=todos`, por ejemplo `http://localhost:3000/?modulos=todos`.

## Límites

- **Distancia en línea recta**, no recorrido real. Un colegio o paradero a 400 m en línea recta puede estar mucho más lejos por la red vial.
- **Referencial.** No reemplaza el Certificado de Zonificación y Vías ni el Certificado de Parámetros Urbanísticos y Edificatorios, que son los documentos con valor legal (los emite el IMPLA o la municipalidad distrital).
- **Vigencia del PDM incierta.** El PDM 2016-2025 llegó al fin de su vigencia de diez años, hay un PDM nuevo en trámite y hay una suspensión judicial de ciertos actos de ejecución. La zona mostrada puede no ser la que aplica hoy. Ver [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md), §3.
- **Equipamiento de OpenStreetMap.** Los datos dependen de lo mapeado por los colaboradores; pueden faltar o estar desactualizados establecimientos, colegios y paraderos.

## Documentación

- [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md): de dónde sale cada dato, cómo se transforma, por qué se decidió así y qué límites tiene.
- [`docs/VALIDACION.md`](docs/VALIDACION.md): qué está verificado, qué falta validar y el protocolo para hacerlo.
- [`docs/ENTREGA.md`](docs/ENTREGA.md): estado del proyecto, qué funciona y qué está pendiente.

## Requisitos

- Node.js 22 o superior.
- **[pnpm](https://pnpm.io/) 11 o superior.** No uses `npm install`: no hay `package-lock.json`, y npm resolvería versiones distintas a las de `pnpm-lock.yaml`.

## Ejecutar localmente

```bash
pnpm install
pnpm start             # compila y arranca en http://localhost:3000
```

- Para desarrollo con recarga automática: `pnpm start:dev`.
- Nest sirve el frontend estático de `public/` y expone `GET /api`.
- El puerto se cambia con la variable de entorno `PORT`.

`pnpm-workspace.yaml` guarda dos ajustes de pnpm:

- `allowBuilds`: los scripts de instalación de `@parcel/watcher` y `unrs-resolver` están desactivados a propósito (traen binarios precompilados; esos scripts solo compilan desde el código fuente).
- `overrides`: parches de seguridad para dependencias transitivas de desarrollo.

El frontend es JavaScript sin dependencias de compilación (Leaflet se carga desde CDN). Las cinco variables se resuelven con archivos locales de `public/data`: la zonificación y el equipamiento de OpenStreetMap ya congelado en `public/data/equipamiento`. Solo la búsqueda de direcciones (Nominatim) consulta un servicio externo, al pulsar «Buscar». Si falta un archivo de equipamiento, la aplicación consulta Overpass en vivo como respaldo, con reintentos entre los servidores de `CONFIG.overpassEndpoints`.

## Scripts

| Comando | Qué hace | Red |
|---|---|---|
| `pnpm start` | Compila y arranca el servidor | No |
| `pnpm start:dev` | Arranca con recarga automática | No |
| `pnpm build` | Compila TypeScript a `dist/` | No |
| `pnpm test` | Pruebas unitarias (Jest) | No |
| `pnpm test:e2e` | Pruebas extremo a extremo (`GET /` y `GET /api`) | No |
| `pnpm lint` | Análisis estático con oxlint (`src/` y `test/`) | No |
| `pnpm datos:verificar` | Integridad de los datos y cálculos frente a un método independiente | No |
| `pnpm datos:extraer` | Descarga el equipamiento de OpenStreetMap a `public/data/equipamiento` | Sí (Overpass) |
| `pnpm datos:validar-osm` | Contrasta la zonificación con lugares de OpenStreetMap (usa la referencia guardada en `docs/validacion/`) | No |
| `pnpm datos:validar-plano` | Contrasta la zonificación con el PDF oficial del plano (la ruta del PDF se pasa como argumento) | No |
| `node scripts/descargar-peligros.mjs` | Genera `public/data/peligros_aqp.geojson` | Sí |
| `node scripts/descargar-delitos.mjs` | Genera `public/data/delitos_aqp.geojson` | Sí |
| `node scripts/descargar-distritos.mjs` | Genera `public/data/distritos_aqp.geojson` (zona sísmica E.030) | Sí |

Los datos ya descargados están en el repositorio: solo es necesario regenerarlos si cambia la fuente.

## Integración continua y GitHub Pages

- `.github/workflows/ci.yml` se ejecuta en cada `push` y `pull_request`: instala con `pnpm install --frozen-lockfile`, y corre `lint`, `test`, `build` y `datos:verificar`. No usa red para las pruebas.
- `.github/workflows/pages.yml` publica `public/` en GitHub Pages con cada `push` a `main` (o manualmente). La versión en Pages es solo estática: no existe `GET /api` ni el servidor de Nest.

## Datos y licencias

- **OpenStreetMap.** Salud, educación, transporte, áreas verdes y mapa base: © colaboradores de OpenStreetMap, bajo [ODbL](https://opendatacommons.org/licenses/odbl/). La atribución figura en la aplicación.
- **Zonificación.** Plano de Zonificación y Reglamento del Plan de Desarrollo Metropolitano de Arequipa 2016-2025, aprobado por la Ordenanza Municipal N.° 961-MPA (del 3 de febrero de 2016), con la zonificación restituida por la Ordenanza N.° 975-MPA. Fuente: Municipalidad Provincial de Arequipa e IMPLA.
- **Norma E.030 y límites distritales.** Ver `public/js/config.js` y `docs/METODOLOGIA.md`.
- **Búsqueda de direcciones.** Nominatim (OpenStreetMap), sujeta a su política de uso (máximo 1 solicitud por segundo).

El código no tiene licencia de código abierto: `package.json` declara `UNLICENSED`.

## Pruebas

```bash
pnpm test              # unitarias
pnpm test:e2e          # extremo a extremo (GET / y GET /api, sin servidor externo)
pnpm lint
pnpm build
pnpm datos:verificar
```
