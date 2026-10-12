# GeoVerificador — Metodología y trazabilidad

> Cada dato que muestra la aplicación tiene aquí su origen, su transformación, la decisión que lo justifica y su límite.
> Lo que **no** se pudo comprobar está marcado como tal. Cifras consultadas el 2026-10-12.

## 1. Qué es y qué no es

**Pregunta que responde:** dado un punto en Arequipa metropolitana, *¿qué se puede construir ahí según la norma y qué riesgos documentados hay alrededor?*

**Qué es:** una ficha de riesgos de un predio hecha con datos públicos. Muestra cuatro tipos de riesgo por separado, cada uno con su fuente y sus límites.

**Qué no es:**

- No recomienda dónde comprar ni construir. La decisión es del usuario.
- No da un puntaje ni un semáforo global. No existe una base que justifique cuánto pesa cada riesgo frente a los demás, ni datos para comprobar que una ponderación acierte. Un puntaje con pesos inventados sería información inventada.
- No reemplaza el Certificado de Zonificación y Vías (el único documento con valor legal) ni un estudio de suelos o de riesgo.

**Marco:** gestión de riesgos aplicada a un predio. Los factores se agrupan por tipo de riesgo y se comunican uno a uno.

| Tipo de riesgo | Pregunta | Fuente | Sección |
|---|---|---|---|
| Normativo | ¿Puedo construir lo que quiero? | Plano y Reglamento del PDM Arequipa 2016-2025 | §3 |
| De desastre | ¿Hay peligros geológicos documentados cerca? | INGEMMET (GEOCATMIN) + zonas de riesgo del plano | §4 |
| De seguridad | ¿Cuántos robos y hurtos se denunciaron cerca? | MININTER / SIDPOL-PNP | §5 |
| De entorno | ¿Hay servicios, transporte y áreas verdes cerca? | OpenStreetMap | §6 |

## 2. Cómo se calcula «cerca»

- Distancia entre dos puntos: fórmula de **haversine** con radio medio terrestre de 6 371 008,8 m (`public/js/geo.js`).
- Radio de peligros y de denuncias: **500 m** (`CONFIG.peligros.radio`, `CONFIG.delitos.radio`). Es un valor de trabajo (unas cinco cuadras), no un umbral con base empírica; se puede cambiar en `public/js/config.js`.
- El código del navegador se contrasta con una fórmula independiente (ley esférica de los cosenos) en `scripts/verificar-datos.mjs`; ver `VALIDACION.md`.

## 3. Riesgo normativo: zonificación

**Fuente.** Plano de Zonificación del PDM Arequipa 2016-2025 (Ordenanza Municipal N.° 975-MPA, 2016) y su Reglamento (Cap. IV, Título III), publicados por la Municipalidad Provincial de Arequipa.

**Cómo se obtuvo (declarado por el equipo; el procedimiento no se puede reconstruir desde este repositorio):**

1. Los polígonos se extrajeron del PDF vectorial del plano con QGIS y se guardaron en `public/data/zonas_aqp.geojson` (793 polígonos, EPSG:4326).
2. El código de cada polígono (RDM-2, CZ, ZA…) se asignó por el **color de relleno**, usando la leyenda del plano.
3. Se verificó contando etiquetas del plano.
4. Las reglas de los 29 códigos (pisos, coeficiente, área libre, lote mínimo, frente mínimo, edificable) se transcribieron del Reglamento a `public/data/reglas_zonas.json`.

**Qué se calcula en la aplicación.**

- Zona del punto: punto-en-polígono (ray casting), con huecos y multipolígonos. Si dos polígonos se superponen, gana el último del archivo (el que el plano dibuja encima).
- Potencial constructivo (si el usuario escribe el área del lote):
  - m² techados = área del lote × coeficiente de edificación (base y máximo).
  - m² del primer piso = área del lote × (1 − área libre mínima).
- Solo se calcula en zonas con `edificable = "si"` y coeficiente numérico. En zonas condicionadas o no construibles no se calcula nada y se explica por qué. Las zonas industriales `I-1` e `I-2` son «si» pero no tienen coeficiente en la tabla, así que tampoco se calcula.

**Por qué así.** La tabla de reglas es normativa y tiene respuesta verificable (se puede comparar con un certificado). Por eso es el eje de la ficha. Se prefirió no calcular cuando la norma no fija un coeficiente, antes que suponer uno.

**Límites** (también visibles en la aplicación):

- Es el plano de 2016; no incluye planes específicos posteriores ni el plan metropolitano nuevo.
- El código se asignó por color: cerca del borde entre zonas puede no ser exacto. Hay colores que el plano comparte entre niveles distintos (`E`, `H`, y `ZA`).
- En zonas comerciales la altura depende del ancho de la vía; no se calcula un número fijo de pisos.
- Los m² son un máximo teórico: no consideran retiros, estacionamientos ni forma del lote.
- **No comprobado:** que cada polígono coincida con el plano oficial. El protocolo está en `VALIDACION.md` (§3.1) y sus resultados están **pendientes**.

## 4. Riesgo de desastre: peligros geológicos

**Fuente.** Capa «Peligro Geológico» de GEOCATMIN (INGEMMET), servicio
`https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/DGAR/SRV__PELIGRO__GEOLOGICO/MapServer/0` (35 932 registros en todo el país; 394 en Arequipa metropolitana).
Descarga: `node scripts/descargar-peligros.mjs` → `public/data/peligros_aqp.geojson` (descargado el 2026-10-12).

**Qué es el dato.** Un **inventario** de eventos documentados (caídas, flujos, deslizamientos, erosión, inundaciones…), un punto por evento o sector inspeccionado. **No** es un mapa de susceptibilidad ni de amenaza.

**Transformaciones.**

- Se consulta por la caja de Arequipa metropolitana (`CONFIG.viewbox`). El servicio no admite paginación y entrega hasta 2 000 registros; el script falla si llega a ese tope, para no guardar datos incompletos.
- Tipo y subtipo vienen codificados (`1000|1500|1504`). Se traducen con el **diccionario oficial publicado por la propia capa** (dominios `04_DC_TIPO_PELIGRO`, `04_DC_SUB_TIPO_PELIGRO`, `04_DC_FUENTE_INF_BIBLIOGRAFICA`); no hay traducciones propias.
- Códigos que el diccionario no define (`NOM_PELIGRO=1000|1300|1301`, `1000|1300|1302`, `245` y `TIP_PELIGRO=245`): **no se adivina su significado**. Quedan como «sin clasificar» y se listan en `metadata.codigosSinDefinir`. De los 394 registros, 1 no tiene tipo y 62 no tienen subtipo.
- No se guardan nombres de responsables ni datos de contacto.

**Qué se calcula.** Cantidad de registros a 500 m (por tipo) y distancia al registro más cercano (sin límite de radio). Un aviso adicional indica si el plano de zonificación ubica el punto en zona `ZRE-RI1` o `ZRE-RI2` (riesgo muy alto), dato que sale de la tabla de reglas (`grupo = "riesgo"`).

**Por qué así.** Es la única fuente pública de peligros con datos descargables que se encontró y verificó. Se muestra como inventario, sin transformarlo en un «nivel de peligro», porque el dato no lo permite.

**Límites** (visibles en la aplicación):

- Que no haya registros cerca **no significa que el lugar sea seguro**: solo que nadie documentó un evento ahí.
- Hay más registros donde se hicieron más inspecciones, no necesariamente donde hay más peligro (sesgo de muestreo). De los registros con fuente, 334 de 394 son «Información de campo».
- Años de registro: 2003 a 2023.
- Cada punto es un sector, no el alcance real del evento.
- **No cubre** peligro sísmico, volcánico (Misti), de suelos ni tsunami: no se incorporó ninguna capa pública utilizable de esos peligros. Esto es un hueco declarado de la ficha, no una conclusión de que no existan.

## 5. Riesgo de seguridad: robos y hurtos denunciados

**Fuente.** Mapa del Delito Georreferenciado (MININTER), datos del SIDPOL de la PNP, capa pública
`https://services6.arcgis.com/lMIZrqiJkpM748BR/arcgis/rest/services/SIDPOL_DELITOS_TOTAL/FeatureServer/1`.
Descarga: `node scripts/descargar-delitos.mjs` → `public/data/delitos_aqp.geojson` (descargado el 2026-10-12; datos de 2025-01-01 a 2026-07-31).

**Filtros y por qué** (cifras consultadas en la fuente el 2026-10-12):

| Filtro | Efecto | Por qué |
|---|---|---|
| `provincia_hecho = 'AREQUIPA'` | 237 198 denuncias | `id_prov_hecho` no sirve: trae el código del departamento. |
| `subtipo_hecho IN ('ROBO','HURTO')` | 16 780 | La capa mezcla faltas e intervenciones policiales; robo y hurto son los delitos que mejor reflejan inseguridad en la calle. |
| `ESTADO_COORD = 'INVERTIDA'` | **8 245** | Ver siguiente tabla. |

**Calidad de la coordenada** (campo `ESTADO_COORD`; el significado sale de los campos `REGLA` y `OBSERVACION` que publica la propia capa):

| Estado | Robo + hurto (provincia) | Qué dice la fuente | Uso |
|---|---|---|---|
| `INVERTIDA` | 8 245 (49,1 %) | Coordenada con latitud y longitud intercambiadas (originalmente «fuera de Perú»), corregida por inversión y «consistente con el UBIGEO informado». Fiabilidad 90. | **Se usa** |
| `CERO_AMBAS` | 7 617 (45,4 %) | La denuncia no traía coordenada; se «recuperó» con el *Punto Interior del Sector Principal* (17 de ellas, con el de otro sector). Fiabilidad 80 (70 en esas 17). | Se descarta: es el centro del sector policial, no el lugar del hecho |
| `UBIGEO_NO_COINCIDE` | 918 (5,5 %) | Coordenada válida en Perú, pero «no coincide con el UBIGEO informado». | Se descarta: dudosa |

(Para las 237 198 denuncias de todos los tipos: 194 877 `CERO_AMBAS` — 82 %, 37 362 `INVERTIDA`, 4 959 `UBIGEO_NO_COINCIDE`.)

**Cambio de cobertura en el tiempo (verificado).** El total mensual de robos y hurtos en la provincia es estable (entre 730 y 1 050), pero la proporción con ubicación real pasó de ≈ 20-30 % durante 2025 a ≈ 90 % desde enero de 2026 (diciembre de 2025: 49 %). El archivo guarda la tabla mensual en `metadata.cobertura`. Mezclar ambos periodos haría que el mapa refleje el cambio de captura de datos y no un cambio en el delito.

**Decisión: periodo.** El conteo usa solo el tramo reciente con cobertura homogénea: desde el último mes con datos se retrocede mientras la cobertura mensual sea ≥ 80 % (`CONFIG.delitos.coberturaMinima`), hasta 12 meses. Con los datos actuales: **enero a julio de 2026 (7 meses, 5 407 denuncias, 89 % de cobertura promedio)**. El 80 % es un umbral de trabajo; los meses con 91-87 % lo cumplen con holgura y el mes anterior (49 %) queda claramente fuera.

**Privacidad.** El archivo no guarda dirección, cuadra ni hora exacta (se comprueba en `verificar-datos.mjs`). Solo conserva id, fecha (día), turno, distrito, tipo, modalidad y coordenada con 5 decimales (~1 m). En la aplicación **nunca** se muestran denuncias individuales.

**Qué se calcula.**

- Conteo a 500 m, separado en robo y hurto, dentro del periodo elegido.
- **Mapa de calor** de la ciudad: cada denuncia se reparte con un núcleo gaussiano de σ = 200 m sobre celdas de 100 m, y el color usa la raíz cuadrada de la densidad respecto del máximo de la ciudad. El suavizado impide leer ubicaciones exactas; la raíz cuadrada evita que el centro, donde se concentran cientos de denuncias, sature todo el mapa. Los parámetros están en `CONFIG.delitos` y son de visualización, no estadísticos.

**Decisión descartada: percentil frente al resto de la ciudad.** Se probó comparar el punto con una cuadrícula de 500 m sobre las zonas construibles del plano. Se retiró porque (a) ataba el indicador a la zonificación, (b) la cuadrícula dependía de una elección arbitraria de qué es «la ciudad» y (c) un percentil se lee como una medida de riesgo que el dato no sostiene. El mapa de calor muestra la misma comparación sin etiquetar niveles.

**Límites** (visibles en la aplicación):

- Son **denuncias, no delitos**: muchos hechos no se denuncian y la costumbre de denunciar varía entre barrios.
- Solo se cuentan denuncias con ubicación: el conteo subestima, y dentro del periodo se pierde ≈ 10 % sin ubicación. No se sabe si esas se concentran en ciertos barrios.
- La coordenada «real» se validó contra el distrito, no contra la cuadra; su precisión exacta no se puede comprobar.
- Varias denuncias comparten exactamente la misma coordenada (hasta 56 en un punto): una dirección con mucha actividad pesa mucho.
- El color del mapa de calor es relativo (frente al máximo de la ciudad), no un nivel absoluto de riesgo.
- **No comprobado:** que el patrón espacial represente el delito real. Solo se puede decir que es coherente con lo esperado (concentración en el centro y en ejes comerciales); ver `VALIDACION.md` §3.3.

## 6. Entorno: servicios, transporte y áreas verdes

**Fuente.** OpenStreetMap, consultado en vivo con Overpass API (geocodificación con Nominatim). Las etiquetas que se consultan están en `CATEGORIES` (`public/js/config.js`) y la aplicación las lista en pantalla; la misma definición se usa para consultar y para clasificar.

**Qué se calcula.** Elementos dentro del radio elegido (500 m, 1 km o 1,5 km) y su distancia: exacta para puntos; 0 m si el punto está dentro de un área; hasta el borde más cercano para áreas; hasta el centro de la caja envolvente para relaciones (aproximado).

**Límites** (visibles en la aplicación): OSM es colaborativo, un elemento ausente puede existir; distancia en línea recta; el servicio público de Overpass puede limitar o caerse. Esta parte depende de internet y de un servicio de terceros, a diferencia de las otras tres, que usan archivos locales. El 2026-10-12 los dos servidores configurados no respondieron durante las pruebas (HTTP 504 y sin respuesta): la aplicación muestra ese error tal cual y no inventa resultados.

## 7. Trazabilidad: de dónde sale cada cifra de la pantalla

| Lo que se ve | Cómo se obtiene | Archivo / código |
|---|---|---|
| Código y nombre de la zona | Punto-en-polígono sobre el plano; nombre de la tabla de reglas | `zonas_aqp.geojson`, `reglas_zonas.json`, `zonificacion.js` |
| Pisos, coeficiente, área libre, lote y frente mínimos | Copiados de la tabla de reglas, sin cálculo | `reglas_zonas.json` |
| «Hasta N m² techados» | lote × coeficiente | `Zonificacion.potencial` |
| «El primer piso puede ocupar…» | lote × (1 − área libre) | `Zonificacion.potencial` |
| N peligros a 500 m y por tipo | Conteo con haversine; etiquetas del diccionario de la capa | `peligros.js`, `peligros_aqp.geojson` |
| «El más cercano está a X m» | Mínimo de haversine sobre los 394 registros | `peligros.js` |
| Aviso de zona de riesgo | Grupo `riesgo` de la regla de la zona | `reglas_zonas.json` |
| N denuncias a 500 m, robos y hurtos | Conteo con haversine sobre el periodo elegido | `delitos.js`, `delitos_aqp.geojson` |
| Periodo y cobertura | Regla de cobertura sobre `metadata.cobertura` | `Delitos.load`, `metadata.cobertura` |
| Mapa de calor | Densidad gaussiana (σ 200 m, celdas 100 m) | `Delitos.capa` |
| Elementos del entorno | Overpass en vivo | `services.js`, `geo.js` |
| Resumen del punto | Une las líneas anteriores sin puntaje | `app.js` (`renderResumen`) |

## 8. Cómo reproducir

```bash
npm install
node scripts/descargar-peligros.mjs   # public/data/peligros_aqp.geojson
node scripts/descargar-delitos.mjs    # public/data/delitos_aqp.geojson
node scripts/verificar-datos.mjs      # comprobaciones automáticas
npm run start:dev                     # http://localhost:3000
```

Las fuentes públicas cambian: al volver a descargar, las cifras de este documento pueden cambiar. La fecha de cada descarga queda en `metadata.descargado` de cada archivo.

## 9. Lo que la ficha no cubre (huecos declarados)

- Peligro sísmico, volcánico (Misti), de suelos y tsunami.
- Precio del suelo, rentabilidad o demanda: no se relaciona ningún factor con el valor de un predio. Eso exigiría datos de precios y es un trabajo aparte.
- Calidad de la construcción, servicios básicos (agua, desagüe, luz) y situación legal del predio (títulos, cargas).
- Planes urbanos posteriores a 2016.
