# Fuentes abiertas y sistemas del Estado que podrían sumarse

Sondeo del 2026-11-03. Complementa `02-DATOS.md` (lo que ya existe) y no lo reemplaza. **Nada de esto está en la aplicación**: son candidatos para variables nuevas, y el diseño debe tratarlos como tales.

## Cómo leer este documento

- **Verificado** significa que se consultó el servicio en vivo (HTTP 200, capas listadas o una consulta de prueba). **No verificado** significa que no se pudo comprobar; no se debe prometer.
- Casi ninguna fuente declara una licencia. Salvo los CSV de datos abiertos (ODC-BY) y las Contrataciones Abiertas (CC BY 4.0), hay que **confirmar los términos de uso antes de publicar**.
- «CORS: no» significa que el navegador no puede llamar al servicio directamente. La solución es **precalcular** y servir un archivo propio, no consultar en vivo.
- Las fechas son las que se vieron; muchas capas no indican su actualización.

## Correcciones a lo dicho antes

| Antes se dijo | Lo que se encontró |
|---|---|
| «Las denuncias están reservadas» y «la seguridad no tiene fuente» | El MININTER publica **denuncias georreferenciadas** (9,4 millones de registros con tipo, modalidad, fecha y comisaría) en un servicio ArcGIS consultable por radio, con corte al 2025-06-30. Sigue siendo **denuncia, no incidencia real**. |
| «Precios solo existen para Lima» | El Fondo MiVivienda publica el **valor de la vivienda financiada por distrito (UBIGEO)**. Cubre solo vivienda con crédito y las muestras por distrito son pequeñas (de 7 a 209). |
| «El PDM 2016-2025 está vigente» | Una nota de prensa (El Búho, 2025-12-23) lo describe como **suspendido por una medida cautelar**; no se halló la resolución. El PDM nuevo no estaba aprobado a septiembre de 2026. Es una sola fuente: tratarlo como **aviso**, no como hecho. |

## Candidatas con mejor relación valor y viabilidad

| # | Variable | Sistema | Acceso | Granularidad | CORS | Verificado | Cómo entraría |
|---|---|---|---|---|---|---|---|
| 1 | Denuncias cerca del punto | MININTER, capa `ogc/denuncias` | ArcGIS REST con consulta por radio | punto, corte 2025-06-30 | sí | **sí** (radio de 500 m en Plaza de Armas devolvió conteos por tipo) | **Informativo**, nunca puntaje. Filtrar `estado_coord = CON COORDENADA`. Mostrar «denuncias, no delitos» |
| 2 | Comisaría asignada, jurisdicción, Barrio Seguro | MININTER (PNP) | ArcGIS REST | punto y polígono (41 comisarías, 126 polígonos Barrio Seguro) | sí | **sí** | Dato de contexto por punto |
| 3 | Peligro volcánico del Misti | INGEMMET `SERV_VOLCANES` capa 17 (y mapas 2025, boletín C-100) | ArcGIS REST; PDF y paquetes `.mpk` | polígono (alto, moderado, bajo) | no | **sí** (consulta puntual) | **Informativo** con su límite de escala |
| 4 | Tipo de suelo sísmico S1 a S4 y capacidad portante | IGP, capas `zon_arequipa` y `cap_por_arequipa` | WMS y WFS | polígono urbano, año 2014 | no | **sí** («Suelo Tipo S1: Rígido») | **Informativo**. Solo la ciudad. La capacidad portante trae un solo polígono: sin utilidad |
| 5 | Valor de vivienda financiada | Fondo MiVivienda (datos abiertos, ODC-BY) | CSV, corte 2025-01-08 | distrito | n/a | **sí** (medianas de ejemplo: Yanahuara 306 mil, Cerro Colorado 285 mil, Yura 145 mil soles) | **Contexto de presupuesto**, con tamaño de muestra y la nota «solo vivienda financiada» |
| 6 | Grifos y plantas de GLP | OSINERGMIN | ArcGIS REST (217 en la provincia) | punto | sí | **sí** | Molestia o riesgo cercano; informativo |
| 7 | Emergencias pasadas (huaico, inundación, incendio urbano) | INDECI SINPAD | ArcGIS REST (202 232 puntos, hasta 2024) | punto | sí | **sí** | Complementa quebradas; informativo |
| 8 | Riesgo por distrito (inundación, movimientos en masa) | CENEPRED SIGRID | ArcGIS REST | distrito con `ubigeo`; ráster nacional | sí | **sí** | Ver sección siguiente |

## SIGRID (CENEPRED), verificado

- Hay un ArcGIS Server público en `sigrid.cenepred.gob.pe/arcgis/rest/services`, con CORS abierto.
- El servicio `FEN/ER_NINO2027_BD/MapServer` pertenece al proyecto El Niño 2027: **puede cambiar o caerse**.
- Capas 1 y 2 (susceptibilidad a inundaciones y a movimientos en masa): **ráster** de cinco niveles, solo exportable como imagen. Sirven como capa de contexto, **no** para decir «este predio está en riesgo alto».
- Capas 4 y 5 (riesgo a inundación y a movimientos en masa): polígonos **por distrito** con `ubigeo`, población y viviendas. La consulta de la provincia de Arequipa devolvió 29 distritos.
- No verificado: licencia, escala, fecha de las capas y peligro sísmico.

## Censo 2017 por manzana (INEI), baja viabilidad

- El nivel más fino existe (manzana urbana), pero solo se consulta en REDATAM y se exporta a Excel o PDF. **No hay API ni descarga masiva** de atributos.
- El WFS de manzanas del INEI (`geoespacial.inei.gob.pe`, CENEC 2022) entrega **solo geometría y códigos**, sin variables demográficas, y devuelve 403 con `Origin`.
- Lo realista: indicadores **por distrito**, o pedir al INEI la cartografía con atributos. No prometer manzana en el diseño.

## Otras fuentes verificadas o parciales

| Variable | Sistema | Estado |
|---|---|---|
| Falla neotectónica, susceptibilidad a movimientos en masa e inundación fluvial | INGEMMET | Capas listadas; solo se probó movimientos en masa. Sin CORS |
| Eventos geodinámicos de la ciudad (flujo de detritos, inundación, derrumbes) | IGP, 12 polígonos | Verificado; escala gruesa |
| Mapas de peligros del Misti 2025 | INGEMMET (OVI) | Descargables (PDF y `.mpk`); convertirlos es trabajo extra |
| Cortes de agua programados | SEDAPAR vía gob.pe | Solo HTML; sin API ni histórico estructurado. Habría que extraerlo periódicamente a un archivo estático |
| Área de prestación y emergencia hídrica | SUNASS | Área de servicio verificada (ArcGIS); CSV de distritos en emergencia (ODC-BY, 2026-09) |
| Bonos Techo Propio por distrito | MVCS y Fondo MiVivienda | CSV de 17 MB, corte 2026-09-30; solo se leyó la cabecera |
| Sitios arqueológicos (87 polígonos en el cuadro de Arequipa) | Ministerio de Cultura (WFS) | Parcial: la semántica de la capa no está confirmada. Sin CORS |
| Áreas naturales protegidas y zonas de amortiguamiento | SERNANP | Capas listadas |
| Red vial, puentes, peajes y terminales | MTC | Parcial (`GetCapabilities`); no se consultó Arequipa |
| Precipitación, heladas y peligro por lluvia | SENAMHI IDESEP (WMS, 1 214 capas ráster) | Parcial: `GetCapabilities` solo |
| Estaciones de calidad del aire (43, solo ubicación) | OEFA | Verificado; no trae mediciones |
| Obras y compras por entidad | OECE Contrataciones Abiertas (OCDS, CC BY 4.0) | Verificado; sin coordenadas |
| Inversión pública | MEF Invierte.pe | Parcial: la API existe, no se halló el conjunto de inversiones |
| PDM 2016-2025 (Ordenanza 961) | IMPLA | Verificado: archivo comprimido de 3 MB en un directorio abierto |

## Lo que no se pudo verificar

- **Municipalidad Provincial de Arequipa** (catastro, licencias, ruido, parques, serenazgo, transporte): el sitio responde 403. No se reintentó con trucos.
- **Sin DNS o sin conexión:** Gobierno Regional (geoportal, ZEE), `geoserver` y OVI de INGEMMET, SEAL (503), `sedapar.com.pe`, GeoMINEDU, GEOLLAQTA, SBN, Infomidis, CALTUR, GeoINDECI.
- **GEOPERU** (`espacialg.geoperu.gob.pe`): bloqueado por Cloudflare. El catálogo lista ~1 245 capas, entre ellas predios del Estado, mercados, parques y cobertura de desagüe. **Sin verificar.**
- **COFOPRI y SUNARP:** los servicios del catálogo dan 404; SUNARP solo publica oficinas registrales.
- **Infobras:** solo visor. **Techo Propio y MiVivienda:** sin dato verificado del precio tope vigente.
- **Transporte:** no hay GTFS, geoportal ni paraderos oficiales. **Gas natural:** la concesión del sur está en transición (solo prensa).
- **Sin revisar por falta de tiempo:** bomberos, MIMP (ubicación de los Centros Emergencia Mujer), Poder Judicial, observatorio del Ministerio Público, ruido, ENAHO, RENAMU, SUSALUD y zonas monumentales.
- **Calidad educativa, calidad del aire con mediciones, ruido y tiempos en bus:** sin fuente abierta hallada.

## Reglas de diseño que se desprenden

1. **Privacidad.** Consultar un servicio del Estado en vivo con el punto del usuario **envía sus coordenadas a un tercero**. Contradice el principio «las coordenadas no salen del dispositivo». Precalcular una grilla y servirla como archivo estático.
2. **Seguridad y precios entran como contexto, no como criterio.** Con su límite escrito: «denuncias, no delitos; hasta junio de 2025» y «solo vivienda financiada; n = tamaño de muestra del distrito».
3. **Nada de puntaje global.** Ninguna de estas fuentes autoriza un «índice de calidad de zona».
4. **Cada capa muestra fuente, fecha y escala.** Los ráster de SIGRID y la capa IGP de 2014 lo necesitan más que ninguna.
5. **El aviso del PDM sube de nivel.** La zonificación es referencial y puede no estar vigente; la herramienta debe decirlo sin alarmismo y sin dar por segura la capa.
6. **El asistente sigue sin inventar.** Mientras una fuente no esté incorporada, el chat dice «no tengo ese dato» aunque exista en el Estado; que exista en el mundo no la vuelve dato del producto.
