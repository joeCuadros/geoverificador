# GeoVerificador

Ficha de riesgos de un predio en Arequipa metropolitana, con datos públicos. Eliges un punto en el mapa y la aplicación muestra, por separado y con su fuente:

| Riesgo | Qué muestra | Fuente |
|---|---|---|
| Normativo | Zona, reglas de edificación y m² construibles según el tamaño del lote | Plano y Reglamento del PDM Arequipa 2016-2025 |
| De desastre | Peligros geológicos registrados cerca y aviso de zona de riesgo | INGEMMET (GEOCATMIN) y plano de zonificación |
| De seguridad | Robos y hurtos denunciados cerca, y mapa de calor | MININTER / SIDPOL-PNP |
| De entorno | Servicios, transporte y áreas verdes cercanos | OpenStreetMap |

**No recomienda dónde comprar ni construir y no da un puntaje global**: no hay base para decidir cuánto pesa cada riesgo. Cada dato indica qué no cubre. No reemplaza el Certificado de Zonificación y Vías.

## Documentación

- [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md): de dónde sale cada dato, cómo se transforma, por qué se decidió así y qué límites tiene.
- [`docs/VALIDACION.md`](docs/VALIDACION.md): qué está verificado, qué falta validar y el protocolo para hacerlo.

## Ejecutar

```bash
npm install
npm run start:dev      # http://localhost:3000 (Nest sirve el frontend estático de public/)
```

El frontend es JavaScript sin dependencias (Leaflet desde CDN). Zonificación, peligros y denuncias se resuelven con archivos locales de `public/data`; solo el entorno (OpenStreetMap) y la búsqueda de direcciones consultan servicios externos, y únicamente al pulsar los botones.

## Datos y verificación

```bash
node scripts/descargar-peligros.mjs   # public/data/peligros_aqp.geojson
node scripts/descargar-delitos.mjs    # public/data/delitos_aqp.geojson
npm run datos:verificar               # integridad de los datos y cálculos frente a un método independiente
```

`zonas_aqp.geojson` y `reglas_zonas.json` se elaboraron a partir del plano y del reglamento oficiales; el procedimiento está en la metodología.
