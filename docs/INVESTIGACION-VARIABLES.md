# GeoVerificador — Investigación de variables, fuentes del Estado y diseño de decisión

> **Estado de integración (2026-11-03).** Ya integrados en la herramienta: **el escenario de riesgo del CENEPRED ante El Niño, solo a escala de distrito** (inundación y movimientos en masa; METODOLOGIA §12.8: sí el nivel de riesgo y tres conteos confirmados; no la susceptibilidad por ráster, no el riesgo del predio, no los campos sin significado confirmado), **N1** (cauces de la ANA, el IGP y OpenStreetMap, con la fuente de cada tramo; METODOLOGIA §12.1), **N4** (peligro volcánico del Misti con las zonas del IGP, informativo; §12.6) y, como contexto, **N9 en su versión reciente** (sismos de 2026; §12.3). El peligro sísmico por punto del IGP (`PeligroSismico`, `AceleracionGRD`) se revisó y **no** se integró por falta de metadatos (§12.7). La validación de OSM frente a RENIPRESS y ESCALE (§5.1) tiene su script (`pnpm datos:validar-oficial`) y espera los archivos oficiales descargados a mano (`docs/VALIDACION.md` §3.4).
>
> Fecha de la investigación: 2026-11-02. Alcance: validar y criticar las variables V1a–V5 ya implementadas, proponer variables nuevas, inventariar sistemas del Estado peruano no usados y recomendar el diseño de apoyo a la decisión.
>
> **Reglas de honestidad de este documento.**
> - Cada afirmación lleva un número entre corchetes que remite a la sección *Referencias*. La marca **(extracto)** indica que solo se vio el resumen o un extracto de búsqueda, no el texto completo. La marca **(verificado el 2026-11-02)** indica que el autor hizo la petición HTTP y recibió la respuesta descrita.
> - Donde ninguna norma ni estudio da un umbral se escribe **«sin umbral normativo»** y el umbral se propone solo como **parámetro del usuario**. No se inventan umbrales ni pesos.
> - Las pruebas de CORS se hicieron con `curl` enviando `Origin: https://geoverificador.vercel.app` (origen de ejemplo; hay que repetirlas con el dominio real de despliegue) desde una red fuera del Perú. Un servidor puede responder distinto a otras redes u orígenes.

## 1. Resumen ejecutivo

1. **La decisión del equipo de no usar puntaje global está respaldada por la literatura.** El Manual OECD/JRC dice que los pesos «son esencialmente juicios de valor», que «ponderar igual no significa no ponderar» y que la agregación lineal permite que un déficit se «compense» con un superávit [10]. Malczewski advierte que la combinación lineal ponderada se aplica «sin comprender del todo sus supuestos» [9]. Lo coherente con esa decisión es: tabla de indicadores sin total, filtros de mínimos fijados por el usuario, comparación de 2–3 puntos con detección de dominancia, y pesos solo si el usuario los pide, con prueba de sensibilidad (sección 6).
2. **Lo que más pesa en una compra no es lo que la app calcula hoy.** En Perú la evidencia más fuerte es la **seguridad jurídica del predio** (título inscrito, cargas y gravámenes, saneamiento físico-legal) [27][28][29][30]. Eso no es una capa espacial: la app debe ofrecerlo como **lista de verificación con enlaces profundos** a SUNARP, no como dato calculado (sección 3, tabla B).
3. **La mayor carencia espacial es el peligro por quebradas, huaicos, inundación y volcán.** La app solo tiene peligros geológicos puntuales, zona sísmica E.030 y registro de riesgos, todos ocultos. Existen fuentes estatales consultables (INGEMMET, CENEPRED, ANA, IGP) y la evidencia de precios muestra que el peligro de inundación se capitaliza (descuento medio de −4,6 % en llanura de inundación interior a 100 años) [18], pero **no se encontró ningún estudio hedónico peruano**.
4. **Hallazgo crítico sobre el código existente.** El servicio que usa `scripts/descargar-peligros.mjs` (`.../arcgis/rest/services/DGAR/SRV__PELIGRO__GEOLOGICO/MapServer/0`) responde hoy **HTTP 200 con `{"error":{"code":499,"message":"Token Required"}}`** (verificado el 2026-11-02). Los datos congelados en el repositorio siguen valiendo, pero **el script ya no puede regenerarlos**. El servicio público equivalente es `.../services/SERV_PELIGROS_GEOLOGICOS/MapServer/0`, que sí responde (conteo = 1 en un recuadro de ~2 km alrededor del centro de Arequipa) (verificado el 2026-11-02).
5. **Qué se puede consumir desde el navegador y qué no.** Con CORS verificado (el servidor devolvió `Access-Control-Allow-Origin` con el origen de prueba): IGP (`ide.igp.gob.pe`), ANA (`geosnirh.ana.gob.pe`), IDEP (`www.idep.gob.pe/geoportal`), MINAM (`geoservidorperu.minam.gob.pe`) y la raíz del ArcGIS de CENEPRED (`sigrid.cenepred.gob.pe/arcgis`). **Sin CORS observado:** la API REST de GEOCATMIN (INGEMMET), el padrón de ESCALE (solo autoriza a `escale3.minedu.gob.pe:8080`), y bloqueados a clientes automáticos: `datosabiertos.gob.pe` (HTTP 418, WAF) y `geominsa.minsa.gob.pe` (HTTP 403). Para estos, la ruta es **descarga en tiempo de construcción** (script en el repo) y datos congelados, como ya se hace.
6. **Umbrales: casi ninguno es normativo.** Solo se encontró norma peruana para escuelas (MINEDU: primaria 1 500 m o 30 min, secundaria 3 000 m o 45 min, urbano, con carácter referencial) [20]. Para salud, transporte y área verde **no se encontró umbral normativo peruano**; los 1 000 m, 400 m y 300 m deben etiquetarse como «convención del proyecto», «estándar internacional» o «parámetro del usuario» (sección 2.1).
7. **Validación.** No hay estudio peruano de OSM contra RENIPRESS/ESCALE. La completitud de OSM varía mucho en ciudades latinoamericanas (7 %–73 % en Santiago de Chile) [14]; por eso la validación propia (precisión, exhaustividad y desfase posicional contra RENIPRESS y ESCALE) es necesaria y es barata (sección 5).

## 2. Variables por relevancia

### 2.1 Tabla ordenada por fuerza de la evidencia

«Calculable» = computable en la app a partir de datos públicos. «Estado» = situación en GeoVerificador.

| # | Variable | Evidencia de relevancia | Fuente(s) | Calculable | Estado en la app |
|---|---|---|---|---|---|
| 1 | Seguridad jurídica del predio: título inscrito, cargas y gravámenes, saneamiento físico-legal | Fuerte en Perú, pero sobre todo para inversión y acceso a crédito; el titulado invirtió ~68 % más en vivienda [27]; el diferencial de precio estimado por el Banco Mundial para predios formalizados es ~25 % (estimación del equipo de proyecto, no revisada por pares) [28] | SUNARP [29][30]; Gutiérrez y Molina (la titulación se erosiona en transacciones no registradas) [31] | **No** (consulta por partida; checklist) | Ausente |
| 2 | Exposición a peligros naturales (huaico/quebrada, inundación, movimientos en masa, sismo, volcán) | Moderada para efecto en precio y heterogénea (meta-análisis de 37 estudios: rango −75,5 % a +61,0 %; descuento de −4,6 % en llanura inundable interior de 100 años) [18]; fuerte como factor de seguridad y de restricción normativa (RATDUS: «zonas de riesgo no mitigable» no urbanizables, art. 95; **leído vía resumen automático, verificar en el original**) [24] | INGEMMET, CENEPRED, ANA, IGP (sección 3) | **Parcial** | Oculto (peligros puntuales, E.030) |
| 3 | Acceso al trabajo / tiempo de viaje | Fuerte en elección residencial: el tiempo de viaje es negativo y pesa más el transporte público que el auto [16] | Requiere destino del usuario y ruteo | Solo con destino dado por el usuario | Ausente |
| 4 | Normativa de uso y edificación (zonificación) | Requisito legal (certificado de zonificación y vías, certificado de parámetros) | PDM Arequipa 2016-2025 | Sí | V1a, V1b |
| 5 | Proximidad al transporte público | Moderada a fuerte: en un meta-análisis, residir a ≤ 1/4 de milla de una estación sube el precio ~4,2 %; cada 250 m más cerca suma ~2,3–2,4 % (contexto de ferrocarril de otros países) [17] | OSM | Sí | V4 |
| 6 | Seguridad ciudadana (delitos) | Dirección fuerte, magnitud moderada: en un panel, solo el delito violento afecta el valor (+10 % de delitos violentos ≈ −6 % del valor) [15] | SIDPOL/MININTER | Sí, con límites (denuncias ≠ delitos) | Oculto |
| 7 | Escuelas (proximidad) | Fuerte para proximidad en elección residencial [16]; la calidad escolar capitalizada es mixta y depende de cómo se mida [19] | MINEDU, OSM | Sí (distancia); calidad no verificada | V3 |
| 8 | Ruido y otras molestias (líneas de alta tensión, rellenos) | Moderada; el índice de depreciación por ruido varía de 0,08 a 2,21 % por dB [21] | No se encontró mapa de ruido público de Arequipa | **No verificado** | Ausente |
| 9 | Área verde cercana | Moderada: en 21 de 22 estudios hay efecto significativo, y «la mayor parte de la prima está en el verdor a menos de 400 m» [22] | OSM | Sí | V5 |
| 10 | Atributos estructurales (superficie, antigüedad, calidad) | Fuerte en modelos hedónicos [23] | Los aporta el usuario o el aviso | No (dato del usuario) | Ausente |
| 11 | Servicios básicos (agua, desagüe, luz), habilitación urbana, licencia/conformidad de obra | Prerrequisito legal (Ley 29090; una compraventa de lote no se inscribe sin recepción de obras de la habilitación, salvo disposición libre en la resolución) [25][26]; no es un hallazgo de elasticidad de precio | Municipalidad, concesionarias, SUNARP; el Censo 2017 da cobertura por manzana | Parcial (contexto por manzana); a nivel predio, no | Ausente |
| 12 | Salud (proximidad) | Débil para precios; débil en preferencia declarada (un estudio de una ciudad de Irán) [32] | RENIPRESS, OSM | Sí | V2 |

**Qué dice la evidencia sobre la jerarquía.** La literatura de elección residencial coincide en que costo de vivienda, tiempo de viaje al trabajo, seguridad y escuelas dominan [16]; la literatura hedónica añade atributos estructurales y de entorno [23]. Para una compra en Arequipa se suman dos elementos locales sin análogo hedónico peruano: la **seguridad jurídica** y el **peligro por quebradas y volcán**. Que no exista un estudio peruano es una brecha de evidencia, no una prueba de irrelevancia.

### 2.2 Crítica de las variables implementadas (V1a–V5)

| Variable | Umbral actual | Qué dice la evidencia | Recomendación |
|---|---|---|---|
| V2 Salud | 1 000 m a la IPRESS más cercana (convención) | La norma de categorización de MINSA (RM 546-2011) **no fija distancia ni tiempo** en los extractos revisados; **sin umbral normativo verificado**. El estándar internacional TOD de ITDP usa 1 000 m para atención médica o farmacia [33] | Rotular «convención del proyecto; coincide con ITDP». Filtrar por categoría (I-1…III) o tipo para no tratar un consultorio igual que un hospital. Mostrar la distancia y la categoría, no solo «cerca/lejos». |
| V3 Educación | 500 / 1 500 / 3 000 m (inicial/primaria/secundaria) | MINEDU (RVM 208-2019, criterio de diseño, **referencial**): primaria urbana 1 500 m o 30 min a pie; secundaria urbana 3 000 m o 45 min [20]. Los 500 m para inicial solo aparecen en presentaciones de estudiantes que citan una propuesta preliminar de 2011 y **no se encontró evidencia de que se aprobaran como norma** [34] | Inicial: «sin umbral normativo verificado» (500 m = convención). Primaria y secundaria: citar la RVM como referencial. Corregir la nota «parcialmente no confirmado» con esta distinción. |
| V4 Transporte | 400 m a la parada más cercana (convención) | **Sin umbral normativo peruano verificado.** ITDP: bus frecuente a 500 m; transporte masivo a 1 000 m [33]. Walk Score: 5 minutos a pie (0,25 milla) da el puntaje completo; es un método privado, no una norma [35] | Rotular «convención». Considerar que el dato OSM de paradas en Arequipa (combis, rutas informales) puede no ser completo (sección 5). |
| V5 Área verde | ≥ 5 000 m² a ≤ 300 m (OMS Europa 2016) | La extracción disponible no confirmó la cifra de 300 m en el informe de la OMS [36]; **re-verificar en el PDF antes de citarla**. ITDP usa parque ≥ 300 m² a 500 m [33]; la prima de precio se concentra a < 400 m [22] | Mantener, pero citar la página exacta del informe. |
| Todas | Distancia en línea recta (haversine) | La distancia real por la red es mayor: razón de desvío media de 1,34 en 301 ciudades europeas (rango 1,08–1,88; 1,31 con red OSM) [37]; ~1,32–1,34 en EE. UU. [38] y China [39]. **No hay cifra para Arequipa** | Rotular cada distancia «en línea recta; por calle suele ser ~1,2–1,4 veces mayor (no verificado para Arequipa)». Un «400 m» en línea recta puede equivaler a ~480–560 m caminando. |

## 3. Sistemas del Estado no considerados

### Tabla A. Fuentes con datos espaciales (consultables o descargables)

«CORS» solo describe lo observado con `curl` el 2026-11-02. «Construcción» = descargar con un script del repositorio y congelar el resultado (patrón ya usado por la app).

| Sistema | URL (verificada) | Qué provee | Acceso | CORS observado | Licencia | Uso recomendado |
|---|---|---|---|---|---|---|
| **INGEMMET GEOCATMIN** — peligros geológicos inventariados | `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_PELIGROS_GEOLOGICOS/MapServer/0` (consulta de prueba devolvió `count:1`) | Inventario puntual de peligros geológicos (campos `COD_INV`, `UBIGEO`, `NM_DIST`, etc.); descripción: «Peligros Geológicos del Perú - Feb 2013», actualizado a enero de 2012 en el inventario nacional | ArcGIS REST (query) | **No se observó `Access-Control-Allow-Origin`** en la API REST (la página `/geocatmin/` sí lo trae, pero no la API) | No localizada en el servicio | **Reemplazar** la URL rota del script por esta. Construcción. |
| **INGEMMET** — susceptibilidad a movimientos en masa | `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_IMG_SUSCEP_MOV_MASA/ImageServer` (`identify` en lon −71,53 / lat −16,39 devolvió valor de píxel `3`) | Ráster nacional con clases Muy baja a Muy alta definidas por pendiente, geomorfología, litología, hidrogeología y cobertura; describe zonas «susceptibles a deslizamientos, caídas de rocas, derrumbes, huaycos, aluviones…» | ArcGIS ImageServer `identify` | Sin CORS observado | No localizada | Muestrear en construcción sobre una malla o por punto elegido, o consultar vía proxy. **Hay que leer la leyenda oficial para saber qué significa el valor `3` antes de mostrarlo.** Escala nacional: indicativo, no predial. |
| **INGEMMET** — susceptibilidad a inundación fluvial | `.../SERV_IMG_SUSCEP_INUN_FLUVIAL/ImageServer` y `.../SERV_SUSCEPTIBILIDAD_INUNDACION_FLUVIAL_MIL1/MapServer/0` (ambos listados; no se hizo consulta de datos) | Susceptibilidad a inundación fluvial | ArcGIS REST | Sin CORS observado | No localizada | Igual que la anterior. |
| **INGEMMET** — fallas neotectónicas | `.../DGAR/SERV_NEOTECTONICA_FALLAS/MapServer` (listado en la carpeta DGAR) | Fallas activas | ArcGIS REST | Sin CORS observado | No localizada | Candidata para peligro sísmico local; no se probó con datos. |
| **INGEMMET / OVI** — mapa de peligros del volcán Misti | Información en prensa y boletín: Boletín INGEMMET Serie C n.º 60 «Geología y Mapa de Peligros del Volcán Misti» (Mariño, Rivera, Thouret, Macedo) [40]; `ovi.ingemmet.gob.pe` **no resolvió desde la red de prueba** | Zonas de peligro alto/moderado/bajo por ceniza y lahares; hay una actualización en curso de INGEMMET para reemplazar el mapa anterior (2007/2008 según fuente) [40] | Documento/PDF, no servicio verificado | No aplica | No localizada | **Enlace profundo + texto**, no capa, hasta confirmar un servicio descargable. |
| **CENEPRED SIGRID** | Portal: `https://sigrid.cenepred.gob.pe/sigridv3/` (200, verificado). REST público con CORS: `https://sigrid.cenepred.gob.pe/arcgis/rest/services?f=json` (carpetas: FEN, FONDES, INDECI, MEF, MIDIS, MINJUS, sectores, sigrid, Utilities, VIVIENDA; solo `sigrid/sigrid_collect` y `sectores/COEN_FEN_2027` visibles sin token) | El portal expone «Escenarios de riesgo». El servicio rico (`Cartografia_Peligros`: inundación, movimientos en masa, sismo, tsunami, fajas marginales; `S03_IC` escenario de riesgo; `S02_EE` manzanas referenciales 2017) figura en `https://sig.cenepred.gob.pe/sigrid/rest/services/...` según los resultados de búsqueda | ArcGIS REST | `sigrid.cenepred.gob.pe/arcgis`: **sí (origen reflejado)**. `sig.cenepred.gob.pe`: **no verificable**, el puerto 443 no respondió desde la red de prueba (resuelve a 38.43.129.186) | No localizada | **Probar `sig.cenepred.gob.pe` desde una red en Perú antes de decidir.** Si responde, es la fuente más completa de peligro; si no, usar las descargas de documentos INGEMMET alojadas en SIGRID. |
| **CENEPRED** — informes INGEMMET sobre Arequipa | `https://sigrid.cenepred.gob.pe/sigridv3/documento/20294` y `.../21728` (no abiertos por el autor; citados desde un extracto) | Informe de feb-2025 con 15 sectores afectados por huaicos; evaluación de feb-2026 de las quebradas Chullo, Los Incas, Añashuayco, San Lázaro y El Pato [41] | Descarga PDF | No aplica | No localizada | Resumir en la ficha de peligro como enlace de lectura. **La existencia de polígonos descargables no está verificada.** |
| **ANA** — red hidrográfica y quebradas | `https://geosnirh.ana.gob.pe/server/rest/services/ws_Rios_Quebradas/MapServer` (200) | Red hidrográfica codificada Pfafstetter, con la capa «Cuerpos de agua» | ArcGIS REST | **Sí** (origen reflejado en la raíz del servidor) | No localizada | Distancia a quebrada/río: ver variable N1. Probar consulta de datos antes de implementar. |
| **ANA** — puntos críticos | `.../server/rest/services/Puntos_Criticos/Puntos_Criticos_Final_DU_N_015_2023_Automatizado/FeatureServer/0` (200) | Puntos críticos por intensas precipitaciones (D.U. 015-2023) | ArcGIS REST (FeatureServer) | Sí (mismo servidor) | No localizada | Candidata; verificar cobertura en Arequipa. |
| **ANA / IDEP** — fajas marginales | Catálogo IDEP lista «Faja Marginal» con WMS y WFS: `https://www.geoidep.gob.pe/catalogo-nacional-de-servicios-web/servicio-de-descarga-wfs` [42]. La URL WMS publicada (`https://geosnirh.ana.gob.pe/server/services/RecursosHidricosANA_MIL1/MapServer/WMSServer?`) **devolvió 404 el 2026-11-02**. El espejo `https://www.idep.gob.pe/geoportal/rest/services/INSTITUCIONALES/ANA_WMS/MapServer?f=json` responde 200 con CORS | Fajas marginales delimitadas y puntos críticos | WMS/WFS/REST | Espejo IDEP: sí | No localizada | Solo existen donde ANA ha delimitado; **la ausencia de faja no significa ausencia de peligro**. |
| **IGP** — sismos reportados | `https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0` (200, CORS sí; 48 sismos a ≤ 100 km de Arequipa en la capa, sin filtro de fecha) | Catálogo de sismos | ArcGIS REST; catálogo 1960–2025 en CSV [43] | **Sí** | Open Data Commons Attribution (catálogo en datosabiertos) [43] | Contexto histórico (conteo de sismos en radio), **no** predicción ni zona sísmica oficial. |
| **IGP** — repositorio y CENSIS | `https://ultimosismo.igp.gob.pe/repositorio/datos-sismicos` (200); `https://censis.igp.gob.pe/` (200) | Datos sísmicos 1471–hoy; mapas en PDF/shapefile | Descarga | No aplica | Ver [43] | Descarga manual y congelada. |
| **MVCS** — GeoVivienda | `https://geo.vivienda.gob.pe` (200 en el navegador; la API REST respondió 418 al cliente automático) | Visor geográfico del Ministerio de Vivienda | Visor web | No verificable | No localizada | Enlace profundo; explorar con un navegador. |
| **IDEP/IGN** — Geovisor SNCP | `https://www.idep.gob.pe/geovisor/SNCP/` (200); sitio `https://sncp.gob.pe/` (200) | Repositorio de la plataforma del Sistema Nacional Integrado de Catastro y su vinculación con el Registro de Predios [44] | Visor web | No aplica | No localizada | Enlace profundo. **No se verificó que cubra Arequipa.** |
| **IDEP** — catálogo nacional de servicios | `https://www.geoidep.gob.pe/catalogo-nacional-de-servicios-web` (200) | Registro de WMS/WFS/REST de las entidades públicas [42] | Catálogo | No aplica | — | Punto de partida para descubrir servicios nuevos. |
| **MINAM Geoservidor** | `https://geoservidorperu.minam.gob.pe/arcgis/rest/services?f=json` (200, CORS sí). La capa `CS/Desarrollo_Urbano/MapServer/63` (fajas marginales ANA 2020) **cubre solo un plan metropolitano ajeno** (extremos UTM 255 711–358 979 E, 8 642 443–8 730 504 N, no Arequipa) | Capas ambientales y de planificación | ArcGIS REST | **Sí** | No localizada | No sirve para Arequipa en lo revisado; revisar la carpeta `CS` por capas nacionales. |
| **INEI** — manzanas, centros poblados, NBI | Portal IDE: `https://ide.inei.gob.pe/`; GeoServer `https://sdmr.inei.gob.pe/geoserver/ows`; ArcGIS `https://arcgis.inei.gob.pe:6443/arcgis/rest/services/CARTOGRAFIA_BASE_INEI/BASE_NACIONAL/MapServer` | Manzanas con viviendas, población, material de paredes/pisos, acceso a agua y desagüe (campos `c2_p6_*`, `c2_p10_*`, `c2_p11_*` del Censo 2017 aparecen en la capa de manzanas referenciales de CENEPRED, que cita al INEI) [45] | WMS/WFS/REST/descarga GPKG | **Los tres hosts INEI no respondieron desde la red de prueba (no verificable)**; la capa de manzanas de CENEPRED con esos campos figura en `sig.cenepred.gob.pe` (tampoco alcanzable) | No localizada | Para variable N5 (cobertura de servicios por manzana). **Probar desde Perú** y descargar en construcción. |
| **SENAMHI** | `https://www.senamhi.gob.pe/?&p=descarga-datos-hidrometeorologicos` (200; la página trae `Access-Control-Allow-Origin: *`) | Datos hidrometeorológicos históricos | Descarga con registro previo; **no se encontró API pública** [46] | La página sí; no hay API | No localizada | Fuera de alcance para la ficha de punto. Referencia: lluvias intensas desencadenan huaicos. |
| **MINSA/SUSALUD RENIPRESS** | CSV mensual en `https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress` (HTTP 418 al cliente automático; accesible con navegador; el catálogo lista ediciones abril–setiembre 2026 con latitud y longitud) [47]. Capa MINSA: `https://geominsa.minsa.gob.pe/geominsaserver/rest/services/SRV_DGAIN_DIPOS/SRV_DIPOS_GeoRIS_RENIPRESSPeru/MapServer/0` (**HTTP 403 desde la red de prueba**) | Registro oficial de IPRESS con categoría, estado, ubigeo, coordenadas | Descarga CSV; REST (bloqueado a bots) | No | Open Data Commons Attribution License [47] | **Línea base de validación de V2** (sección 5) y alternativa de datos a OSM. Construcción. |
| **MINEDU ESCALE** — padrón de IIEE | `https://escale.minedu.gob.pe/web/inicio/padron-de-iiee` (200). Descargas de bases del padrón en la biblioteca de documentos de ESCALE (dbf en zip) [48] | Padrón con código modular, código de local, nivel, gestión, estado y coordenadas del local; los datos de ubicación corresponden al **local educativo** y los reporta la DRE/UGEL [48] | Consulta web y descarga; **sin API oficial localizada** (existe un API de terceros, ApisTED, de pago con token, no oficial) | **No**: `Access-Control-Allow-Origin` fijado a `http://escale3.minedu.gob.pe:8080` | No localizada | **Línea base de validación de V3.** Un local alberga varias IIEE: deduplicar por `código de local`. Construcción. |
| **OSINERGMIN** — GISEM | `https://gisem.osinergmin.gob.pe/` (200, «Mapa Energético Minero») | Infraestructura energética (redes) | Visor web; la ruta REST probada devolvió 404 | `Access-Control-Allow-Origin: *` en la ruta probada, que dio 404 | No localizada | Enlace profundo para líneas de alta tensión como molestia (Sirmans et al. 2005 incluye proximidad a líneas de alta tensión entre los factores que bajan el precio [23]). |
| **MTC** | `https://geoportal.mtc.gob.pe/` (200, redirección) | Red vial | Visor | No verificable | No localizada | Baja prioridad. |
| **GEO Perú (PCM)** | `https://www.gob.pe/geoperu` (200; `www.geoperu.gob.pe` redirige aquí) | Geoportal de la plataforma del Estado | Portal | No aplica | — | Punto de entrada; no se verificaron servicios. |
| **INDECI** | `https://www.gob.pe/indeci` (200). `https://sinpad.indeci.gob.pe/` devolvió 404 en la raíz | Escenarios y atlas de peligros (sin servicio verificado) | — | — | — | No verificado; no recomendar hasta tener URL de servicio. |
| **OEFA** | `https://www.gob.pe/oefa` (200) | Fiscalización ambiental | Portal | — | — | Sin capa espacial verificada; baja prioridad. |
| **Datos abiertos Perú** | `https://www.datosabiertos.gob.pe/` (HTTP 418 a clientes automáticos) | Catálogo nacional (RENIPRESS, catálogo sísmico IGP, etc.) | Navegador; la API CKAN está bloqueada a bots | No | Varía por conjunto | Las descargas se hacen a mano y se congelan con fecha. |

**Sin hallazgo verificable:** *Plataforma de Fiscalización* (el término es ambiguo; no se identificó un sistema espacial), *MININTER/PNP* (la app ya usa la capa pública SIDPOL en `services6.arcgis.com`, según `scripts/descargar-delitos.mjs`), *Electrosur/SEAL* (`https://www.seal.com.pe` responde 200, pero no hay dato espacial de cobertura publicado que se haya encontrado).

### Tabla B. Consultas sobre el predio (no son capas; la app ofrece enlace profundo y checklist)

Ninguna se puede automatizar desde un navegador estático. Todas exigen identificar el inmueble (partida, dirección) y varias, DNI o pago.

| Consulta | URL | Qué da | Requisitos y costos | Qué hace la app |
|---|---|---|---|---|
| **SUNARP — Visor BGR** (Base Gráfica Registral) | `https://visor-bgr.sunarp.gob.pe/` (200); guía oficial: `https://www.gob.pe/63173-acceder-al-visor-de-la-base-grafica-registral` [49] | Polígono del predio inscrito y número de partida; descarga de datos técnicos (vértices, áreas); búsqueda por ubicación, partida o coordenadas | DNI + fecha de emisión + captcha; **máximo 3 accesos diarios por DNI**, 45 min por acceso; la información es **referencial y no es publicidad registral** [49]. Cobertura: 7 133 248 predios graficados de 12 993 338 (feb-2026); 495 757 en la zona registral de Arequipa [50] | Botón «Ver si el predio está inscrito en BGR» que abre el visor, con las coordenadas del punto en pantalla para que el usuario las pegue. **Una ausencia en BGR no prueba que no esté inscrito.** |
| **SUNARP — Publicidad registral en línea (SPRL)** | `https://sprl.sunarp.gob.pe/` (redirección verificada desde `enlinea.sunarp.gob.pe`) | Consulta de partida, búsqueda por titular, **Certificado Registral Inmobiliario (CRI)**, copia literal | El CRI muestra titularidad de 10 años y cargas y gravámenes de 30 años, y SUNARP lo recomienda antes de comprar [30]. **Los precios no se pudieron confirmar en una fuente oficial** (fuentes de terceros dan S/ 25, S/ 69 y S/ 71 para certificados distintos) | Enlace + texto «pida un CRI de la partida antes de firmar». **No citar precios en la app.** |
| **SUNARP — Alerta Registral** | `https://alertaregistral.sunarp.gob.pe/alerta/Inicio` (200) | Aviso por correo o SMS cuando se presenta un título o se expide publicidad sobre una partida afiliada; gratuito [51] | Correo, celular y número de partida | Enlace en el checklist (útil tras la compra). |
| **SUNARP — Síguelo Plus** | `https://sigueloplus.sunarp.gob.pe/siguelo/` (200) | Seguimiento de un título presentado [51] | Número de título | Enlace en el checklist: ver si hay títulos pendientes. |
| **SUNARP — Inmovilización de partida** | `https://www.gob.pe/institucion/sunarp/noticias/1355290-combo-de-la-seguridad-para-proteger-propiedades-gratis-alerta-registral-inmovilizacion-de-partidas` | «Candado» voluntario del titular; solicitud presencial [51] | Solo titular | Mención informativa. |
| **Lista oficial de pasos antes de comprar** | `https://www.gob.pe/institucion/sunarp/noticias/1032824-sunarp-evite-ser-sorprendido-conozca-los-pasos-a-seguir-antes-de-comprar-una-casa-o-departamento` [29] | Verificar propietario registrado, ausencia de cargas, ocupación, Hoja Resumen y Predio Urbano municipales; luego minuta, bloqueo registral y escritura | — | Base del checklist. |
| **COFOPRI** | `https://www.gob.pe/cofopri` (200). El visor «Geo Llaqta» (`geollaqta.cofopri.gob.pe`) figura en guías de terceros pero **el nombre de dominio no resolvió desde la red de prueba** | Predios urbanos titulados o en formalización | Sin registro, según guías de terceros (no confirmado en página oficial) | Enlace al portal; **no enlazar al visor hasta verificar el dominio**. |
| **Municipalidad Provincial de Arequipa / IMPLA** | `https://www.muniarequipa.gob.pe/` (200) | Certificado de Zonificación y Vías (lo emite IMPLA según la prensa; licencias de edificación y de funcionamiento corresponden a la municipalidad provincial; el trámite exacto y su TUPA **no se confirmaron**) | Ver TUPA vigente | Mantener la advertencia actual: la app no reemplaza certificados. Hay noticias de 2026 sobre intervención de la Fiscalía en IMPLA y nulidad de certificados [52]; es contexto de riesgo de la fuente, no del dato de la app. |
| **Servicios básicos** | SEDAPAR (`sedapar.com.pe` **no resolvió desde la red de prueba**); SEAL (`https://www.seal.com.pe`, 200); SUNASS (`https://www.gob.pe/sunass`, 200) | Factibilidad y estado de conexión por predio | Recibo del servicio y consulta a la concesionaria | Pregunta del checklist: «pida el último recibo de agua y luz del predio». |

## 4. Variables nuevas propuestas

Convenciones: **Dificultad** = esfuerzo para una app estática (Baja: dato congelado y cálculo local; Media: preprocesamiento en construcción y manejo de ráster/geometría; Alta: requiere servidor, proxy o red). **Umbral** = lo que existe en norma o literatura; si no, «parámetro del usuario».

| Id | Variable | Definición | Indicador medible | Fuente | Umbral | Dificultad |
|---|---|---|---|---|---|---|
| N1 | Cercanía a quebrada o cauce (huaico) | Distancia del punto al cauce o quebrada más cercano | Metros a la línea de `ws_Rios_Quebradas` (ANA) y presencia de quebrada en los informes INGEMMET [41] | ANA REST (CORS sí); INGEMMET | **Sin umbral normativo** para la distancia. La normativa fija la faja marginal solo donde ANA la delimitó; el RATDUS trata las fajas marginales como zona de riesgo no mitigable (art. 95.5, **leído vía resumen, verificar**) [24]. La distancia de alerta es **parámetro del usuario** | Media (probar la consulta de datos; el descarte de ruido por red de drenaje es no trivial) |
| N2 | Susceptibilidad a movimientos en masa | Clase de susceptibilidad del píxel en el punto | Valor del ráster INGEMMET reclasificado con la leyenda oficial | INGEMMET `SERV_IMG_SUSCEP_MOV_MASA` | La clasificación es de INGEMMET; el umbral de «aceptable» es **parámetro del usuario** | Media (sin CORS: muestrear en construcción; escala nacional) |
| N3 | Susceptibilidad a inundación fluvial | Clase en el punto | Valor del ráster/polígono INGEMMET | INGEMMET | Igual que N2. Referencia de magnitud en precios: −4,6 % en llanura inundable interior a 100 años [18] | Media |
| N4 | Peligro volcánico (Misti) | Zona de peligro del mapa INGEMMET (ceniza, lahares, flujos) | Alta/moderada/baja según el mapa oficial | INGEMMET/OVI [40] | Del propio mapa | Alta si no hay capa descargable; Baja si se limita a enlace y texto |
| N5 | Cobertura de servicios por manzana | Proporción de viviendas de la manzana con red pública de agua, desagüe y alumbrado | `c2_p6_1+c2_p6_2`, `c2_p10_1+c2_p10_2`, `c2_p11_1` ÷ viviendas, Censo 2017 | INEI (vía CENEPRED `S02_EE` capa 2100300 o INEI) | **Sin umbral normativo**; es contexto por manzana, **no** estado del predio. El dato es de 2017 | Media (descarga en construcción desde Perú; los hosts no respondieron desde la red de prueba) |
| N6 | Delitos cercanos (existente, oculto) | Conteo ponderado de denuncias en un radio | Denuncias SIDPOL por tipo en radio | MININTER/SIDPOL (ya usado) | Sin umbral normativo. La literatura indica que pesa el **delito violento** [15]: separar violentos de patrimoniales. Radio = parámetro del usuario | Baja (ya existe) |
| N7 | Tiempo de viaje al destino del usuario | Tiempo o distancia al trabajo/estudio indicado por el usuario | Distancia en línea recta × factor de desvío (referencia 1,2–1,4, no verificado en Arequipa) [37][38][39]; el tiempo real exige ruteo | Usuario + ruteo (servicio de terceros no evaluado) | Parámetro del usuario | Baja con línea recta rotulada; Alta con ruteo real |
| N8 | Checklist jurídico-registral | 8–10 preguntas con enlace (partida, CRI, cargas, BGR, alerta, Síguelo, titulación COFOPRI, habilitación urbana, conformidad de obra/declaratoria de fábrica, recibos de agua y luz) | Estado marcado por el usuario: sí / no / pendiente | SUNARP, Ley 29090 [25][26][29][30] | No aplica; es obligación del comprador verificar | Baja (contenido estático) |
| N9 | Sismicidad histórica en radio | Número y magnitud máxima de sismos del catálogo IGP en un radio | Conteo en radio | IGP (CORS sí) [43] | Sin umbral; **no es predicción**. La zona E.030 ya existe oculta y es la referencia normativa | Baja |
| N10 | Líneas de alta tensión y otras molestias | Presencia de infraestructura molesta cerca | Distancia a líneas (OSM `power=line` o GISEM) | OSM / OSINERGMIN | Sin umbral normativo verificado; ruido: **dato no disponible** | Media |

**No proponer sin dato:** ruido, calidad escolar y precio de mercado. No se encontró fuente pública verificada para ninguno en Arequipa.

## 5. Validación

### 5.1 Validar OSM contra RENIPRESS y ESCALE

Contexto de evidencia: la completitud de OSM es desigual. La red vial global ronda el 83 % [53], pero eso no vale para puntos de interés. En una auditoría de campo en Santiago de Chile, la completitud de POI osciló entre 7 % y 73 %, con la mitad de las zonas en 20 % o menos, y los autores sugieren ≥ 85 % para puntuaciones de caminabilidad confiables [14]. En África subsahariana, OSM tenía más hospitales que la lista oficial (13 460 frente a 4 831) pero con diferencias de ~5 % en población alcanzada a 1 hora (extracto) [54]. **No hay estudio peruano.**

Protocolo propuesto (todos los parámetros son hipótesis a barrer, no normas):

1. **Congelar** el CSV de RENIPRESS (con fecha y número de edición) y el padrón de ESCALE (con fecha). Anotar la versión del extracto de OSM.
2. **Filtrar las referencias:** RENIPRESS solo estado activo y solo los tipos que la app considera «establecimiento de salud» (excluir consultorios si así se decide); ESCALE solo niveles inicial, primaria y secundaria, estado activo, y **deduplicar por código de local** (un local alberga varias IIEE).
3. **Armonizar geometría:** convertir polígonos OSM a centroide antes de medir desfases [55].
4. **Emparejar** por similitud de nombre más distancia. Zhang y Pfoser emparejaron POI con similitud de etiqueta ≥ 0,9 (tras quitar palabras vacías) y un búfer de 50 m; entre los emparejados, ~80 % quedó a ≤ 30 m y ~95 % a ≤ 40 m (comparado contra Foursquare, no un registro oficial) [56]. El rango de 100–200 m **no tiene respaldo directo** en esos estudios: **barrer 50, 100 y 200 m** y reportar la sensibilidad.
5. **Calcular, por categoría y por distrito:** *exhaustividad* (qué parte de los registros oficiales aparece en OSM), *precisión* (qué parte de los elementos OSM corresponde a un registro oficial, tras revisar una muestra a mano) y *mediana y percentil 90 del desfase posicional*.
6. **Medir el impacto en la variable, no solo en el POI:** para una malla de puntos de Arequipa, calcular la distancia al establecimiento más cercano con OSM y con la referencia oficial, y reportar en cuántos puntos cambia la clasificación cumple/no cumple y la diferencia mediana en metros.
7. **Fijar los criterios de aceptación antes de medir** (como ya hace `docs/VALIDACION.md` para H1–H3). No hay valor normativo: es decisión del equipo.
8. **Decisión posterior:** si OSM es insuficiente, usar RENIPRESS y ESCALE como fuente primaria y OSM como complemento; mostrar en la ficha la fuente y la fecha de cada dato.

### 5.2 Evaluar la herramienta

- **Usabilidad percibida:** System Usability Scale (SUS). Puntuación = (suma de ítems impares − 1 + suma de 5 − ítems pares) × 2,5, de 0 a 100; se aplica después del uso y antes de la conversación posterior [57]. La media de ~500 estudios es 68; SUS no es un porcentaje y con muestras pequeñas hay que reportar intervalo de confianza [58]. Bangor et al.: media 72,75 en la categoría «Bueno» y 52,01 en «Aceptable» (n = 212 casos) [59].
- **Éxito de tareas:** con tareas representativas («¿puedo construir un edificio de 5 pisos aquí?», «¿hay una escuela primaria a menos de 1 500 m?», «¿qué dice la app sobre peligro en este punto?»), registrar éxito, tiempo y errores. Una revisión de 87 estudios de geovisualización interactiva encontró que la eficiencia (tiempo) es lo más medido, luego la efectividad y la satisfacción, y pocos usan instrumentos estandarizados [60]. **No se encontró un objetivo numérico respaldado** para tasa de éxito o tiempo: fijarlo antes de medir.
- **Muestra:** 5 usuarios detectan cerca del 85 % de los problemas en pruebas cualitativas y conviene iterar en rondas pequeñas [61]; NN/g aclara que 5 usuarios sirven para lo cualitativo, no para estadística [62]. Hay evidencia de que con 5 usuarios la cobertura varía de ~55 % a casi 100 % [63] (fuente secundaria).
- **Pensar en voz alta** con tareas representativas es barato y robusto, pero no da estadística [64]. Usar las 10 heurísticas de Nielsen como lista de revisión experta [65].
- **Evaluación de SDSS:** una revisión sistemática halló falta de guías de usabilidad y de estudios longitudinales para SIG [66]. **No se encontró evaluación de herramientas de compra de vivienda en particular.**
- **Validez de datos (distinta de usabilidad):** lo hecho en `docs/VALIDACION.md` §2.1–2.4 cubre zonificación; falta lo de 5.1 para V2/V3/V4/V5.

## 6. Recomendaciones de diseño de decisión

Derivadas de la literatura de decisión multicriterio y de diseño de interfaces. Donde la recomendación es inferencia del autor y no hallazgo de una fuente, se indica.

1. **Mantener «sin puntaje global» y explicar por qué en pantalla.** Los pesos son juicios de valor, la agregación lineal permite compensar y los índices compuestos «pueden enviar mensajes no robustos» y deben usarse junto con sus subindicadores [10][11][12]. Una nota breve («No sumamos variables distintas: usted decide qué importa») basta.
2. **Tabla de indicadores con filas consistentes.** Opciones en columnas, atributos en filas, hasta 5 opciones, con la posibilidad de ocultar filas o mostrar solo diferencias; el principal problema de las tablas comparativas es el dato faltante o inconsistente, que debe marcarse explícitamente [67][68].
3. **Mínimos fijados por el usuario (filtro conjuntivo).** El rechazo conjuntivo acepta una alternativa si cumple umbrales en todos los atributos [9][69]. Mostrar «cumple todos sus mínimos: sí/no» y nombrar las variables que fallan. Los umbrales por defecto son los de la sección 2.2, rotulados con su tipo de fuente (norma MINEDU, estándar ITDP, método Walk Score, convención del proyecto).
4. **Comparar 2–3 puntos y señalar dominancia, sin declarar ganador.** Una opción domina a otra si no es peor en ninguna dimensión y es mejor en al menos una; es un orden parcial y deja muchas alternativas incomparables [70]. Textos posibles: «A es igual o mejor en todas las variables mostradas» o «A y B se compensan: A gana en X, B en Y». (Inferencia de aplicación al caso; no se encontró una aplicación documentada a compra de vivienda.)
5. **Pesos solo opcionales y con prueba de sensibilidad.** Si el usuario pide un ranking, hacerlo con pesos explícitos suyos y mostrar «¿cambia el orden si cambian los pesos?». La práctica de análisis de sensibilidad es rara en SIG-MCDM y los pesos son la mayor fuente de controversia e incertidumbre [71].
6. **Comunicar incertidumbre y procedencia por variable.** Fuente, fecha del dato, resolución y escala de cada capa (por ejemplo, susceptibilidad INGEMMET a escala nacional); distancia rotulada «en línea recta»; insignia de validación (precisión y exhaustividad contra RENIPRESS/ESCALE, n = …). Comunicar incertidumbre epistémica no tiende a afectar negativamente a las audiencias, aunque los efectos varían por individuo y formato [72]. Para peligros, acompañar las palabras de clase con su definición numérica o de criterio, porque los términos verbales se interpretan de forma muy variable [73]. (La extensión a peligros naturales es inferencia: no se encontró estudio específico de comunicación de peligros al público.)
7. **No prometer la «sobrecarga de opciones».** Su efecto medio en un metaanálisis de 63 condiciones fue «prácticamente cero» [74]; limitar a 2–3 puntos se justifica por legibilidad, no por ese efecto.
8. **Ayuda de decisión con aclaración de valores.** Las ayudas de decisión en salud (Cochrane, 209 estudios) mejoran el conocimiento y la exactitud de la percepción de riesgo con evidencia de alta certeza, y elecciones más congruentes con los valores con certeza moderada [75]. Es una analogía de otro dominio: sugiere preguntar al usuario sus mínimos y prioridades antes de mostrar resultados.
9. **Separar lo calculado de lo que se verifica a mano.** Dos zonas en la ficha: «Lo que la app calculó» (variables espaciales) y «Lo que usted debe comprobar antes de comprar» (checklist de la tabla B con enlaces). Esto sitúa la seguridad jurídica, la variable de mayor evidencia, sin fingir que se puede calcular.
10. **Rotular lo que falta.** «Dato no disponible» para ruido, calidad escolar y precio, en vez de omitirlos, para que el usuario sepa que existen.

## 7. Brechas y verificaciones pendientes

- Repetir las pruebas de CORS con el dominio real de despliegue y desde una red en Perú, en particular `sig.cenepred.gob.pe`, los hosts INEI (`ide.inei.gob.pe`, `sdmr.inei.gob.pe`, `arcgis.inei.gob.pe:6443`), `ovi.ingemmet.gob.pe`, `sedapar.com.pe` y `geollaqta.cofopri.gob.pe`, que no respondieron desde la red de prueba.
- Leer la leyenda oficial del ráster de susceptibilidad de INGEMMET antes de mostrar su valor.
- Confirmar en el PDF de la OMS Europa 2016 la cifra de 300 m [36] y en la norma original los artículos del RATDUS citados vía resumen [24].
- Confirmar con fuente oficial (gob.pe/sunarp) las tarifas del CRI antes de citar cualquier monto.
- Confirmar que el padrón de ESCALE y la capa RENIPRESS cubren Arequipa con coordenadas utilizables (se validará en 5.1).
- No se encontró estudio hedónico, de preferencias declaradas ni de capitalización de riesgo para Perú o Arequipa.

## 8. Referencias

URLs abiertas por el autor se marcan (abierta); las demás provienen de resultados de búsqueda o de los informes de dos sub-investigaciones del autor (extractos).

**Documentos internos del proyecto (referencias 1–8, sin URL)**

1. `docs/VALIDACION.md` (hipótesis H1–H3 y protocolo de validación).
2. `docs/METODOLOGIA.md` (alcance, variables y límites).
3. `scripts/descargar-peligros.mjs` (endpoint de peligros geológicos, hoy con «Token Required»).
4. `scripts/descargar-delitos.mjs` (capa SIDPOL en ArcGIS Online).
5. `scripts/extraer-equipamiento.mjs` (extracción OSM vía Overpass).
6. `scripts/verificar-datos.mjs` (verificación automática de datos).
7–8. Reservadas (sin uso).

**Metodología y decisión multicriterio**

9. Malczewski, J. (2000). On the use of weighted linear combination method in GIS: common and best practice approaches. *Transactions in GIS*. https://onlinelibrary.wiley.com/doi/10.1111/1467-9671.00035 · PDF abierto: https://www.yorku.ca/gis/es7189/docs/malczewski00.pdf
10. OECD/JRC (2008). *Handbook on Constructing Composite Indicators*. https://www.oecd.org/content/dam/oecd/en/publications/reports/2008/08/handbook-on-constructing-composite-indicators-methodology-and-user-guide_g1gh9301/9789264043466-en.pdf
11. Munda, G. (JRC). Sobre pesos como razones de intercambio en agregación lineal. https://publications.jrc.ec.europa.eu/repository/bitstream/JRC32434/EUR%2021834%20EN.pdf
12. Saisana, Saltelli & Tarantola (2005). Uncertainty and sensitivity analysis techniques as tools for the quality assessment of composite indicators. https://www.andreasaltelli.eu/file/repository/JRSS_2005.pdf
13. Malczewski, J. (2006). GIS-based multicriteria decision analysis: a survey of the literature. https://www.tandfonline.com/doi/full/10.1080/13658810600661508 · Malczewski & Rinner (2015), libro: https://link.springer.com/book/10.1007/978-3-540-74757-4

**Evidencia de variables**

14. Steiniger et al. (Santiago de Chile), completitud de POI de OSM. https://doi.org/10.21433/b31167f0678p
15. Ihlanfeldt & Mayock (2010). Crime and housing values. https://doi.org/10.4337/9781849806206.00021
16. Schirmer, van Eggermond & Axhausen (2014). The role of location in residential location choice models: a review of literature. *JTLU* 7(2). https://doi.org/10.5198/jtlu.v7i2.740
17. Debrezion, Pels & Rietveld (2007). The impact of railway stations on residential and commercial property value: a meta-analysis. https://link.springer.com/article/10.1007/s11146-007-9032-z
18. Beltrán, Maddison & Elliott (2018). Is flood risk capitalised into property values? *Ecological Economics* 146. https://research.birmingham.ac.uk/en/publications/is-flood-risk-capitalised-into-property-values/
19. Turnbull & Zheng (2019) (meta-análisis, calidad escolar). https://doi.org/10.1111/1540-6229.12300 · Nguyen-Hoang & Yinger (2011). https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1895351
20. MINEDU. Criterios de diseño para locales de primaria y secundaria polidocentes completos y usos compartidos (RVM 208-2019-MINEDU; referencial). https://repositorio.minedu.gob.pe/bitstream/handle/20.500.12799/9573/Criterios%20de%20dise%C3%B1o%20para%20locales%20de%20Primaria%20y%20Secundaria%20polidocentes%20completos%20y%20usos%20compartidos.pdf?isAllowed=y&sequence=1
21. Bristow & Thanos (2015). Noise depreciation index, meta-análisis. https://doi.org/10.1121/1.4933527
22. Crompton & Nicholls (2020). Impact on property values of distance to parks and open spaces. https://www.tandfonline.com/doi/full/10.1080/16078055.2020.1832026
23. Sirmans, Macpherson & Zietz (2005). The composition of hedonic pricing models. *J. Real Estate Literature* 13(1). https://doi.org/10.1080/10835547.2005.12090154
24. D.S. 012-2022-VIVIENDA (RATDUS), El Peruano. https://busquedas.elperuano.pe/dispositivo/NL/2112560-6 (leído solo mediante resumen automático; verificar en el original)
25. Ley 29090 (copia). https://www.muniate.gob.pe/wp-content/uploads/2026/02/LEY-N%C2%B0-29090.pdf
26. Resolución 2195-2022-SUNARP-TR (fuente secundaria). https://lpderecho.pe/procede-inscripcion-compraventa-lote-falta-inscripcion-habilitacion-urbana-resolucion-2195-2022-sunarp-tr/
27. Field, E. (2005). Property rights and investment in urban slums. *JEEA*. https://doi.org/10.1162/1542476054472937
28. Banco Mundial. Documento de proyecto sobre titulación COFOPRI. https://documents1.worldbank.org/curated/en/394261468757768033/pdf/29298.pdf
29. SUNARP. Pasos antes de comprar una casa o departamento. https://www.gob.pe/institucion/sunarp/noticias/1032824-sunarp-evite-ser-sorprendido-conozca-los-pasos-a-seguir-antes-de-comprar-una-casa-o-departamento
30. SUNARP. Solicitar Certificado Registral Inmobiliario (CRI). https://www.gob.pe/institucion/sunarp/pages/26681-solicitar-certificado-registral-inmobiliario-cri
31. Gutiérrez & Molina (RAND). https://www.rand.org/content/dam/rand/pubs/working_papers/WR1100/WR1156-1/RAND_WR1156-1.pdf
32. Rajabi et al. (2024), Qazvin. https://link.springer.com/article/10.1007/s43762-024-00115-3
33. ITDP (2017). TOD Standard. https://itdp.org/wp-content/uploads/2017/06/TOD_Standard_EN.pdf
34. Estándares de urbanismo (propuesta preliminar 2011; fuentes secundarias). https://es.slideshare.net/slideshow/sistema-nacional-de-estandares-de-urbanismo-cap-i-y-ii-pdf/279257921 · https://www.docsity.com/es/docs/ley-normativa-urbanismo-sostenible/11076600/
35. Walk Score, metodología. https://www.walkscore.com/methodology
36. OMS Europa (2016). Urban green spaces and health. https://www.who.int/europe/publications/i/item/WHO-EURO-2016-3352-43111-60341
37. Mennicken, Lemoy & Caruso. Radial detour en ciudades europeas. https://orbilu.uni.lu/bitstream/10993/58731/1/MennickenLemoyCarusoEPB.pdf
38. Giacomin & Levinson. Road network circuity in metropolitan areas. https://doi.org/10.1068/b130131p
39. Chen & Chen. Detour index en ciudades chinas. https://doi.org/10.1080/19475683.2021.1966503
40. Andina, INGEMMET prepara nuevo mapa de peligros del Misti (Boletín Serie C n.º 60 citado allí). https://andina.pe/ingles/noticia-bicentenario-del-peru-ingemmet-elabora-nuevo-mapa-peligros-del-volcan-misti-801392.aspx
41. INGEMMET/CENEPRED, informes sobre Arequipa. https://sigrid.cenepred.gob.pe/sigridv3/documento/20294 · https://sigrid.cenepred.gob.pe/sigridv3/documento/21728
42. IDEP, Catálogo nacional de servicios web. https://www.geoidep.gob.pe/catalogo-nacional-de-servicios-web/servicio-de-descarga-wfs · https://www.idep.gob.pe/wms/wms_ana1.html
43. IGP, Catálogo sísmico desde 1960 (Open Data Commons Attribution). https://www.datosabiertos.gob.pe/dataset/cat%C3%A1logo-s%C3%ADsmico-desde-1960-instituto-geof%C3%ADsico-del-per%C3%BA-igp · https://ultimosismo.igp.gob.pe/repositorio/datos-sismicos
44. Geovisor SNCP. https://www.idep.gob.pe/geovisor/SNCP/ · https://sncp.gob.pe/
45. CENEPRED, capa «Manzanas referenciales 2017» (fuente INEI). https://sig.cenepred.gob.pe/sigrid/rest/services/S02_EE/MapServer/2100300 · INEI IDE https://ide.inei.gob.pe/
46. SENAMHI, descarga de datos. https://www.senamhi.gob.pe/?&p=descarga-datos-hidrometeorologicos
47. RENIPRESS en datos abiertos (SUSALUD, ODC Attribution). https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress
48. MINEDU ESCALE, padrón. https://escale.minedu.gob.pe/web/inicio/padron-de-iiee
49. SUNARP, Visor de la Base Gráfica Registral. https://www.gob.pe/63173-acceder-al-visor-de-la-base-grafica-registral · manual https://www.sunarp.gob.pe/pdfs/visorbgr/MANUAL_DEL_USUARIO_VISOR_BGR.pdf · visor https://visor-bgr.sunarp.gob.pe/
50. SUNARP, cifras del Visor BGR (feb-2026). https://www.gob.pe/institucion/sunarp/noticias/1359152-visor-bgr-sunarp-supera-los-3-millones-de-consultas-de-mas-de-360-mil-ciudadanos
51. SUNARP, Alerta Registral e inmovilización. https://www.gob.pe/institucion/sunarp/pages/371-inscribir-alerta-registral · https://www.gob.pe/institucion/sunarp/noticias/1355290-combo-de-la-seguridad-para-proteger-propiedades-gratis-alerta-registral-inmovilizacion-de-partidas · https://alertaregistral.sunarp.gob.pe/alerta/Inicio
52. El Búho, IMPLA y PDM (prensa, contexto). https://elbuho.pe/2026/07/arequipa-zona-rosa-incluida-en-pdm-fiscalia-interviene-impla-ante-posible-favorecimiento-de-prostibulos/
53. Barrington-Leigh & Millard-Ball (2017). The world's user-generated road map is more than 80% complete. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0180698
54. HeiGIT. OSM y acceso a salud en África subsahariana. https://heigit.org/exploring-osm-for-healthcare-access-analysis-in-sub-saharan-africa/
55. Revista Brasileira de Cartografia (polígono vs punto en escuelas OSM). https://seer.ufu.br/index.php/revistabrasileiracartografia/article/download/72070/38763
56. Zhang & Pfoser (2019). POI matching. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0212606
57. Brooke, J. System Usability Scale (copia AHRQ). https://digital.ahrq.gov/sites/default/files/docs/survey/systemusabilityscale%2528sus%2529_comp%255B1%255D.pdf
58. Sauro. SUS. https://measuringu.com/sus/ · https://measuringu.com/interpret-sus-score/
59. Bangor, Kortum & Miller (2008). https://www.tandfonline.com/doi/full/10.1080/10447310802205776
60. Revisión de estudios de usabilidad de geovisualización interactiva. https://www.tandfonline.com/doi/full/10.1080/10447318.2026.2618556
61. Nielsen. Why you only need to test with 5 users. https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/ · Virzi (1992). https://journals.sagepub.com/doi/10.1177/001872089203400407
62. NN/g. 5 test users, cualitativo vs cuantitativo. https://www.nngroup.com/articles/5-test-users-qual-quant/
63. HumanFactors. Enough is enough (fuente secundaria). https://www.humanfactors.com/newsletters/enough_is_enough.html
64. NN/g. Thinking aloud. https://www.nngroup.com/articles/thinking-aloud-the-1-usability-tool/
65. NN/g. 10 heurísticas. https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1-compressed.pdf
66. Unrau & Kray. Revisión sistemática de evaluación de usabilidad en SIG. https://doi.org/10.1080/13658816.2018.1554813
67. NN/g. Comparison tables. https://www.nngroup.com/articles/comparison-tables/
68. NN/g. Lawn-mower pattern. https://www.nngroup.com/articles/lawn-mower-pattern/
69. Chakhar & Mousseau. Restricciones y alternativas aceptables. https://www.lamsade.dauphine.fr/mcda/biblio/PDF/ChakharMousseauInbook2007b.pdf
70. Greco et al. (2024). Dominancia y orden parcial. https://www.iris.unict.it/retrieve/cb6fc63a-f16d-4c14-a163-46b863c27dc9/1-s2.0-S0377221724005988-main.pdf
71. Chen, Yu & Khan (2010). Spatial sensitivity analysis of multi-criteria weights in GIS-based land suitability evaluation. https://www.sciencedirect.com/science/article/abs/pii/S1364815210001842
72. van der Bles et al. (2019). Communicating uncertainty about facts, numbers and science. https://royalsocietypublishing.org/rsos/article/6/5/181870/95102/Communicating-uncertainty-about-facts-numbers-and
73. Budescu et al. (2014). https://www.nature.com/articles/nclimate2194
74. Scheibehenne, Greifeneder & Todd (2010). Can there ever be too many options? https://academic.oup.com/jcr/article/37/3/409/1827647
75. Stacey et al. Cochrane, ayudas de decisión. https://www.cochrane.org/evidence/CD001431_patient-decision-aids-help-people-who-are-facing-decisions-about-health-treatment-or-screening

**Endpoints verificados por el autor el 2026-11-02 (respondieron con datos o metadatos)**

- GEOCATMIN: `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services?f=json`; `.../SERV_PELIGROS_GEOLOGICOS/MapServer/0/query?...returnCountOnly=true`; `.../SERV_IMG_SUSCEP_MOV_MASA/ImageServer/identify`.
- IGP: `https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0/query?...`.
- ANA: `https://geosnirh.ana.gob.pe/server/rest/services?f=json`; `.../ws_Rios_Quebradas/MapServer`.
- IDEP: `https://www.idep.gob.pe/geoportal/rest/services/INSTITUCIONALES/ANA_WMS/MapServer?f=json`.
- CENEPRED: `https://sigrid.cenepred.gob.pe/arcgis/rest/services?f=json`.
- MINAM: `https://geoservidorperu.minam.gob.pe/arcgis/rest/services?f=json`.
