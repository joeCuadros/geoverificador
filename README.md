# GeoVerificador

Ficha de riesgos de un predio en Arequipa metropolitana, con datos públicos. Eliges un punto en el mapa y la aplicación muestra, por separado y con su fuente:

| Riesgo | Qué muestra | Fuente |
|---|---|---|
| Normativo | Zona, reglas de edificación y m² construibles según el tamaño del lote | Plano y Reglamento del PDM Arequipa 2016-2025 |
| De desastre | Peligros geológicos registrados cerca, aviso de zona de riesgo y zona sísmica del distrito | INGEMMET (GEOCATMIN), plano de zonificación, Norma E.030 y límites del INEI |
| De seguridad | Robos y hurtos denunciados cerca, y mapa de calor | MININTER / SIDPOL-PNP |
| De entorno | Servicios, transporte y áreas verdes cercanos | OpenStreetMap |

Con esos datos arma un **registro de riesgos**: identifica cada riesgo con su evidencia y fuente, propone trámites o normas oficiales para tratarlo, y deja que el usuario evalúe probabilidad e impacto y descargue el registro.

**No recomienda dónde comprar ni construir y no da un puntaje global**: no hay base para decidir cuánto pesa cada riesgo. Cada dato indica qué no cubre. No reemplaza el Certificado de Zonificación y Vías.

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

El frontend es JavaScript sin dependencias (Leaflet desde CDN). Zonificación, peligros y denuncias se resuelven con archivos locales de `public/data`; solo el entorno (OpenStreetMap) y la búsqueda de direcciones consultan servicios externos, y únicamente al pulsar los botones. Si un servidor público de Overpass está saturado, la aplicación reintenta automáticamente con los demás servidores de `CONFIG.overpassEndpoints` (hasta 4 intentos).

## Pruebas

```bash
pnpm run test        # unitarias
pnpm run test:e2e    # extremo a extremo (GET / y GET /api)
pnpm run lint
pnpm run build
```

## Datos y verificación

```bash
node scripts/descargar-peligros.mjs   # public/data/peligros_aqp.geojson
node scripts/descargar-delitos.mjs    # public/data/delitos_aqp.geojson
node scripts/descargar-distritos.mjs  # public/data/distritos_aqp.geojson (zona sísmica E.030)
pnpm run datos:verificar              # integridad de los datos y cálculos frente a un método independiente
```

`zonas_aqp.geojson` y `reglas_zonas.json` se elaboraron a partir del plano y del reglamento oficiales; el procedimiento está en la metodología.
