# GeoVerificador

Ficha de un predio en Arequipa metropolitana, con datos públicos. Eliges un punto en el mapa y la aplicación evalúa **5 variables**, por separado y con su fuente:

| Variable | Qué muestra | Umbral | Fuente |
|---|---|---|---|
| V1a Zonificación vigente | Zona, nombre, parámetros (pisos, coeficiente, área libre, lote), m² construibles según el lote y alerta si otra zona queda a 20 m o menos | 20 m (convención del proyecto) | Plano y Reglamento del PDM Arequipa 2016-2025 |
| V1b Zonificación proyectada | Solo un aviso de texto sobre el estado del PDM nuevo; aparece únicamente si `CONFIG.estadoPDM` tiene fuente y fecha. No hay mapa | — | Diario Correo (nota de prensa) |
| V2 Salud | Establecimiento de salud más cercano | 1000 m (convención del proyecto) | OpenStreetMap |
| V3 Educación | Colegio más cercano por nivel: inicial, primaria y secundaria | 500 / 1500 / 3000 m (MEF/MINEDU, Instructivo FTE, Cuadro N.° 1; RVM 104-2019 y 208-2019-MINEDU) | OpenStreetMap |
| V4 Transporte | Paradero más cercano | 400 m (convención del proyecto) | OpenStreetMap |
| V5 Área verde | Área verde de al menos 5000 m² a 300 m o menos (y, como sensibilidad, de al menos 1 ha) | 300 m / 5000 m² (OMS Europa, 2016) | OpenStreetMap |

Cada resultado es `{ estado: 'CUMPLE' | 'NO CUMPLE' | 'SIN DATO', nombre, distanciaM, umbralM, fuente, fecha, metodo }`. Las distancias son **en línea recta** (haversine, R = 6 371 008,8 m), no recorrido a pie. Los cálculos están en `public/js/calculos.js` (funciones puras con pruebas en `test/calculos.spec.ts`).

**No recomienda dónde comprar ni construir y no da un puntaje global**: no hay base para decidir cuánto pesa cada variable. Cada dato indica qué no cubre. No reemplaza el Certificado de Zonificación y Vías.

### Módulos fuera de alcance

Seguridad (denuncias), desastre (peligros geológicos), zona sísmica y registro de riesgos siguen en el código pero están ocultos (`CONFIG.modulos` en `public/js/config.js`). Se muestran de nuevo con `?modulos=todos` en la URL (por ejemplo `http://localhost:3000/?modulos=todos`).

## Documentación

- [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md): de dónde sale cada dato, cómo se transforma, por qué se decidió así y qué límites tiene.
- [`docs/VALIDACION.md`](docs/VALIDACION.md): qué está verificado, qué falta validar y el protocolo para hacerlo.

## Ejecutar

El proyecto usa **[pnpm](https://pnpm.io/) 11 o superior**. No uses `npm install`: no hay `package-lock.json`, y npm resolvería versiones distintas a las de `pnpm-lock.yaml`.

```bash
pnpm install
pnpm run start:dev     # http://localhost:3000 (Nest sirve el frontend estático de public/)
```

El puerto se cambia con la variable de entorno `PORT`.

`pnpm-workspace.yaml` guarda dos ajustes de pnpm:

- `allowBuilds`: los scripts de instalación de `@parcel/watcher` y `unrs-resolver` están desactivados a propósito (ambos traen binarios precompilados; esos scripts solo compilan desde el código fuente).
- `overrides`: parches de seguridad para dependencias transitivas de desarrollo.

El frontend es JavaScript sin dependencias (Leaflet desde CDN). Las cinco variables se resuelven con archivos locales de `public/data` (la zonificación y el equipamiento congelado de OpenStreetMap en `public/data/equipamiento`); solo la búsqueda de direcciones (Nominatim) consulta un servicio externo, al pulsar «Buscar». Si falta un archivo de equipamiento, la aplicación consulta Overpass en vivo como respaldo, con reintentos entre los servidores de `CONFIG.overpassEndpoints`.

## Pruebas

```bash
pnpm run test        # unitarias
pnpm run test:e2e    # extremo a extremo (GET / y GET /api)
pnpm run lint
pnpm run build
```

## Datos y verificación

```bash
pnpm run datos:extraer                # public/data/equipamiento/{salud,educacion,transporte,areas_verdes}.geojson (una consulta a Overpass)
node scripts/descargar-peligros.mjs   # public/data/peligros_aqp.geojson
node scripts/descargar-delitos.mjs    # public/data/delitos_aqp.geojson
node scripts/descargar-distritos.mjs  # public/data/distritos_aqp.geojson (zona sísmica E.030)
pnpm run datos:verificar              # integridad de los datos y cálculos frente a un método independiente
```

`zonas_aqp.geojson` y `reglas_zonas.json` se elaboraron a partir del plano y del reglamento oficiales; el procedimiento está en la metodología.
