# Auditoría de datos (2026-11-11)

Revisión de todos los archivos de `public/data/` en la rama `feat/agua-sedapar` (commit 79f9b3b). Es una revisión de lectura: no se cambió ningún dato, umbral ni diseño. Qué se hizo: (1) inventario de cada archivo; (2) comprobaciones con números reales (cajas, duplicados, nombres vacíos, geometrías, coordenadas repetidas, cruce de nombres de distrito); (3) revisión en el navegador de cuatro puntos y de las 28 capas del mapa; (4) este informe. `pnpm datos:verificar` da 252 de 252 comprobaciones correctas y `pnpm test` 1 624 pruebas correctas en el mismo commit.

Fecha de referencia para «antigüedad»: 2026-11-11. «Antiguo» = datos de hace más de 3 años.

## 1. Inventario

`Verif.` = ¿lo cubre `pnpm datos:verificar`? (sí = hay comprobaciones sobre el archivo). «Fecha del dato» es el periodo que dice la fuente; «descarga» es cuándo se bajó o generó.

| Archivo | Fuente (publicador) | Fecha del dato · descarga | Licencia | Cantidad | Geometría | kB | Script | Verif. |
|---|---|---|---|---|---|---|---|---|
| `zonas_aqp.geojson` | Plano de Zonificación del PDM Arequipa 2016-2025 (Municipalidad Provincial), extraído del PDF con QGIS | PDM 2016-2025 (**vigencia cumplida**) · validado 2026-10-12 | Sin licencia declarada (documento municipal) | 793 | MultiPolygon | 2 744 | **ninguno** (extracción manual; `validar-zonificacion-plano.mjs` lo compara con el PDF, SHA-256 en METODOLOGIA) | sí |
| `reglas_zonas.json` | Reglamento del PDM (parámetros por zona) | PDM 2016-2025 | Sin licencia declarada | 29 zonas | sin geometría | 10 | **ninguno** (transcripción manual) | sí |
| `distritos_aqp.geojson` | Límites distritales INEI vía GEOCATMIN (INGEMMET) | oficios INEI 2024 · 2026-10-14 | No declarada | 25 | Polygon | 547 | `descargar-distritos.mjs` | sí |
| `zonas_sismicas_e030.json` | Norma E.030 Diseño Sismorresistente 2026 (MVCS) | firmada 2026-04-28 | Norma legal | 29 distritos | sin geometría | 2 | **ninguno** (transcrito del Anexo II; el script lo lee) | sí |
| `delitos_aqp.geojson` | Mapa del Delito Georreferenciado (MININTER, SIDPOL de la PNP) | 2025-01-01 a 2026-07-31 · 2026-10-12 | No declarada | 8 245 | Point | 1 778 | `descargar-delitos.mjs` | sí |
| `peligros_aqp.geojson` | Inventario de peligros geológicos, GEOCATMIN (INGEMMET) | eventos 2003-2023 · 2026-10-12 | No localizada | 394 | Point | 96 | `descargar-peligros.mjs` (el servicio de origen **hoy exige token**: no se puede regenerar tal cual) | sí |
| `quebradas_aqp.geojson` | ANA (red hidrográfica, elaboración enero de 2018), IGP y OpenStreetMap | ANA 2018 · 2026-11-03 | ANA e IGP: no localizada; OSM: ODbL | 265 | LineString (2 Multi) | 345 | `descargar-quebradas.mjs` | sí |
| `peligro_volcanico_misti.geojson` | IGP (CENVUL), zonas de peligro del Misti | **sin fecha en el servicio** · 2026-11-03 | No declarada | 87 | MultiPolygon | 501 | `descargar-peligro-volcanico.mjs` | sí |
| `sismos_igp.geojson` | IGP, sismos reportados | 2026-01-01 a 2026-11-02 · 2026-11-02 | ODC-By (catálogo IGP); la del servicio no se localizó | 94 | Point | 20 | `descargar-sismos.mjs` | sí |
| `riesgo_cenepred_fen2027.json` | CENEPRED (SIGRID), escenario El Niño 2026-2027 | estudio de mayo de 2026 · 2026-11-03 | No declarada | 25 distritos | sin geometría | 14 | `descargar-riesgo-cenepred.mjs` | sí |
| `precios_m2_distrito.json` | Aptología (aptologia.com) | 2026-10-11 a 2026-10-18 · 2026-11-03 | CC BY 4.0 | **3 distritos** (273 avisos de venta, 0 de arriendo) | sin geometría | 2 | `descargar-precios.mjs` | sí |
| `censo/index.json` + `censo/manzanas/*.json` (25) | INEI, Censos Nacionales 2017 (REDATAM) y polígonos de manzana | **2017** · 2026-11-10 | No localizada; se atribuye al INEI | 31 277 manzanas (11 250 con cifras) | MultiPolygon | 11 MB en total | `descargar-censo-servicios.mjs` | sí |
| `equipamiento/salud.geojson` | RENIPRESS (SUSALUD) + OpenStreetMap de respaldo | 2026-10-30 | ODC-By + ODbL | 280 (256 + 24) | Point | 78 | `descargar-equipamiento-oficial.mjs` | sí |
| `equipamiento/consultorios.geojson` | RENIPRESS + OpenStreetMap de respaldo | 2026-10-30 | ODC-By + ODbL | 194 (162 + 32) | Point | 58 | ídem | sí |
| `equipamiento/educacion.geojson` | Padrón de ESCALE (MINEDU) + OpenStreetMap de respaldo | padrón 2026-10-30 | ESCALE: «Acuerdo de uso de datos» (**no es una licencia abierta**); OSM: ODbL | 1 713 (1 508 + 205) | Point | 705 | ídem | sí |
| `equipamiento/osm/salud.geojson`, `osm/educacion.geojson` | OpenStreetMap (copia cruda, insumo del respaldo) | 2026-10-28 | ODbL | 164 y 2 174 | Point | 33 y 484 | `extraer-equipamiento.mjs` | parcial (solo como insumo) |
| `equipamiento/transporte.geojson` | OpenStreetMap | 2026-10-28 | ODbL | 414 | Point | 86 | `extraer-equipamiento.mjs` | sí |
| `equipamiento/areas_verdes.geojson` | OpenStreetMap | 2026-10-28 | ODbL | 1 320 | Polygon | 403 | `extraer-equipamiento.mjs` | sí |
| `equipamiento/mercados.geojson`, `supermercados.geojson`, `malls.geojson` | OpenStreetMap (el censo de mercados CENAMA 2016 es solo referencia) | 2026-11-10 | ODbL | 89 · 32 · 51 | Point y Polygon | 28 · 8 · 21 | `descargar-comercio.mjs` | sí |
| `equipamiento/finanzas.geojson`, `comida_fuera.geojson`, `recreacion.geojson` | OpenStreetMap | 2026-11-11 | ODbL | 145 · 631 · 49 | Point y Polygon | 31 · 140 · 14 | `descargar-servicios-osm.mjs` | sí |
| `electricidad/concesiones_distribucion.geojson` | MINEM, Dirección General de Electricidad | 2026-11-10 | ODC-By | 5 | Polygon | 12 | `descargar-concesiones-electricas.mjs` | sí |
| `mineria/concesiones_mineras.geojson` | INGEMMET, Catastro Minero (GEOCATMIN) | actualizado 2026-11-10 | No localizada; se atribuye a INGEMMET | 425 | Polygon (1 Multi) | 256 | `descargar-concesiones-mineras.mjs` | sí |
| `rutas_osm.geojson` | OpenStreetMap, relaciones `route=bus` de la red SIT | 2026-11-10 | ODbL | 241 rutas | LineString | 3 183 | `descargar-rutas-osm.mjs` | sí |
| `rutas_smartbus.geojson` | SmartBus (smartbus.app) | 2026-11-03 | **Autorización verbal; confirmación escrita pendiente** | 241 rutas + 9 301 paradas | Line, MultiLine, Point | 4 828 | `descargar-rutas-smartbus.mjs` | sí |
| `agua/puntos_acopio.geojson` | SEDAPAR y Municipalidad Provincial de Arequipa (directorio publicado en gob.pe el 2024-02-16) | **abril a junio de 2017** · 2026-11-11 | Sin licencia declarada (información pública) | 575 de 582 fichas | Point | 160 | `convertir-acopio-sedapar.mjs` (+ CSV fuente en `scripts/fuentes/`) | sí |
| `agua/interrupciones_sedapar.json` | SUNASS, registro de interrupciones | 2019-10-03 a 2024-04-26 · 2026-11-11 | ODC-By | 4 549 interrupciones, 18 distritos | sin geometría | 7 | `descargar-interrupciones-sunass.mjs` | sí |

Total de `public/data/`: 28 MB (11 MB del censo, que se lee por distrito).

### Marcas del inventario

- **Antiguos (más de 3 años):** censo 2017 (9 años), puntos de acopio 2017 (9), ANA 2018 (8,8), plano de zonificación PDM 2016-2025 (vigencia cumplida), mapa del Misti (**sin fecha**, no se puede saber). Cerca del límite: peligros geológicos hasta 2023 e interrupciones hasta abril de 2024 (2,5 años).
- **Sin licencia declarada o no abierta:** ESCALE (acuerdo de uso), INGEMMET (peligros, minería, límites), INEI (censo), IGP (Misti), ANA, MININTER (delitos), CENEPRED, SEDAPAR (acopio), plano y reglamento del PDM. Se atribuyen a la entidad y son información pública del Estado, pero **no se verificó** que su redistribución en el repositorio y en la web esté permitida.
- **Autorización pendiente:** SmartBus (verbal; la confirmación escrita sigue pendiente).
- **Sin script que lo regenere:** `zonas_aqp.geojson`, `reglas_zonas.json`, `zonas_sismicas_e030.json` (manuales, con su validación o transcripción documentada); `peligros_aqp.geojson` se generó con un script pero el servicio exige hoy token.
- **No cubiertos del todo por `datos:verificar`:** `equipamiento/osm/*.geojson` (copias crudas) y no hay una comprobación genérica sobre todos los archivos (caja, coordenadas finitas, anillos cerrados, `metadata.registros` igual al número de features); este informe hizo esa pasada a mano (sección 2).

## 2. Comprobaciones con números reales

Caja de Arequipa metropolitana: lon −71,75 a −71,35, lat −16,60 a −16,20.

| Comprobación | Resultado |
|---|---|
| Coordenadas no finitas, lat/lon invertidas, geometría nula | **0** en los 25 GeoJSON |
| Anillos abiertos o de menos de 4 puntos, polígonos de área cero | **0** |
| Polígonos con autointersección (anillos de hasta 400 vértices) | 9 de 793 en `zonas_aqp` (zonas extraídas del PDF), 1 de 1 320 en `areas_verdes`; no afectan al punto-en-polígono por paridad |
| Puntos fuera de la caja | Acopio 0, salud 0, educación 0, transporte 0, rutas 0, peligros 0, OSM de comercio 0. Fuera: delitos **200** de 8 245 (La Joya 160, Vítor 17, Santa Rita de Siguas 8, San Juan de Tarucani 7, etc.: distritos de la provincia que no son de los 25); sismos 91 de 94 (es una cobertura regional, la ficha filtra por distancia); polígonos de minería (67), electricidad (4 de 5), distritos (11), Misti (12) y cauces (8) que sobresalen de la caja porque son grandes |
| CRS | Todos en WGS84 lon/lat (`zonas_aqp` declara CRS84). Los 575 puntos de acopio reproyectados a UTM con otra fórmula dan el norte y el este de su ficha a menos de 0,006 m |
| `metadata.registros` frente al número de features | Coincide en los 22 archivos que lo declaran (rutas OSM, rutas SmartBus y el plano de zonas no lo traen) |
| Nombres vacíos | Acopio 5 de 575 sin dirección; salud 1 de 280; educación 15 de 1 713 (ESCALE/OSM sin nombre); transporte 77 de 414; áreas verdes 1 019 de 1 320 (parques sin nombre en OSM, esperable); comida fuera 57 de 631; finanzas 24 de 145; recreación 39 de 49; mercados 16 de 89; malls 2 de 51; supermercados 3 de 32. La ficha usa «Sin nombre en OSM» donde corresponde |
| Duplicados exactos de coordenada | Salud 10 y consultorios 13 (varios establecimientos en el mismo edificio, con códigos RENIPRESS distintos); acopio 10 en 8 pares (fichas distintas con la misma coordenada: se conservan); `osm/educacion` 147 (copia cruda); rutas SmartBus 5 226 de 9 301 paradas (una parada sirve a varios ramales) |
| Duplicados entre fuente primaria y de respaldo | **Salud y consultorios: 0** pares de fuentes distintas a ≤ 25 m. **Educación: 39 pares ESCALE–OSM a ≤ 25 m**; es por diseño (el respaldo se añade si ningún local oficial **de ese nivel** está a ≤ 200 m, de modo que un jardín de OSM junto a una primaria de ESCALE se conserva), pero pueden ser el mismo local contado dos veces cuando el nombre difiere (p. ej. «40691 Santo Domingo» a 6 m) |
| Duplicados en peligros | **34 de 394** (8,6 %) con la misma coordenada, tipo y año y distinto `id` (el inventario registró el mismo evento dos veces, p. ej. «S/n» y sector vacío). Infla en esa proporción los conteos de peligros dentro de un radio |
| Valores absurdos | Precios: 3 distritos con S/ 4 390 a S/ 4 905 por m² (medianas de 47 a 118 avisos, plausibles; no hay valores atípicos que filtrar). Sismos: magnitud 3,3 a 5,1, profundidad 7 a 205 km. Minería: 0,32 a 34 113 ha, códigos únicos. Peligros: años 2003 a 2023 |
| Delitos: coordenadas en centroides | Solo el **49,1 %** de las denuncias tiene coordenada real (8 245 de 16 780 en el periodo). De esas, **215 coordenadas concentran 2 275 registros (27,6 %)** y la más repetida tiene 56: son direcciones o puntos de referencia, no una nube homogénea. 800 registros están en coordenadas con 20 o más denuncias. Las 15 más repetidas están a entre 300 m y 12 km del promedio de vértices de su distrito, así que no parecen centroides distritales; no se pudo comprobar si son comisarías o intersecciones. Ya está dicho en METODOLOGIA (§ delitos): «una dirección con mucha actividad pesa mucho» |
| Delitos: distrito declarado frente a la geometría | 8 215 de 8 245 caen dentro del distrito que declaran; 2 en otro distrito; 28 declaran un distrito que no es de los 25 y por eso no tienen polígono |
| Cruce de distritos (nombre y ubigeo) frente a `distritos_aqp` | CENEPRED e índice del censo: **25 de 25**, los ubigeos coinciden. Interrupciones: 18 distritos, todos válidos. Acopio: 16, todos válidos. Salud/educación/peligros/minería: todos los nombres válidos salvo fuera de los 25 (Ubinas, Huanca, Vítor y «Santa Rita de Sihuas», escrito así en RENIPRESS). E.030 trae 29 distritos (21 en zona 3 y 8 en zona 4 de la provincia): los 25 del proyecto están, los otros 4 no tienen polígono. Precios: solo Cayma, Yanahuara y Cerro Colorado |
| Cobertura por distrito | Acopio: ninguno en Quequeña, Chiguata, Polobaya, Characato, San Juan de Tarucani, Pocsi, La Joya, Yarabamba, Mollebaya (el directorio solo cubre 16 distritos). Peligros: sin registros en Sachaca, José Luis Bustamante y Rivero, La Joya ni San Juan de Tarucani. Interrupciones: 18 de 25 |
| Zonificación | Los 29 códigos de zona de `zonas_aqp` tienen regla en `reglas_zonas`. El punto de referencia del «Parque Industrial» (config) cae en una bolsa RDM-1; a 300 m al este y al sur ya es I-2 |
| Concesión eléctrica | Solo hay 5 polígonos (4 de SEAL y 1 de Electrosur). El punto de Yura queda **fuera** de toda concesión, a 764 m del borde de la de SEAL, aunque es un poblado servido: ver incidencia 6 |

## 3. Revisión en el navegador

Servidor propio de `dist/main` en el puerto 8431 (ya cerrado), Chrome con un oyente de `error` y `unhandledrejection` en la página. Los módulos de seguridad, desastre y sísmica están **apagados por defecto** (`CONFIG.modulos`) y no se encendieron (activarlos requiere `?modulos=todos` y la herramienta bloqueó esa URL): los tres paneles no se revisaron en pantalla, sus datos sí se revisaron en la sección 2.

| Punto | Distrito y zona | Tarjetas | Observaciones |
|---|---|---|---|
| Plaza de Armas (−16,3988; −71,5370) | Arequipa, ZRE-CH | 20 | Salud 264 m (cumple), consultorio 150 m, acopio a 137 m, ≈ 78 interrupciones al año, concesión SEAL, censo «sin cifras para esta manzana», precio «Sin dato» (el distrito no llega a 30 avisos) |
| Cerro Colorado (−16,3715; −71,5780) | Cerro Colorado, ZA (agrícola: «aquí no se puede construir») | 20 | Precio S/ 4 390 por m² (108 avisos), acopio a 1,16 km, ≈ 162 interrupciones al año, salud a 2,33 km. El punto elegido es periférico: no es el casco urbano |
| Yura (−16,2447; −71,6727) | Yura, fuera del área zonificada | 20 | Dentro de 1 concesión minera; **fuera de concesión eléctrica (a 764 m de SEAL)**; salud 1,20 km; mercado a 7,93 km |
| Parque Industrial (−16,4179; −71,5497) | Arequipa, RDM-1 | 20 | Salud 657 m; mercado 782 m; comercio de barrio 757 m |

En los cuatro: **0 tarjetas con «undefined», «NaN» o «null»**, **0 errores de consola**, todas las tarjetas traen una fuente. Todas traen un año salvo «Ir al trabajo en combi o bus», que es lo esperado (no se ha elegido destino). En los cuatro puntos el censo por manzana dijo «sin cifras» (Plaza de Armas, tierra agrícola, Yura y zona industrial: es plausible; solo el 36 % de las manzanas del INEI tiene viviendas contadas).

**Capas del mapa** (28 botones, en la Plaza de Armas, cada una se encendió y apagó una vez): se dibujan o muestran su leyenda con el recuento esperado las de salud (280), consultorios (194), abastecimiento (120), malls (4), galerías (47), finanzas (145), comida fuera (631), recreación (49), colegios (1 713), paraderos (414), parques (114 de media hectárea o más), concesión eléctrica (5), **puntos de acopio (575)**, zonas del plano (318 / 156 / 43 / 83 / 1), cauces (265 tramos), sismos, minería (319 tituladas, 80 en trámite…), Misti, riesgo CENEPRED de inundación y de movimientos en masa. Qué no se dibujó y por qué:
- **Alumbrado, agua y desagüe del censo:** con el zoom inicial (14) dicen «No pude leer el archivo de censo por manzana (o el mapa abarca demasiados distritos: acerca el mapa a uno o dos), así que no lo dibujo». Con tres niveles más de zoom se dibujan (por ejemplo 2 manzanas con pocas viviendas y 4 899 con 95 % o más en la leyenda de alumbrado). El mensaje junta «error de lectura» y «mapa demasiado amplio»: está bien dicho pero es ambiguo.
- **Ruta al trabajo:** sin destino elegido no hay nada que dibujar (esperado).
- **Los puntos de acopio** (y colegios, comida fuera, paraderos, parques) se dibujan como puntos de lienzo, no como marcadores: por eso el contador de iconos de Leaflet no sube y no se veían con esa prueba. En captura de pantalla los 575 puntos de acopio aparecen como puntos azules.

## 4. Incidencias por gravedad

Ninguna de estas incidencias se corrigió en esta pasada: **no se encontró un error de código claro**; son decisiones, límites de la fuente o pendientes. No hay commits de corrección.

### Alta

1. **SmartBus: permiso solo verbal.** `rutas_smartbus.geojson` (4,8 MB, 241 rutas y 9 301 paradas) se sirve en la web y está en el repositorio con «autorización verbal de SmartBus; confirmación escrita pendiente». La frase viaja con el archivo y se muestra en la ficha, pero si SmartBus retira el permiso no hay nada escrito. Acción: obtener la confirmación escrita o dejar solo `rutas_osm.geojson` (ODbL, 241 rutas del mismo SIT).
2. **Zonificación con vigencia cumplida.** El plano es el PDM 2016-2025 y su vigencia de 10 años se cumplió; hay un PDM nuevo en trámite. La aplicación ya lo avisa en cada resultado, pero es la base de la mayoría de las respuestas (qué se puede construir, zonas en la búsqueda). Está declarado; no hay fuente vectorial oficial más reciente.

### Media

3. **Datos antiguos que se muestran como contexto:** censo 2017 (9 años), acopio 2017 (9), cauces ANA 2018 (8,8). Los tres están rotulados con su año en la ficha. El mapa del Misti no trae fecha de elaboración y no se puede decir de qué edición viene.
4. **Licencias no declaradas o no abiertas** (lista en la sección 1). El caso más delicado es ESCALE: su «Acuerdo de uso de datos» no es una licencia abierta y los 1 508 locales se redistribuyen en `educacion.geojson`. Acción: leer el acuerdo con calma y decidir si basta con la atribución o hay que pedir autorización.
5. **Reproducibilidad.** `peligros_aqp.geojson` no se puede volver a generar con el servicio original (exige token; el servicio público trae 291 de los 394); `zonas_aqp`, `reglas_zonas` y `zonas_sismicas_e030` son manuales. Están documentados (SHA del PDF, validación 99,97 % de coincidencia), pero un cambio del plano obliga a repetir la extracción a mano.
6. **Concesión eléctrica incompleta.** Hay 5 polígonos (SEAL y Electrosur). Yura, un poblado, sale «Fuera de las áreas de concesión · a 764 m del borde de la de SEAL». El texto aclara que no es una conexión, pero puede leerse como «no hay luz». Acción: acotar el mensaje cuando el punto cae fuera («los polígonos publicados pueden estar incompletos») o contrastar con otra fuente.
7. **Precios en 3 de 25 distritos** (Cayma, Yanahuara, Cerro Colorado): el resto sale «Sin dato» por la muestra mínima de 30 avisos; arriendo: 0 avisos. Está dicho en la ficha.
8. **Delitos.** Solo el 49,1 % de las denuncias trae coordenada real; el 27,6 % de las que sí la traen se acumula en 215 puntos repetidos (el mayor, 56). Un mapa de calor sobre eso muestra dónde se geocodifica, más que dónde ocurren los hechos. Está dicho en METODOLOGIA. Además hay 200 puntos (2,4 %) fuera de los 25 distritos que viajan en el archivo sin usarse (1,8 MB en total).

### Baja

9. **Peligros: 34 duplicados (8,6 %)** y sin registros en Sachaca, José Luis Bustamante y Rivero, La Joya ni San Juan de Tarucani: «sin registros» no es «sin peligros» (ya se dice).
10. **Educación: 39 pares ESCALE–OSM a ≤ 25 m**, por diseño (deduplicación por nivel); algunos pueden ser el mismo local.
11. **Interrupciones** llegan hasta abril de 2024 (2,5 años) y 2019 y 2024 son años parciales (se muestran aparte).
12. **Autointersecciones** en 9 zonas del plano y 1 área verde (extracción del PDF): sin efecto en el punto-en-polígono.
13. **Cobertura de `datos:verificar`:** no cubre `equipamiento/osm/*` ni hay una comprobación genérica de caja, finitud, cierre de anillos y `registros`. Esta auditoría lo hizo con scripts descartables.
14. **Capa del censo a zoom amplio:** el mensaje mezcla dos causas (error de lectura y mapa demasiado amplio).
15. **Parque Industrial:** el punto de referencia del destino cae en una bolsa RDM-1 (a 300 m ya es I-2).
16. **Nombres:** `Santa Rita de Sihuas` en RENIPRESS (el distrito es Santa Rita de Siguas); 5 fichas de acopio sin dirección; transporte y comercio de OSM con muchos elementos sin nombre.

## 5. Lo que falta, y por qué

| Dato que falta | Motivo |
|---|---|
| Si un predio concreto tiene conexión de agua o de luz | No está publicado y se asocia al titular del suministro (Ley N.° 29733, Ley de Protección de Datos Personales). Solo se puede pedir el recibo y consultar a SEDAPAR y a SEAL |
| Sectores de abastecimiento y circuitos (R-xx) de SEDAPAR; continuidad del servicio por sector | No hay capa publicada (SEDAPAR no tiene geoportal; el catastro empresarial es interno). Se puede pedir por Ley 27806 (transparencia) a SEDAPAR y a la SUNASS (ámbito de la prestación). Hoy solo hay continuidad por ciudad (23,79 h/día en dic. 2024) |
| Avisos de corte programado de SEDAPAR | Se publican en gob.pe como texto (circuito y zonas) sin coordenadas; habría que geocodificar nombres de urbanizaciones |
| Puntos de acopio vigentes | El directorio es de 2017; el Plan de Gestión Reactiva 2026-2027 (RES 1498-2026) está en PDF escaneado sin capa de texto: requiere OCR o pedido por Ley 27806 |
| Censo 2025 por manzana | Aún no está abierto por manzana (solo agregados departamentales, que sí se usan) |
| PDM nuevo y zonificación en formato vectorial oficial | Solo existe el plano en PDF; el PDM nuevo está en trámite. Se puede pedir a la Municipalidad Provincial (Ley 27806) |
| Catastro predial y propiedad (lote, área, titular) | Registros Públicos (SUNARP) y el catastro municipal son de pago, con sesión o con solicitud; no son datos abiertos |
| Peligros del servicio DGAR de INGEMMET completo y actualizado | El servicio exige token (HTTP 499); pedir acceso o los datos a INGEMMET |
| Precios en más distritos y arriendos | Aptología solo publica cifras con 30 avisos o más; los portales de avisos no tienen licencia abierta |
| Más de la mitad de las denuncias (sin coordenada) y su ubicación exacta | MININTER publica el 82 % de las denuncias con coordenada «cero» o inválida; la ubicación exacta no es pública |
| Paradas oficiales, frecuencias y horarios de la red SIT | OpenStreetMap no trae paradas de estas rutas, las de SmartBus son numeradas, y no hay horarios abiertos; además falta la confirmación escrita de SmartBus |
| Licencias explícitas de INGEMMET, INEI, IGP, ANA, MININTER, CENEPRED, ESCALE y SEDAPAR | Las páginas no las declaran: habría que preguntar a cada entidad |
