# GeoVerificador — Metodología y trazabilidad

> **Alcance vigente: 5 variables** (zonificación vigente, zonificación proyectada, salud, educación por nivel, transporte y área verde; ver §6, §6b y §6c). Los capítulos de desastre, seguridad y gestión de riesgos (§4, §5, §10) describen módulos que siguen en el código pero están ocultos (`CONFIG.modulos`; se ven con `?modulos=todos`).
>
> Cada dato que muestra la aplicación tiene aquí su origen, su transformación, la decisión que lo justifica y su límite.
> Lo que **no** se pudo comprobar está marcado como tal. Cifras consultadas el 2026-10-12 y, para el peligro sísmico y la gestión de riesgos, el 2026-10-13.

## 1. Qué es y qué no es

**Pregunta que responde:** dado un punto en Arequipa metropolitana, *¿qué se puede construir ahí según la norma y qué riesgos documentados hay alrededor?*

**Qué es:** una ficha de riesgos de un predio hecha con datos públicos. Muestra cuatro tipos de riesgo por separado, cada uno con su fuente y sus límites.

**Qué no es:**

- No recomienda dónde comprar ni construir. La decisión es del usuario.
- No da un puntaje ni un semáforo global. No existe una base que justifique cuánto pesa cada riesgo frente a los demás, ni datos para comprobar que una ponderación acierte. Un puntaje con pesos inventados sería información inventada.
- No reemplaza los certificados municipales (el Certificado de Parámetros Urbanísticos y Edificatorios, que emite la municipalidad distrital, y el Certificado de Zonificación y Vías, que emite la municipalidad provincial), ni un estudio de suelos o una evaluación de riesgo.

**Marco:** gestión de riesgos aplicada a un predio. Los factores se agrupan por tipo de riesgo y se comunican uno a uno; el registro de riesgos (§10) los lleva por el proceso identificar → analizar → tratar → dar seguimiento.

| Tipo de riesgo | Pregunta | Fuente | Sección |
|---|---|---|---|
| Normativo | ¿Puedo construir lo que quiero? | Plano y Reglamento del PDM Arequipa 2016-2025 | §3 |
| De desastre | ¿Hay peligros geológicos documentados cerca? ¿Qué zona sísmica le corresponde? | INGEMMET (GEOCATMIN) + zonas de riesgo del plano + Norma E.030 y límites del INEI | §4 |
| De seguridad | ¿Cuántos robos y hurtos se denunciaron cerca? | MININTER / SIDPOL-PNP | §5 |
| De entorno | ¿Hay servicios, transporte y áreas verdes cerca? | RENIPRESS (salud) y ESCALE (colegios), con OpenStreetMap de respaldo; OpenStreetMap (paraderos y áreas verdes) | §6 |

## 2. Cómo se calcula «cerca»

- Distancia entre dos puntos: fórmula de **haversine** con radio medio terrestre de 6 371 008,8 m (`public/js/geo.js`).
- Radio de peligros y de denuncias: **500 m** (`CONFIG.peligros.radio`, `CONFIG.delitos.radio`). Es un valor de trabajo (unas cinco cuadras), no un umbral con base empírica; se puede cambiar en `public/js/config.js`.
- El código del navegador se contrasta con una fórmula independiente (ley esférica de los cosenos) en `scripts/verificar-datos.mjs`; ver `VALIDACION.md`.

## 3. Riesgo normativo: zonificación

**Fuente y marco legal.**

- Plano de Zonificación y Reglamento del Plan de Desarrollo Metropolitano (PDM) de Arequipa 2016-2025, de la Municipalidad Provincial de Arequipa (MPA) e IMPLA.
- **El IMPLA.** El Instituto Municipal de Planeamiento de Arequipa se creó por la Ordenanza Municipal 875, del 3 de julio de 2014, como organismo público descentralizado de la MPA responsable del planeamiento territorial (lo dice la Resolución de Directorio N.° 014-2025-DIR.IMPLA, publicada en El Peruano, en sus considerandos; no se leyó el texto de la 875).
- **Ordenanzas (leídas del texto de la Ordenanza 975, que el equipo aportó).** Sus considerandos dicen: «mediante Ordenanza Municipal 961, del 03 de febrero de 2016, se aprueba el Plan de Desarrollo Metropolitano de Arequipa, PDM Arequipa 2016-2025». La Ordenanza 975, aprobada por el Concejo Municipal en sesión del 29 de abril de 2016 (el cargo de trámite del documento lleva el sello del 17 de mayo de 2016), se titula «Restitución de zonificación urbana y desarrollo de secciones viales metropolitanas en el PDM Arequipa 2016-2025». Explica que, al aplicar el PDM, se detectaron «imprecisiones gráficas y/o omisiones de zonificación en predios que en el Plan Director […] 2002-2015 figuraban en áreas urbanas» y dispone restituir la zonificación de los predios del Anexo 01, **actualizando el Plano 2.2 de Zonificación y el Plano 2.4 de Expansión Urbana** (y los planos viales 2.3 y 2.3.1 con el Anexo 02). Aclara además que, conforme al D.S. 004-2011-VIVIENDA, la ordenanza «no incurre en causal de modificación» del PDM. Es decir: la **961 aprueba el PDM** y la **975 corrige su plano de zonificación**; el plano que usa la aplicación debe ser el Plano 2.2 tal como quedó tras la 975. (Esto último es lo declarado por el equipo: se trabajó con el plano publicado con la 975.)
  - **Verificación del número de ordenanza (2026-11-09).** El PDM 2016-2025 se aprobó por la **Ordenanza 961**, no por la 975. La 975 restituye zonificación y secciones viales de ese plan, y el plano PDF que usa la herramienta se publicó con ella (por eso el archivo se llama «…OM975…»). Coincide con fuentes externas: la Resolución de Directorio N.° 014-2025-DIR.IMPLA cita la «Nº 961, del 03 de febrero de 2016», y un índice de anexos de la UNESCO (`whc.unesco.org/document/165255`) lista «Ordenanza 961 - PDM 2016-2025» con una referencia de La República del 5 de febrero de 2016. No se encontró en línea el texto de la 975; solo se leyó el que aportó el equipo.
  - **Una versión contraria quedó descartada.** El resumen de una búsqueda sobre un comunicado del IMPLA de agosto de 2025 (la página no se pudo abrir) describía las ordenanzas 961 y 975 como cambios de zonificación solo para proyectos de salud. El texto de la 975 lo contradice (restituye zonificación residencial, comercial e industrial de varios predios y corrige vías). No se sabe de dónde viene esa descripción; no se usa.
  - **No leído:** el texto de la Ordenanza 961. El archivo que aportó el equipo es un escaneo sin texto y en este equipo no hay herramienta de OCR; su fecha y su objeto se toman de lo que cita la 975. El Anexo 01 de la 975 (tabla de predios restituidos) también es un escaneo de baja calidad y no se transcribió.
- **Vigencia.** El Título Preliminar del Reglamento (portal de transparencia de la MPA, documento fechado en 2016) establece: «La vigencia del presente Plan se establece en diez (10) años […], debiendo procederse posteriormente a su revisión o actualización.» Un PDM nuevo está en consulta pública: la página de la MPA indica que la etapa inició el 13 de octubre de 2025 y terminó el 11 de diciembre de 2025.

**Cómo se obtuvo cada archivo.**

| Archivo | Procedimiento | Verificación |
|---|---|---|
| `zonas_aqp.geojson` (793 polígonos, EPSG:4326) | Declarado por el equipo: polígonos extraídos del PDF vectorial del plano con QGIS; el código se asignó por el **color de relleno** usando la leyenda. | **Validado contra el PDF oficial** (ver «Validación contra el PDF oficial del plano»): re-extraídos de forma independiente, 793 rellenos = 793 polígonos con el mismo número en cada uno de los 29 códigos y colores idénticos; 99,970 % de coincidencia en 13 255 puntos al azar; la etiqueta impresa de cada polígono coincide con la zona de la app en el 98,1 % (el resto, a ≤ 97 m de su propio polígono). |
| `reglas_zonas.json` (29 códigos) | Transcripción del Título III del Reglamento. | **Contrastada** contra el texto del Título III (ver abajo). 29 de 29 coinciden. |

**Contraste de las reglas con el Reglamento (hecho el 2026-10-12).** Se extrajo el texto del Título III, Cap. 1 «Zonificación y compatibilidades» (16 páginas; la copia que se pudo leer está alojada por la Municipalidad Distrital de Yanahuara: `https://muniyanahuara.gob.pe/wp-content/uploads/2021/01/4_1_tituloIII_1_zonificacion-y-compatibilidades.pdf`, PDF creado el 2016-02-08) y se comparó con `reglas_zonas.json`:

| Grupo | Códigos | Resultado |
|---|---|---|
| Residencial | RDB, RDM-1, RDM-2, RDA-1, RDA-2, I1R | Lote mínimo, frente, pisos, coeficiente y área libre coinciden en las 6 (incluidos los casos con «(*)» para vías mayores a 18 m o frente a parques y el conjunto residencial de RDA-2). |
| Comercial | CE, CS, CZ, CIn, CM | Coeficientes (4,0; 4,0; 5,5; 4,0; 7,0) y lotes (450 m² en CE y CIn; «resultado del diseño» o «existente» en los demás) coinciden. Altura = 1,5 × (ancho de vía + retiros). |
| Industrial | I-1, I-2 | Lote 300 / 1 000 m², frente 10 / 20 m coinciden; altura «según proyecto», por eso no hay coeficiente. |
| Equipamiento | E, H, OU1, OU2 | El Reglamento los remite a la zonificación comercial o residencial predominante del entorno: coincide. |
| Especiales y riesgo | ZR, ZRE-CH, ZRE-PP, ZRE-PA, ZRE-PN, ZRE-RU, ZRE-RI1, ZRE-RI2, ZM, ZAQ, RP, ZA | ZR máx. 5 % construido; ZRE-PP 1,85 y 2,30, 40 % libre, lote 300 m²; ZRE-RI1 sin obras nuevas ni cambios de uso; ZRE-RI2 no urbanizable ni edificable; ZRE-CH/PA/PN/RU a plan específico; ZM y ZAQ a normas del Ministerio de Cultura; ZA no edificable. Todo coincide. |

Observaciones del contraste:

- Una **discrepancia interna del Reglamento**: para RDA-1 con frente a vía mayor a 18 m, la ficha de la zona dice coeficiente 4,20 y el cuadro resumen dice 3,50. El repositorio usa 4,20 (la ficha de la zona) y lo advierte en la nota de la regla.
- El Reglamento escribe «ZRE-RE» en una fila donde el plano usa «ZRE-RU» (errata del documento).
- En RDA-1 y RDA-2 el área libre mínima crece 5 puntos por cada piso adicional respecto de la altura base (hasta un máximo de 70 %); la tabla del repositorio guarda los valores de los casos base y del caso máximo que lista el Reglamento.
- **Contraste con el documento oficial (hecho el 2026-10-12).** El equipo aportó el archivo «MEMORIA PLAN 2016-2025 CAPITULO 4.pdf» (mismo nombre que el publicado en el portal de la MPA/IMPLA): es el Capítulo IV de la Reglamentación del PDM, con el Título Preliminar, el Título II y el Título III de zonificación, impreso con el encabezado de la MPA e IMPLA. Se comparó con la copia usada arriba: **los 201 valores numéricos (m², ml, pisos, %, coeficientes, hab/ha) de la copia aparecen, con su multiplicidad, en el documento oficial (0 faltantes)**. Como `reglas_zonas.json` coincide con la copia, queda contrastado con el documento oficial. Límite: la comparación es de valores numéricos, no de cada palabra del texto.
- Las dos copias que se habían usado (Yanahuara y Yura) son idénticas byte a byte (MD5 `90256c11ac9a79870e9c9f466db5db6f`): un único documento alojado en dos sitios.

**Validación contra el PDF oficial del plano (hecha el 2026-10-12).** El equipo aportó el plano «ZONIFICACION_PDM_2016_2025_OM975 (1).pdf» (16,1 MB; SHA-256 `3d7b899d0ab472ed426048e1425c9f95c6a3b120be20ff116b1e34049abea27b`). Es una exportación de **Esri ArcMap 10.1** creada el **2016-05-18** (posterior a la sesión del Concejo del 29 de abril de 2016 de la Ordenanza 975, con la que concuerda el nombre del archivo), de una sola página, **georreferenciada** (el PDF lleva los puntos de control `/GPTS` y el sistema WGS 84 UTM zona 19S). Los polígonos son rellenos vectoriales de color (832 rellenos, de los cuales 793 son zonas y el resto muestras de la leyenda), con una etiqueta de texto por polígono. El script `scripts/validar-zonificacion-plano.mjs` **re-extrae esos polígonos y etiquetas directamente del PDF** (sin QGIS ni el GeoJSON) y los compara con `zonas_aqp.geojson`:

| Comprobación | Resultado |
|---|---|
| Georreferenciación del PDF | Las cuatro esquinas del marco forman un rectángulo UTM 19S alineado al metro (E 214 216–238 146, N 8 165 133–8 201 590; 9,704 m por punto). La cuadrícula impresa en el propio plano coincide con esa georreferenciación: Este dentro de 4 m (mediana 2,9 m); Norte con un desfase constante de ≈ 25 m (texto rotado y anclado; dispersión de 4,8 m). |
| Colores | Los 29 colores del GeoJSON existen en el PDF y son idénticos: el color del GeoJSON viene del plano. |
| Número de polígonos | **793 en el PDF y 793 en el GeoJSON; el mismo número en cada uno de los 29 códigos.** |
| Área por código | La diferencia es de −0,22 % a −0,24 % en **todos** los códigos (uniforme). Esa constante sale de comparar metros de cuadrícula UTM con un cálculo en tierra esférica, no de los datos: si hubiera polígonos distintos, la diferencia variaría entre códigos. |
| Puntos al azar | En 30 000 puntos dentro del marco, 13,255 tenían zona en el PDF o en la app; **coinciden 13,251 (99.970 %)**. Ningún punto fue pintado por el PDF y omitido por la app, ni al revés. Los 4 desacuerdos son puntos junto a un borde. |
| Etiquetas impresas | Hay 793 etiquetas de zona (una por polígono). La zona que la app devuelve en la posición de la etiqueta coincide con el texto impreso en 778 de 793 (98.1 %); las 15 restantes están a 6–97 m del polígono de su propio código (el centro de la etiqueta se estima de forma aproximada y las de polígonos pequeños quedan junto al borde). Esto es evidencia independiente de que la asignación de código por color es correcta: las etiquetas las escribió el cartógrafo. |
| Superficie | 38 144 ha en el PDF (cuadrícula UTM) frente a 37 107 ha de área urbana en la Memoria oficial: +2,8 %. |
| Discrepancias con OpenStreetMap | De los 1 148 lugares de OSM que quedaron fuera de la zona esperada (hospitales, universidades y parques), el plano oficial pinta **la misma zona que la app en 1 147**. Es decir: ninguna es un error de digitalización del equipo; es lo que dice el plano (o un lugar mal ubicado en OSM). |

**Qué demuestra y qué no.** Demuestra que `zonas_aqp.geojson` reproduce fielmente el plano del PDF aportado: mismas formas, mismos colores, mismo número de polígonos, misma georreferenciación y misma zona en el 99,97 % de los puntos. Con eso, el procedimiento de extracción que declaró el equipo queda **comprobado por un camino independiente**. **No demuestra** que ese PDF sea la última versión oficial vigente (el PDF lo aportó el equipo; no se descargó del portal), que el plano sea correcto frente a la realidad legal de un predio (para eso están los certificados, `VALIDACION.md` §3.1) ni qué pasa con modificaciones posteriores a mayo de 2016 (un resumen no leído de un comunicado del IMPLA de agosto de 2025 dice que no tiene expedientes de modificación de zonificación; no se pudo verificar).

**Un detalle del archivo.** Nueve polígonos grandes (`ZRE-RI2` ×5, `RP` ×2, `ZA` ×1 y `ZAQ` ×1) cruzan el borde del marco impreso: el PDF los dibuja completos y recorta lo que sobresale, y el GeoJSON conserva su forma completa (hasta unos 1,2 km más allá del marco). En 59 202 puntos claramente fuera del marco (a más de unos 500 m de su borde, dentro de la caja de la aplicación) la app devolvió zona en solo 26 (0,04 %), siempre `ZRE-RI2` o `RP`. Es un efecto pequeño, pero ese tramo no aparece en el plano impreso; está declarado en las limitaciones de la aplicación.

**Qué se calcula en la aplicación.**

- Zona del punto: punto-en-polígono (ray casting), con huecos y multipolígonos. Si dos polígonos se superponen, gana el último del archivo (el que el plano dibuja encima).
- Potencial constructivo (si el usuario escribe el área del lote):
  - m² techados = área del lote × coeficiente de edificación (base y máximo).
  - m² del primer piso = área del lote × (1 − área libre mínima).
- Solo se calcula en zonas con `edificable = "si"` y coeficiente numérico. En zonas condicionadas o no construibles no se calcula nada y se explica por qué. `I-1` e `I-2` son «si» pero su altura es «según proyecto» y no tienen coeficiente, así que tampoco se calcula.

**Por qué así.** La tabla de reglas es normativa y verificable contra el documento, por eso es el eje de la ficha. Se prefirió no calcular cuando la norma no fija un coeficiente, antes que suponer uno.

**Estado legal del plan (importante para un inversor).**

- **Sentencia.** La Sentencia de Vista N.° 183-2019 (4 de diciembre de 2019, Primera Sala Penal de Apelaciones de la Corte Superior de Justicia de Arequipa, expediente 04567-2017-97-0401-JR-PE-01) dispuso la suspensión de todo acto administrativo que implique ejecutar el PDM 2016-2025 en cuatro puntos: (1) certificados de zonificación y vías para habilitaciones urbanas y planes específicos en predios que en el PDM 2002-2015 eran zona agrícola (AA) o reserva paisajista (RP); (2) la compatibilidad de la zona agrícola con usos distintos (ZR, OU, residencial); (3) planes específicos y habilitaciones sobre esos mismos predios; (4) la delimitación del centro histórico y su zona de amortiguamiento conforme a la OM 115-2001. La suspensión rige «hasta que la Municipalidad Provincial de Arequipa tome las medidas necesarias para la revisión del PDM 2016-2025». Fuente: presentación del Colegio de Arquitectos del Perú que transcribe el fallo (`https://www.caa.org.pe/wp-content/uploads/2024/12/050525-Presentacion-Patricia-Prietro-FINAL-HOY.pdf`); no se leyó la resolución original.
- **Evidencia posterior (todo de fuentes secundarias; no se pudo abrir ninguna página del IMPLA, que devolvió «no encontrado», ni la resolución original):**
  - Informe de la Contraloría del 13 de junio de 2024: se emitieron certificados de zonificación a predios de zona agrícola y reserva paisajista en 2020, 2021 y 2022, es decir, **después** de la sentencia (según notas de prensa de El Búho y Diario Correo).
  - El IMPLA reportó 77 pronunciamientos que no se ajustan del todo a la sentencia y 7 certificados en proceso de nulidad (sin fecha en la fuente).
  - Mayo de 2025: el IMPLA abrió un formulario para recopilar información con fines de análisis de la sentencia (título de la página, vista solo en el resultado de una búsqueda).
  - Octubre de 2025 (La Prensa Regional): tras años de litigio, la actualización del plan seguía pendiente.
  - **Último dato localizado: de 2025. No se encontró ningún dato de 2026.**
- **No verificado:** si la suspensión sigue vigente hoy. Para saberlo hay que consultar a la Corte Superior de Justicia de Arequipa (el expediente judicial figura como 04567-2017-97-0401-JR-PE-01), a la MPA o al IMPLA.
- **Consecuencia para la ficha:** la aplicación no sabe qué predios eran agrícolas o de reserva paisajista en el plan anterior, así que no puede avisar del caso. Se muestra la limitación y se remite al IMPLA.

**Límites** (también visibles en la aplicación):

- El plano tiene vigencia de 10 años desde 2016 y hay un PDM nuevo en trámite; no incluye planes específicos posteriores.
- El código se asignó por color, y esa asignación quedó respaldada por las etiquetas impresas del plano (98,1 % de coincidencia exacta y el resto a ≤ 97 m, ver arriba). Aun así, cerca del borde entre dos zonas el resultado puede ser el de la zona vecina. El plano pinta con el mismo color varios niveles de `E` y `H`, y la zona agrícola con la de expansión agrícola (`ZA`).
- En zonas comerciales la altura depende del ancho de la vía; no se calcula un número fijo de pisos.
- Los m² son un máximo teórico: no consideran retiros, estacionamientos ni forma del lote. El Reglamento excluye del coeficiente los estacionamientos, circulaciones comunes, casa de máquinas y sótanos, así que la superficie total construida puede ser mayor que la que muestra la app.
- Solo el Certificado de Zonificación y Vías que emite el IMPLA tiene valor legal.

## 4. Riesgo de desastre: peligros geológicos

**Fuente.** Capa «Peligro Geológico» de GEOCATMIN (INGEMMET), servicio
`https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/DGAR/SRV__PELIGRO__GEOLOGICO/MapServer/0` (35 932 registros en todo el país; 394 en Arequipa metropolitana).
Descarga: `node scripts/descargar-peligros.mjs` → `public/data/peligros_aqp.geojson` (el archivo congelado es del 2026-10-12).

**Cambio de servicio (2026-11-02).** El servicio DGAR **ya responde HTTP 200 con `{"error":{"code":499,"message":"Token Required"}}`** [INVESTIGACION-VARIABLES.md §1, punto 4]. El script apunta ahora al servicio público `https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_PELIGROS_GEOLOGICOS/MapServer/0` (mismos campos `TIP_PELIGRO`, `NOM_PELIGRO`, `NM_*`, `FECHA`, `FUENTE`; los diccionarios se leen de los dominios de la capa). **Ese servicio solo trae los movimientos en masa: 291 registros, todos ya incluidos en el archivo congelado con las mismas coordenadas.** Faltan los 103 de erosión (fluvial y de ladera), inundación fluvial y arenamiento. Por eso **se conserva el archivo congelado de 394 registros** y el script no lo sobrescribe si recibe menos registros (salvo con `--forzar`); `metadata.nota` lo explica. El servidor de INGEMMET no envía su certificado intermedio: se ejecuta con `node --use-system-ca scripts/descargar-peligros.mjs` (no se desactiva la verificación TLS).

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
- **No cubre** el peligro volcánico (Misti), la licuación de suelos ni el tsunami: no se incorporó ninguna capa pública utilizable. Esto es un hueco declarado de la ficha, no una conclusión de que no existan. El peligro sísmico se cubre a escala de distrito (ver abajo).

**Peligro sísmico (añadido el 2026-10-13).**

- **Fuente de la zona sísmica.** Norma Técnica **E.030 Diseño Sismorresistente 2026** del Ministerio de Vivienda, Construcción y Saneamiento, descargada de gob.pe (`https://cdn.www.gob.pe/uploads/document/file/9902957/8081915-nt-e-030-diseno-sismorresistente-2026.pdf`; firmas digitales del 28/04/2026). Se usan el Art. 10 (el territorio se divide en cuatro zonas; el Anexo II lista los distritos de cada una), el Art. 11 y la Tabla N.° 1 (Z = 0,45 / 0,35 / 0,25 / 0,10 para las zonas 4 / 3 / 2 / 1). Definición textual del Art. 11.1: Z «representa la aceleración máxima horizontal en suelo rígido con una probabilidad de 10% de ser excedida en 50 años», expresada como fracción de la gravedad.
- **Transcripción del Anexo II para la provincia de Arequipa** (`public/data/zonas_sismicas_e030.json`): 21 distritos en **zona 3** (Alto Selva Alegre, Arequipa, Cayma, Cerro Colorado, Characato, Chiguata, Jacobo Hunter, José Luis Bustamante y Rivero, Mariano Melgar, Miraflores, Mollebaya, Paucarpata, Pocsi, Quequeña, Sabandía, Sachaca, San Juan de Tarucani, Socabaya, Tiabaya, Yanahuara y Yura) y 8 en **zona 4** (La Joya, Polobaya, San Juan de Siguas, Santa Isabel de Siguas, Santa Rita de Siguas, Uchumayo, Vítor y Yarabamba). La tabla del PDF se extrajo en modo tabla y se contó: 21 + 8 = 29 distritos, todos los de la provincia.
- **Fuente de los distritos.** Capa «Distritos» del servicio `SERV_CARTOGRAFIA_DEMARCACION_WGS84` de GEOCATMIN (INGEMMET); el campo de fuente de cada distrito dice «OFICIO N° 006099-2024-INEI/DNCE» (fecha de ingreso 26/12/2024). Descarga: `node scripts/descargar-distritos.mjs` → `public/data/distritos_aqp.geojson` (25 distritos que tocan la caja de Arequipa metropolitana). El script falla si algún distrito no tiene zona en la transcripción.
- **Qué se calcula.** Distrito del punto (punto-en-polígono) → zona y Z según la tabla. Se muestra en la sección de desastre, en el resumen y como riesgo D3 del registro.
- **Límites.** La zona es regional: no considera el suelo del predio, que puede amplificar el movimiento; la E.030 exige a todo proyecto de edificación un Estudio de Mecánica de Suelos o un Informe Técnico de Suelos (Art. 16.1). Cerca de un límite distrital el distrito puede no ser exacto. Si la E.030 se actualiza, hay que revisar la transcripción.

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

## 6. Servicios: salud, educación, transporte y área verde (V2 a V5)

**Fuente.** Desde la validación K2 (`docs/VALIDACION.md` §3.4), que mostró que OpenStreetMap no alcanza el 85 % de exhaustividad ni de precisión, **salud y educación usan los registros oficiales como fuente primaria y OpenStreetMap como respaldo**:

- **Salud: RENIPRESS** (Superintendencia Nacional de Salud, SUSALUD), CSV de `datosabiertos.gob.pe` (licencia Open Data Commons Attribution, ODC-By).
- **Educación: padrón de instituciones educativas de ESCALE** (Unidad de Estadística del MINEDU), `Padron_web.dbf` dentro de `Padron_web_AAAAMMDD.zip`. Sin licencia abierta declarada (§6.4).
- **Respaldo: OpenStreetMap** (ODbL), extraído con `pnpm datos:extraer` (`scripts/extraer-equipamiento.mjs`: una consulta a Overpass para la caja de Arequipa metropolitana, con reintentos y un espejo de respaldo) y guardado tal cual, sin fusionar, en `public/data/equipamiento/osm/{salud,consultorios,educacion}.geojson` (la copia anterior traía los consultorios dentro de `salud.geojson`; `pnpm datos:oficial` acepta las dos formas y los reparte con `Calculos.categoriaSalud`). De ahí también salen, en `public/data/equipamiento/{transporte,areas_verdes}.geojson`, los paraderos y las áreas verdes, que siguen siendo solo de OpenStreetMap.

`pnpm datos:oficial` (`scripts/descargar-equipamiento-oficial.mjs`; lógica y pruebas en `scripts/lib/equipamiento-oficial.js` y `test/equipamiento-oficial.spec.ts`) descarga las dos ediciones más recientes (con una pausa entre solicitudes, reintentos y una caché local fuera del repositorio), aplica las reglas de §6.1 a §6.3 y escribe `public/data/equipamiento/{salud,consultorios,educacion}.geojson`, que son los archivos que lee la aplicación. Si una descarga falla, no escribe nada y dice el error exacto. Cada archivo trae `metadata` con las fuentes (dirección, fecha, licencia), el conteo por fuente, las reglas y los descartes; cada elemento trae `fuente` (`RENIPRESS`, `ESCALE` u `OSM`) y su código oficial (`codigo_renipress`, `codigo_modular`). La aplicación solo consulta Overpass en vivo, alrededor del punto, si falta un archivo, y lo dice en el método del resultado. Las etiquetas de OpenStreetMap de cada variable están en `Calculos.FILTROS` (`public/js/calculos.js`); la misma definición sirve para consultar, clasificar y documentar en pantalla.

**Qué se calcula.** Para el punto elegido, el elemento más cercano de cada variable (distancia en línea recta, haversine con R = 6 371 008,8 m) y su veredicto contra el umbral: `CUMPLE` (distancia ≤ umbral), `NO CUMPLE` o `SIN DATO` (no hay elementos en los datos). El consultorio médico es la excepción: sin umbral (`null`), su estado es `INFORMATIVO` (o `SIN DATO`) y solo se da el más cercano y su distancia.

| Variable | Elementos (fuente primaria; etiquetas de OSM del respaldo) | Umbral | Origen del umbral |
|---|---|---|---|
| V2 Salud | RENIPRESS, categorías I-1 a III-E, **sin consultorios médicos** (§6.1); respaldo: `amenity=hospital, clinic` y `healthcare=*` salvo `doctor` | 1000 m | Convención del proyecto |
| C1 Consultorio médico (informativo) | RENIPRESS, clasificación «consultorios» (§6.1); respaldo: `amenity=doctors` y `healthcare=doctor` | Ninguno: decisión pendiente | `CONFIG.umbrales.consultorio` es `null` y `CONFIG.fuentesUmbral.consultorio` lo dice |
| C2 Mercado de abastos (informativo) | `amenity=marketplace` de OpenStreetMap (§6.5) | Ninguno: decisión pendiente | `CONFIG.umbrales.mercado` es `null`; propuesta: ninguna verificada en metros (§6.5.6) |
| C3 Supermercado (informativo) | `shop=supermarket` de OpenStreetMap (§6.5) | Ninguno: decisión pendiente | `CONFIG.umbrales.supermercado` es `null` (§6.5.6) |
| C4 Mall (informativo) | `shop=mall` y terrenos o edificios comerciales con nombre de mall, de OpenStreetMap, con la lista curada de malls confirmados con su fuente; distancia al borde del polígono (§6.5) | Ninguno: decisión pendiente | `CONFIG.umbrales.mall` es `null` (§6.5.6) |
| V3 Educación inicial | ESCALE, niveles `A1`, `A2` y `A3` (§6.2); respaldo: `amenity=kindergarten`; `amenity=school` con `isced:level=0` o `school=kindergarten` | 500 m | MINEDU, numeral 7.1, Cuadro N.° 1 (RVM 104-2019 para inicial; RVM 208-2019 para primaria y secundaria; distancias referenciales) |
| V3 Educación primaria | ESCALE, nivel `B0`; respaldo: `amenity=school` con `isced:level=1` o `school=primary`; sin etiqueta de nivel | 1500 m | ídem |
| V3 Educación secundaria | ESCALE, nivel `F0`; respaldo: `amenity=school` con `isced:level=2 o 3` o `school=secondary`; sin etiqueta de nivel | 3000 m | ídem |
| V4 Transporte | `highway=bus_stop`, `public_transport=platform, stop_position` | 400 m | Convención del proyecto |
| V5 Área verde | Polígonos `leisure=park, garden`, `landuse=recreation_ground` | al menos 5000 m² a 300 m | Indicador básico de la OMS Europa (2016), informe «Urban green spaces and health», p. 39 (indicador de monitoreo, no norma peruana) |

**Decisiones que la fuente no resuelve.**
- Las reglas de selección y de unión de los registros oficiales están en §6.1 a §6.4.
- Salud y consultorio son dos categorías también en OpenStreetMap (`Calculos.FILTROS`, `Calculos.categoriaSalud`): `amenity=doctors` y `healthcare=doctor` son consultorios; `amenity=hospital`, `amenity=clinic` y el resto de `healthcare=*` son salud. Si un elemento es a la vez clínica u hospital y `healthcare=doctor`, manda el establecimiento (no se cuenta dos veces).
- En el respaldo de OpenStreetMap, `healthcare=*` incluye farmacias, laboratorios y consultas de una sola especialidad; se excluyen `pharmacy`, `optometrist`, `alternative`, `blood_donation`, `laboratory`, `sample_collection`, `dentist`, `physiotherapist`, `occupational_therapist`, `psychotherapist`, `speech_therapist`, `audiologist`, `podiatrist` y `doctor` (este último es un consultorio, no un establecimiento), que no son centros de atención general.
- OSM casi no etiqueta el nivel de los colegios (los locales de ESCALE sí dicen el suyo). Un `amenity=school` sin `isced:level` ni `school` es candidato a primaria y secundaria (no a inicial; los jardines se mapean como `kindergarten`); uno etiquetado solo con `isced:level` ≥ 4 (superior mal etiquetada) no cuenta. Esa regla puede sobrestimar la oferta de un nivel (`Calculos.nivelesEducativos`).
- Área verde: el área de cada polígono es geodésica (esfera de R = 6 371 008,8 m, fórmula de Chamberlain y Duquette) y la distancia es hasta su borde más cercano, 0 si el punto está dentro (proyección local plana, error de milímetros a 300 m). Se informa también si hay una de al menos 1 ha a 300 m (sensibilidad). Las relaciones multipolígono se ensamblan a partir de sus miembros; si el contorno exterior no cierra, se descartan.
- Salud, educación y transporte se guardan como puntos (nodo, o centro de la vía o relación): la distancia a un hospital mapeado como edificio es al centro.

**Límites.** Los registros oficiales no son completos: RENIPRESS no trae las coordenadas de cerca del 42 % de los registros de Arequipa (no pueden ubicarse) y ESCALE da la ubicación del local que reportó la UGEL. OSM es colaborativo: lo ausente puede existir y `SIN DATO` significa que no está en el archivo. Los datos no se actualizan solos (fecha de extracción en cada resultado). Distancia en línea recta, no recorrido. Los umbrales de salud, transporte y borde de zona son convenciones del proyecto, no normas.

### 6.1 Salud y consultorios: qué registros de RENIPRESS cuentan

Se parte del CSV de RENIPRESS (36 246 filas en la edición del 2026-10-30; ver `metadata.descartes_oficial` del archivo para los conteos de cada corrida). Un registro cuenta si cumple **todo** esto:

1. `ESTADO` = `ACTIVO`. Cualquier otro valor (`BAJA DEFINITIVA`, `BAJA PROVISIONAL`, `CIERRE TEMPORAL DE OFICIO` o de parte) o vacío queda fuera.
2. Departamento y provincia `AREQUIPA`.
3. Coordenadas: `NORTE` es la latitud y `ESTE` la longitud, **en grados decimales** (el script comprueba que todos los valores lo sean; si fueran metros UTM rechaza el archivo). El punto debe caer dentro de algún polígono de `public/data/distritos_aqp.geojson` (INEI vía GEOCATMIN). Los registros sin coordenadas no pueden ubicarse y no cuentan.
4. `TIPO_ESTABLECIMIENTO` es `ESTABLECIMIENTO DE SALUD CON INTERNAMIENTO` o `SIN INTERNAMIENTO`: es atención de salud para quien vive cerca. El `SERVICIO MÉDICO DE APOYO` (laboratorios de patología clínica, diagnóstico por imágenes, hemodiálisis, ópticas, traslado de pacientes, rehabilitación y similares, categoría 0) **no** cuenta.
5. `CATEGORIA` es `I-1`, `I-2`, `I-3`, `I-4`, `II-1`, `II-2`, `II-E`, `III-1`, `III-2` o `III-E` (categorías de los establecimientos de salud de la norma técnica del MINSA, NTS 021-MINSA/DGSP-V.03). Sin categoría válida no cuenta.
6. No es un centro odontológico (`CLASIFICACION` = `CENTRO ODONTOLOGICO`): atiende una sola especialidad, y el respaldo de OpenStreetMap también excluye `healthcare=dentist`. Tampoco cuenta si su nombre es solo dental (regla del nombre dental, más abajo).

**Consultorio médico: categoría aparte (decisión del 2026-11-10).** Los registros que pasan los seis criterios anteriores se reparten en **dos categorías** (`clasificarSalud` en `scripts/lib/equipamiento-oficial.js`, campo `grupo`):

- **Consultorio:** la `CLASIFICACION` de RENIPRESS contiene CONSULTORIO («CONSULTORIOS MEDICOS Y DE OTROS PROFESIONALES DE LA SALUD»; categorías I-1, I-2 y, en un caso, I-3). Si el registro no trae clasificación (2 casos en la edición del 2026-10-30), decide el nombre: lo contiene CONSULTORIO. Un nombre con «dental» o «dentista» sin clasificación sigue siendo odontológico y no cuenta (1 caso). **La categoría I-n sola no decide**: hay puestos de salud I-1 e I-2 que siguen siendo salud. Con clasificación, el nombre no cuenta («Policlínico con consultorios» es un policlínico).
- **Salud:** todo lo demás (hospitales y clínicas de atención general y especializada, centros de salud y centros médicos, puestos y postas, policlínicos, institutos, centros con internamiento).

Los consultorios van en `public/data/equipamiento/consultorios.geojson` y la salud en `salud.geojson`, con las mismas propiedades de siempre (no se quitó ninguna). La deduplicación con OpenStreetMap es **por categoría**: un elemento de OSM se descarta solo si hay un punto oficial **de la misma categoría** a 200 m o menos (`fusionarSaludPorGrupo`); una clínica de OSM junto a un consultorio oficial se queda en salud, y un consultorio de OSM junto a un hospital oficial se queda en consultorios. Con la edición del 2026-10-30: **salud 280** (RENIPRESS 256 + OpenStreetMap 24) y **consultorios 194** (RENIPRESS 162 + OpenStreetMap 32; antes de excluir los dentales por nombre eran 268 = 237 + 31), y 1 centro dental sin clasificación que antes entraba y ahora no cuenta (493 registros de RENIPRESS en total frente a 494).

**Lo odontológico de OpenStreetMap no cuenta (2026-11-10).** Un elemento de OSM no entra en la salud ni en los consultorios si es dental (`Calculos.esDental`): `amenity=dentist`, `healthcare=dentist`, `healthcare:speciality` con dentistry, o un nombre con «dental», «odontolog…» o «dentist…» sin distinguir mayúsculas ni tildes. El nombre hace falta porque un consultorio dental suele mapearse como `amenity=doctors` sin más etiquetas. En la copia del 2026-10-28 afecta a 1 elemento (un policlínico odontológico etiquetado `amenity=clinic`). Regla del nombre dental (2026-11-10, decisión de la persona responsable): además del tipo, un registro de RENIPRESS no cuenta ni como salud ni como consultorio si su **nombre** es dental, con la misma regla de OpenStreetMap (`Calculos.esDental`: «dental», «odontolog…» o «dentist…», sin distinguir mayúsculas ni tildes; función `esNombreDental` de `scripts/lib/equipamiento-oficial.js`, que usan también `pnpm datos:oficial` y K2), **salvo** que el nombre diga además medicina, médico/a, hospital, centro/puesto/posta de salud, especialidades o multiespecialidad («Policlínico X - Medicina y Odontología» se queda). «Clínica», «policlínico» y «salud» solas no bastan para quedarse («Clínica Odontológica del Sur», «Consultorio Dental Characato Salud» salen). Con la edición del 2026-10-30 salen 75 consultorios (237 pasan a 162) y ningún establecimiento de salud; ningún nombre dental era multiespecialidad, así que la excepción no quitó ninguno. Quedan sin cubrir 16 nombres con raíz dental que el patrón no reconoce («ODONTO MEDICC», «ODONTO MONTESINOS», «FACE DENT», «Belldent», «DENTASIA», «DENTAMIA», «NOVA DENT», «Kova Dent», «PLUS DENT IMPLANT», «ROCA DENT¨S», «FIMAHO DENT´S», «ChimuDent», «DENTRICS», «DENTA VITALIS E.I.R.L.», «SMILE DESIGN AQP», «mil sonrisas» y similares); ampliar el patrón cambiaría también la regla de OpenStreetMap y queda como decisión pendiente.

El consultorio es **informativo**: no hay una fuente que fije una distancia de referencia y el valor es una decisión pendiente de la persona responsable del proyecto. Por eso `CONFIG.umbrales.consultorio` es `null`; la ficha, el mapa, el chat y el informe dan el consultorio más cercano y su distancia con el estado `INFORMATIVO`; no suma a ningún puntaje, no entra en la búsqueda de zonas del asistente, el chat no lo cuenta como «salud cerca» y «salud» se evalúa solo con establecimientos. Las frases con «consultorio», «médico» o «doctor» las responde el motor de reglas y no se envían al modelo de lenguaje. Para fijar un umbral basta poner un número en `CONFIG.umbrales.consultorio` y decidir su fuente; hoy no se inventa uno.

### 6.2 Educación: qué registros de ESCALE cuentan y cómo se asigna el nivel

Cada fila del `Padron_web.dbf` es una institución educativa (IIEE). Cuenta si `D_ESTADO` es `Activo`, `D_PROV` es `AREQUIPA`, tiene `NLAT_IE` y `NLONG_IE` dentro de los polígonos de los distritos y es de **educación básica regular** según su código de nivel `NIV_MOD`. La correspondencia sale de los pares `NIV_MOD` / `D_NIV_MOD` del propio padrón (edición del 2026-10-30); la hoja «Especificación de la tabla de datos padron web» del ZIP solo describe los campos, no lista los códigos:

| `NIV_MOD` | `D_NIV_MOD` | Nivel de la ficha |
|---|---|---|
| `A1` | Inicial - Cuna | inicial |
| `A2` | Inicial - Jardín | inicial |
| `A3` | Inicial - Cuna-jardín | inicial |
| `B0` | Primaria | primaria |
| `F0` | Secundaria | secundaria |
| `A5` | Inicial - Programa no escolarizado | no cuenta (PRONOEI y similares, sin local propio) |
| `C0`, `G0` | Primaria y secundaria de adultos | no cuenta |
| `D0`, `D1`, `D2` | Básica alternativa | no cuenta |
| `E0`, `E1`, `E2`, `K0` | Básica especial | no cuenta |
| `L*`, `M0`, `P0`, `S0`, `T0` | Técnico-productiva, ocupacional, artística, pedagógica y tecnológica superior | no cuenta |

Se mantienen las instituciones **públicas y privadas** (`D_GESTION`: «Pública de gestión directa» y «Pública de gestión privada» se guardan como pública; «Privada», como privada). Un local puede albergar varias IIEE: se deduplica por **código de local** (`CODLOCAL`). Cada local conserva los niveles que suman sus instituciones y la lista de instituciones con su código modular, nombre, nivel y gestión; en la ficha, el nombre y el código modular que se muestran para un nivel son los de la institución de ese nivel.

### 6.3 Unión con OpenStreetMap (respaldo)

Entra **todo** punto oficial. De OpenStreetMap se añade un elemento solo si **ningún punto oficial de la misma categoría está a 200 m o menos** (distancia en línea recta, haversine: la misma función y el mismo radio con que K2 midió la exhaustividad; el radio se cambia con `--radio=` y queda escrito en `metadata.deduplicacion`). En salud, la categoría es una sola. En educación, la categoría es el nivel: un elemento de OSM con niveles inferidos (`Calculos.nivelesEducativos`) se conserva si algún nivel suyo no lo cubre un local de ESCALE de ese nivel a 200 m, y entonces **lleva en `niveles` solo los niveles sin cubrir**; los que OSM etiqueta como educación superior no se añaden. `metadata.deduplicacion.osm` cuenta cuántos de OSM se descartaron y, de ellos, cuántos coinciden también en el nombre (parecido de 0,9 o más, el emparejamiento de K2) y cuántos se descartaron solo por cercanía. Un elemento de OSM que se conserva no deja de ser de OSM: dice `fuente: "OSM"`, su `osm` y sus etiquetas.

### 6.4 Procedencia, licencias y qué muestra la pantalla

- **RENIPRESS:** licencia Open Data Commons Attribution (ODC-By): se puede usar y redistribuir con atribución a SUSALUD.
- **ESCALE:** el padrón no declara una licencia abierta (no es ODC-By ni CC). Trae un «Acuerdo de uso de datos»: la fuente es el Padrón de Servicios Educativos y Programas de la Unidad de Estadística del MINEDU; la ubicación la proporcionan las DRE/GRE y las UGEL y es la del local educativo; y los límites de referencia son censales del INEI, por lo que no indican pertenencia a una jurisdicción político-administrativa. El proyecto lo usa con atribución al MINEDU y guarda solo lo necesario (locales de la provincia, con código, nombre, niveles y gestión). **Si el proyecto se publica con fines distintos de los académicos, conviene pedir confirmación escrita al MINEDU**, como se hizo con SmartBus.
- **OpenStreetMap:** ODbL, © colaboradores de OpenStreetMap.

La ficha, los popups del mapa, el chat y el informe imprimible dicen de qué fuente es cada establecimiento y su código («RENIPRESS (SUSALUD) · código 00001231 · categoría I-3»; «ESCALE (MINEDU) · código modular 0100001 · pública»; «OpenStreetMap (respaldo: no hay un punto oficial cerca) · node/…»). Las pruebas están en `test/equipamiento-fuentes.spec.ts` y `test/fuentes-visualizacion.spec.ts`.

### 6.5 Mercados, supermercados y malls (informativos)

Tres categorías nuevas, **solo informativas** como el consultorio: la ficha, el mapa (una capa propia, con su icono y su leyenda), el chat y el informe dan el más cercano y su distancia con el estado `INFORMATIVO` (o `SIN DATO`), sin decir cumple ni no cumple, sin efecto en el puntaje ni en la búsqueda de zonas del asistente. `CONFIG.umbrales.mercado`, `supermercado` y `mall` son `null` (§6.5.4). Los datos los arma `pnpm datos:comercio` (`scripts/descargar-comercio.mjs`; lógica y pruebas en `scripts/lib/comercio.js`, `test/comercio.spec.ts` y `test/comercio-ui.spec.ts`).

**6.5.1 Qué entra en cada categoría.** Las etiquetas están en `Calculos.FILTROS` (única definición: de ahí salen la consulta, la clasificación y la lista de la pantalla):

| Categoría | Archivo | Etiquetas de OpenStreetMap |
|---|---|---|
| Mercado (de abastos) | `mercados.geojson` | `amenity=marketplace` |
| Supermercado (aparte de los mercados) | `supermercados.geojson` | `shop=supermarket` |
| Mall (centro comercial) | `malls.geojson` | `shop=mall`; y `landuse=retail` o `building=retail\|commercial` **con nombre** de mall (`mall`, `centro comercial`, `shopping`, `outlet` o el de un mall conocido de Arequipa) |

La extracción es **una sola consulta a Overpass** para la caja de Arequipa metropolitana (la de `CONFIG.viewbox`), con tiempo máximo, reintentos de espera creciente, un User-Agent propio y la respuesta guardada en `.cache-comercio/` (fuera del repositorio, en `.gitignore`); `out geom` entrega puntos, vías y relaciones con su forma. Solo se conserva lo que cae dentro de los polígonos de los 25 distritos de `distritos_aqp.geojson`. Un mismo lugar mapeado dos veces (el cartel y el edificio, o el edificio y su terreno) cuenta una: dos elementos son el mismo si sus nombres coinciden (uno contiene al otro como palabras, o parecido ≥ 0,9) y están a 150 m o menos (a 30 m si alguno no tiene nombre); queda el polígono antes que el punto, y en los malls el edificio `shop=mall` antes que el terreno `landuse=retail`; el elemento descartado queda en `osm_asociados`. Cada elemento lleva `fuente` (`OSM`), `osm` (tipo/id), `nombre` (o `null` si OSM no lo tiene) y las etiquetas; el bloque `metadata` lleva la consulta, la fecha, la base de OSM, la licencia (ODbL), la regla y los conteos.

**6.5.2 Polígonos y distancia al borde.** Donde OSM tiene el edificio o el terreno, el elemento es un polígono y la distancia se mide **hasta su borde** (0 si el punto está dentro), no hasta su centro (`Calculos.evaluarMasCercanoForma`, con la misma proyección local de las áreas verdes): medir al centro «cortaría» un mall de varias hectáreas y diría que está lejos cuando el punto está pegado a su entrada. En el mapa el polígono se dibuja y el marcador va en el centro de su caja.

**6.5.3 Resultado de la extracción (2026-11-10).** Se consultó `overpass.openstreetmap.fr` (el script lo tiene como espejo de respaldo) porque `overpass-api.de` respondió HTTP 502 y 504 a todos los intentos durante más de una hora; **ese espejo tiene datos de OpenStreetMap al 2026-09-26**, más viejos que la copia de salud y educación (2026-10-28).

| Categoría | Elementos de OSM | Tras unir repetidos | Con polígono | Sin nombre en OSM | Fuente |
|---|---|---|---|---|---|
| Mercados | 94 | **89** | 58 | 16 | OSM 89 |
| Supermercados | 35 | **32** | 4 | 3 | OSM 32 |
| Malls | 54 | **51** | 28 | 2 | OSM 51 |

Cuatro advertencias sobre lo que OSM etiqueta así (no se corrigieron a mano, para que el archivo siga siendo reproducible):

- `shop=mall` incluye, junto a Real Plaza o Mall Aventura, **galerías y centros comerciales pequeños** (en el centro hay decenas, muchas como un punto), y el «mall más cercano» al centro de la ciudad es una galería (Unicentro, a unos 150 m de la Plaza de Armas). Por eso cada resultado de la ficha, del chat y del informe da **también el mall confirmado más cercano** (`mallVerificado`, de la lista de abajo) y avisa que el otro puede ser una galería.
- `amenity=marketplace` incluye ferias y comercios mal etiquetados (cuatro puntos «Botica Dermia») y no distingue mercados minoristas de mayoristas.
- Mallplaza Arequipa no figura en OSM con una etiqueta que lo clasifique como mall (ni como `shop=mall` ni como terreno o edificio comercial con su nombre): no se dibuja ni se mide. No se le inventó una ubicación.
- La caja es la de Arequipa metropolitana: lo que queda fuera de ella (La Joya, Santa Rita de Siguas) no está.

**6.5.4 Lista curada de malls (verificados el 2026-11-10).** Cada mall se contrasta con la fuente de su operador y con OpenStreetMap; la fuente confirma que existe y dónde está, pero **la ubicación y la forma son siempre las de OSM** (si OSM no lo tiene, no se dibuja). Quedan en `malls.geojson` → `metadata.curados`:

| Mall | Dirección según su fuente | Fuente (enlace) | En OSM |
|---|---|---|---|
| Mall Aventura Arequipa | Av. Porongoche N.° 500, Paucarpata | Sitio oficial: https://mallaventura.pe/arequipa/ | Sí, polígono `way/437694283` («Mall Aventura Plaza») |
| Real Plaza Arequipa | Av. Ejército N.° 1009, Cayma | Sitio oficial: https://www.realplaza.com/arequipa | Sí, polígono `way/285363096` |
| Mallplaza Arequipa | Av. Ejército 793, Cayma | Sitio oficial: https://www.mallplaza.com/pe/arequipa | **No** |
| OutletArauco Arequipa (antes Parque Lambramani) | Av. Los Incas, Arequipa | Sitio oficial: https://arequipa.outletarauco.pe/ (`parquelambramani.com` redirige a él; según Peru Retail, 2024, es el Parque Lambramani remodelado) | Sí, polígono `way/320096861` |
| Arequipa Center | Av. Aviación 602, Cerro Colorado | **Solo prensa**: Peru Retail, 2018-10-16, https://www.peru-retail.com/centros-comerciales-arequipa/ (Cencosud); no se encontró un sitio oficial | Sí, polígono `way/327630517` |

«Mall Plaza Cayma» no existe con ese nombre: el centro comercial de Cayma de esa empresa es Mallplaza Arequipa, de la lista. Peru Retail menciona un «Mall Aventura Plaza Cayma» (anunciado); no está en OSM ni se verificó con una fuente actual, así que no está en la lista.

**6.5.5 El Censo Nacional de Mercados de Abastos 2016 (CENAMA).** Fuente: INEI (levantamiento del 2016-11-24 al 2017-01-16) a pedido del Ministerio de la Producción, publicado por PRODUCE en datosabiertos.gob.pe (licencia ODC-By): https://www.datosabiertos.gob.pe/dataset/censo-nacional-de-mercado-de-abastos-cenama-2016-ministerio-de-la-producci%C3%B3n-produce, archivo `dat_cenamav3.csv` (barra vertical), con su diccionario y metadatos. **Es una tabla anonimizada: 2 612 mercados del país, sin nombre, dirección ni coordenadas** (solo departamento, provincia, distrito, ubigeo, tipo de mercado, año de inicio, puestos, servicios, trabajadores e ingresos; el identificador es un hash). No sirve como fuente primaria de ubicación ni se puede emparejar un mercado con otro; se usa **solo para medir cobertura**: cuántos mercados había por distrito en 2016 frente a cuántos tiene OSM. La provincia de Arequipa tiene **89 mercados** (64 minoristas, 24 mixtos y 1 mayorista). Resultado completo en `docs/validacion/cenama-cobertura.json` y en `docs/VALIDACION.md` §3.5. Los microdatos en Stata del INEI (https://proyectos.inei.gob.pe/microdatos/) que menciona la ficha del dataset no se revisaron.

**6.5.6 Umbrales: PROPUESTA, no decisión.** El valor es una decisión de la persona responsable del proyecto y no hay uno por omisión. Lo que se buscó y lo que se encontró:

- **Sistema Nacional de Estándares de Urbanismo (MVCS, 2011).** Lo que circula con ese nombre es el *Documento de trabajo, Propuesta Preliminar* (febrero de 2011, Ministerio de Vivienda, Construcción y Saneamiento): no se encontró el PDF en vivienda.gob.pe, solo copias de terceros (la leída: https://pdfcoffee.com/sistema-nacional-de-estandares-de-urbanismodoc-3-pdf-free.html, sin paginación). En el capítulo de equipamiento comercial **no fija un radio de influencia en metros**: dice que, aunque existen dos fuentes (el SISNE anterior y el RNE), no hay un estándar específico para el equipamiento comercial —el SISNE anterior «no responde a la realidad actual» y el RNE se refiere sobre todo a establecimientos privados—, y reúne indicadores de **población por equipamiento**, tomados de la Sociedad de Urbanistas del Perú para Lima (mercado barrial 8 800 hab.; núcleo comercial complementario 35 200 hab.; y 300 000 y 600 000 hab. para el comercio interdistrital y el centro comercial metropolitano, en el orden en que salen en la copia, que perdió el formato de la tabla). Define el radio de influencia solo como concepto («depende de la movilidad, el clima, la geografía, la densidad…»). Una cifra de «16 m para un mercado barrial» y «80 m para una feria» que circula en una presentación de terceros (equipamiento urbano de Cutervo) **no aparece** en la copia revisada y no se usa.
- **Reglamento Nacional de Edificaciones, Norma A.070 «Comercio».** Define tienda, mercado minorista y mayorista, supermercado, centro comercial, y fija aforo y estacionamientos; **no fija distancias de cercanía**.
- **Otros países.** El mismo documento toma como referencia el Sistema Normativo de Equipamiento Urbano de SEDESOL (México), pero en la copia revisada la tabla de comercio no trae cifras legibles y no se encontró el original; no son normas peruanas y no se propone ninguna cifra de ahí.

**Conclusión: no hay una referencia verificada en metros que proponer** para mercado, supermercado ni mall. La alternativa que sí tiene fuente es la contraria: indicadores de población por equipamiento (cuántos habitantes por mercado), que se podrían calcular por distrito pero que **no** son una distancia. Hasta que la persona fije un valor y su fuente, `CONFIG.umbrales.mercado`, `supermercado` y `mall` son `null` y las tres categorías son informativas.

**En el chat.** «¿Hay un mall y un mercado cerca de mi punto?» y «¿cuántos mercados hay en Cayma?» las responde el motor de reglas (no se mandan al modelo de lenguaje) con el más cercano y su fuente, o el total por distrito, y dicen que es informativo. «Busco una zona cerca de un mall» no se puede y lo dice; en una búsqueda con otros criterios se busca sin ellos y se avisa. Se **quitó el sustituto anterior**: «mall», «centro comercial» y «supermercado» ya no significan «cerca de una zona comercial del plano de zonificación»; la zona comercial del plano sigue siendo el criterio `comercial` (aproximado) solo cuando la frase dice «zona comercial», «comercio», «tiendas» o «compras».

## 6b. Zonificación: alerta de borde y PDM proyectado (V1a y V1b)

- **Alerta de borde.** Si un polígono de otra zona queda a `CONFIG.umbrales.bordeZona` (20 m, convención del proyecto) o menos del punto, la ficha lo avisa (`Calculos.alertaBorde`). Responde a que los polígonos se extrajeron de un PDF y cerca del borde el resultado puede no ser exacto.
- **Zonificación proyectada.** Solo un aviso de texto sobre el estado del PDM nuevo, con su fuente y fecha, tomado de `CONFIG.estadoPDM`. Si ese valor es `null` o le falta fuente o fecha, no se muestra nada (`Calculos.avisoPDMProyectado`). La fuente actual es una nota de prensa (Diario Correo, 2026-10-24), no un documento oficial. No hay mapa de la zonificación proyectada.
- **Artículo del Reglamento.** La tabla de reglas no guarda el artículo de cada parámetro; la ficha cita el Título III del Reglamento y mostrará el artículo si una regla trae el campo opcional `articulo`.

## 6c. Líneas de transporte (SmartBus)

La variable V4 sigue siendo el **paradero más cercano de OpenStreetMap** (§6). Además, la tarjeta «Transporte» muestra **qué líneas pasan cerca**, con una fuente distinta: los recorridos que publica SmartBus (smartbus.app), una empresa privada de Arequipa. Las dos fuentes no se mezclan: la tarjeta las rotula por separado.

**Permiso.** Los datos se usan con **autorización verbal de SmartBus; la confirmación escrita está pendiente**. Esa frase viaja en el archivo (`metadata.permiso`) y aparece en la ficha, el informe y el asistente. Mientras no haya confirmación escrita, el archivo es «datos con permiso verbal»: no debe redistribuirse como si fuera abierto.

**De dónde salen los datos (sin autenticación, los mismos que usa el mapa de la página para cualquier visitante).** Se averiguó leyendo el JavaScript público de https://smartbus.app/pe/arequipa/c2: el mapa llama a `/smartbus/{país}/{ciudad}/routes`, `/routes/{id}` y `/routes-geo`.

| Endpoint (GET, JSON) | Qué trae |
|---|---|
| `https://smartbus.app/smartbus/pe/arequipa/routes` | Lista de rutas: id, nombre corto y largo («Cettar : Ciudad Municipal → Terminal Terrestre»), empresa en `agency.name` («C2 - Cono Norte»), color y número de paradas |
| `https://smartbus.app/smartbus/pe/arequipa/routes/{id}` | Detalle de una ruta: paradas `{ nombre, lat, lng, sequence }` y trazado `geometry` `[[lat, lng], …]` |
| `/routes-geo` | Todos los trazados en una sola respuesta (sin paradas); no se usa |

`robots.txt` de smartbus.app declara `User-agent: * / Allow: /`. El script lo vuelve a leer y se detiene si deja de permitirlo.

**Cómo se descarga** (`pnpm datos:rutas`, `scripts/descargar-rutas-smartbus.mjs`): solicitudes HTTP simples con un User-Agent honesto («GeoVerificador/1.0 (datos con permiso de SmartBus)»), sin suplantar un navegador, sin saltar captchas y sin tokens; al menos 1,1 s entre solicitudes; las respuestas crudas quedan en `.cache-smartbus/` (ignorada por git). Si un endpoint pide inicio de sesión, responde 401/403/429, redirige o muestra una verificación anti-bot, el script **se detiene** sin insistir. Valida el resultado (números finitos, todo dentro de Arequipa, rutas y paradas completas) y, si algo falla, **no toca el archivo existente**. Salida: `public/data/rutas_smartbus.geojson`.

**Qué trae el archivo.** Un `LineString` (o `MultiLineString`) por línea, empresa y sentido (`linea`, `empresa`, `ramal`, `nombre`, `sentido`, `id_ruta`, `fuente`, `url`) y un `Point` por parada (`nombre`, `linea`, `ramal`, `orden`, `id_ruta`). Descarga del 2026-11-03: **12 líneas** (C2 a C11, Albotran y Chiguata), **126 ramales**, **241 recorridos** (uno por sentido), **9 301 paradas** y 122 574 vértices. `metadata` trae la fuente, el permiso, la atribución («Rutas: SmartBus (smartbus.app)»), la fecha de descarga y los conteos.

**Decisiones.**
- La línea y la empresa salen de `agency.name` («C2 - Cono Norte» → línea C2, empresa Cono Norte). Lo que SmartBus llama «ruta» (por ejemplo «Cettar») es un **ramal** de esa línea. Albotran y Chiguata no tienen código: la línea lleva su nombre.
- SmartBus entrega cada trazado como tramos pegados, y a veces hay saltos entre tramos consecutivos. Un salto de más de 300 m (el 99,7 % de los segmentos mide menos) no se dibuja como calle: el trazado se parte ahí y queda como `MultiLineString` (102 de los 241 recorridos). Así la distancia nunca se mide contra un tramo que no existe.
- Las paradas se publican con nombres numerados («Cettar - 12»), sin el nombre de la calle; se muestran tal cual.

**Qué se calcula** (`public/js/rutas.js`, sin DOM ni red).
- *Líneas cerca de un punto:* la distancia del punto a la polilínea de cada recorrido (plano local, la misma de las quebradas, `Calculos.distanciaALineaM`) y, por línea, la distancia mínima, sus ramales y la **parada más cercana** (haversine). Se listan las líneas a **400 m o menos** (`CONFIG.umbrales.transporte`, **convención del proyecto**, no una norma; la ficha lo rotula así).
- *Líneas que cruzan un distrito:* una línea cuenta si algún punto de su trazado (densificado a tramos de 100 m) cae dentro del polígono del distrito (límites de GEOCATMIN); se informan también cuántas paradas tiene dentro. Es una aproximación: un trazado que solo roza una esquina del distrito podría no contarse.
- Dónde se ve: tarjeta «Transporte» de la ficha, fila de transporte de «Comparar puntos», sección «Transporte» del informe PDF y el asistente («¿qué buses pasan por aquí?», «¿qué líneas pasan por Paucarpata?»; con Gemini la intención es `rutas` y el campo `distrito`, validados igual que el resto; el modelo solo nombra el distrito y las líneas salen siempre del motor).

**Qué no cubre.**
- Son los recorridos **tal como SmartBus los publicó en la fecha de descarga**; los datos no se actualizan solos.
- **No hay frecuencias ni horarios**, ni si el servicio está operando hoy; una línea que «pasa» no garantiza que pase cuando la persona la necesite.
- **Un cambio de ruta por tramos** (obras, desvíos, ajustes de la empresa) puede no estar reflejado. Lo que SmartBus no publica no aparece.
- La distancia es **al trazado**, no al lugar donde se puede subir, y en línea recta, no a pie.
- Los nombres de las paradas son números de orden, no calles ni referencias.

**Verificación.** `test/rutas.spec.ts` (módulo con fixtures: distancias a mano, hueco entre tramos, cruces de distrito, orden de líneas), `test/rutas-integracion.spec.ts` (comparación e informe), `test/asistente-rutas.spec.ts` (reglas, respuestas, contrato con Gemini) y `scripts/verificar-datos.mjs`, sección D: integridad del archivo, conteos que cuadran con los metadatos, ningún segmento de más de 300 m, paradas sobre el trazado de su ruta, las líneas a 400 m de 200 puntos frente a la distancia punto-segmento sobre la esfera (fuerza bruta) y las líneas de 6 distritos frente a un barrido cada 20 m con número de vueltas.

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
| Salud, educación por nivel, transporte y área verde (estado, distancia, nombre) | Más cercano por haversine y umbral; área geodésica y distancia al borde en áreas verdes | `calculos.js`, `equipamiento.js`, `data/equipamiento/*.geojson` |
| «Líneas que pasan a ≤400 m», trazado y parada más cercana | Distancia punto → polilínea de cada recorrido, agrupada por línea; parada más cercana por haversine | `rutas.js`, `data/rutas_smartbus.geojson` (SmartBus, permiso verbal) |
| Aviso de borde de zona | Otra zona a ≤ 20 m del punto | `Calculos.alertaBorde`, `zonificacion.js` |
| Aviso del PDM proyectado | Texto de `CONFIG.estadoPDM` (solo con fuente y fecha) | `config.js`, `calculos.js` |
| Distrito, zona sísmica y Z | Punto-en-polígono sobre los límites del INEI; zona y Z de la E.030 | `distritos.js`, `distritos_aqp.geojson`, `zonas_sismicas_e030.json` |
| Riesgos identificados | Reglas del catálogo sobre los datos anteriores | `riesgos.js` (`CATALOGO`, `identificar`) |
| Nivel de cada riesgo | Probabilidad × impacto elegidos por el usuario (matriz 3 × 3) | `riesgos.js` (`nivel`) |
| Resumen del punto | Une las líneas anteriores sin puntaje | `app.js` (`renderResumen`) |

| Quebradas y cauces: nombre, distancia, estado INFORMATIVO | Distancia a la línea más cercana de los cauces de la ANA, el IGP y OpenStreetMap (con la fuente de cada tramo); el estado solo cambia con el umbral de «Mis umbrales» | `calculos.js` (`evaluarCauces`), `contexto.js`, `umbrales.js`, `quebradas_aqp.geojson` |
| Contexto de riesgo: peligros geológicos a 500 m | Conteo con haversine sobre el inventario de INGEMMET; siempre INFORMATIVO | `contexto.js`, `peligros.js`, `peligros_aqp.geojson` |
| Contexto de riesgo: peligro volcánico del Misti | En qué polígonos de peligro del IGP cae el punto (punto-en-polígono con huecos) y el nivel más alto por fenómeno; siempre INFORMATIVO | `volcan.js`, `contexto.js`, `peligro_volcanico_misti.geojson` |
| Contexto de riesgo: riesgo del distrito ante El Niño (CENEPRED) | Se busca el distrito del punto (punto-en-polígono) y se copia el nivel de riesgo ante inundaciones y movimientos en masa y tres conteos del archivo congelado; sin cálculo; siempre INFORMATIVO | `cenepred.js`, `contexto.js`, `riesgo_cenepred_fen2027.json`, `distritos.js` |
| Contexto de riesgo: sismos a 100 km | Conteo con haversine sobre los sismos reportados por el IGP en el periodo del archivo; siempre INFORMATIVO | `calculos.js` (`resumirSismos`), `contexto.js`, `sismos_igp.geojson` |
| Precio de oferta por m² del distrito | Se busca el distrito del punto (punto-en-polígono) en el archivo congelado de Aptología; se copia la mediana publicada, sin cálculo | `precios.js` (`Precios.buscar`), `precios_m2_distrito.json`, `distritos.js` |
| Tabla de «Comparar puntos» | Instantánea de cada punto guardado; prioridades de la persona; sin puntaje | `comparar.js`, `comparar-ui.js` |

Las filas de peligros (módulo), zona sísmica, denuncias y riesgos corresponden a los módulos fuera de alcance, que se ven con `?modulos=todos`. Los peligros geológicos del contexto de riesgo (§12) sí se ven siempre, rotulados como informativos.

| Ficha en PDF | Los mismos datos de la pantalla, sin cálculos nuevos, en un informe para imprimir | `reporte.js`, `app.js` (`datosReporte`), reglas `@media print` de `styles.css` |

## 8. Cómo reproducir

```bash
npm install
npm run datos:extraer                 # OpenStreetMap, una consulta: transporte, áreas verdes y la copia de respaldo en equipamiento/osm
npm run datos:oficial                 # RENIPRESS y ESCALE + respaldo de OSM -> public/data/equipamiento/{salud,educacion}.geojson
npm run datos:comercio                # mercados, supermercados y malls (una consulta a Overpass, con caché) + CENAMA 2016 -> public/data/equipamiento/{mercados,supermercados,malls}.geojson y docs/validacion/cenama-cobertura.json
node --use-system-ca scripts/descargar-peligros.mjs   # public/data/peligros_aqp.geojson (no sobrescribe un archivo con más registros)
node scripts/descargar-quebradas.mjs  # public/data/quebradas_aqp.geojson (ANA, IGP y OpenStreetMap)
node scripts/descargar-peligro-volcanico.mjs  # public/data/peligro_volcanico_misti.geojson (IGP)
node scripts/descargar-riesgo-cenepred.mjs    # public/data/riesgo_cenepred_fen2027.json (CENEPRED, escenario ante El Niño por distrito)
node scripts/descargar-sismos.mjs     # public/data/sismos_igp.geojson (IGP)
node scripts/descargar-delitos.mjs    # public/data/delitos_aqp.geojson
node scripts/descargar-distritos.mjs  # public/data/distritos_aqp.geojson
node scripts/verificar-datos.mjs      # comprobaciones automáticas
npm run start:dev                     # http://localhost:3000
```

Las fuentes públicas cambian: al volver a descargar, las cifras de este documento pueden cambiar. La fecha de cada descarga queda en `metadata.descargado` de cada archivo.

## 9. Lo que la ficha no cubre (huecos declarados)

- **Quebradas y huaicos.** Los cauces de la ANA, el IGP y OpenStreetMap no incluyen todas las quebradas urbanas y no son un mapa de peligro (§12). La faja marginal no está delimitada en la ficha. Del CENEPRED/SIGRID solo se integró el escenario por distrito ante El Niño (§12.8), que no delimita nada dentro del distrito; la susceptibilidad de INGEMMET no se pudo consumir (ver [`INVESTIGACION-VARIABLES.md`](INVESTIGACION-VARIABLES.md), tabla A) y se remite como verificación a hacer.
- Licuación y amplificación por el suelo del predio, y tsunami. El peligro volcánico del Misti solo está como zonas del IGP de escala regional, sin fecha de elaboración (§12.6). El peligro sísmico solo está a escala de distrito (zona E.030; §12.7).
- Precio del suelo, rentabilidad o demanda: no se relaciona ningún factor con el valor de un predio. Lo único que hay es el precio de **oferta** por m² promedio de tres distritos (§13), informativo y sin comparar con nada.
- Calidad de la construcción, servicios básicos (agua, desagüe, luz) y situación legal del predio (títulos, cargas).
- **Transporte como servicio.** Las líneas son los recorridos que SmartBus publicó en la fecha de descarga: sin frecuencias ni horarios, sin saber si hoy operan, y un cambio de ruta por tramos puede no estar reflejado (§6c).
- Planes urbanos posteriores a 2016.

## 10. Gestión de riesgos del predio (registro de riesgos)

**Objetivo.** Llevar los datos de la ficha por un proceso de gestión de riesgos: **identificar, analizar, evaluar, tratar, dar seguimiento y comunicar**. Así resume ISO el proceso de la norma ISO 31000 en su sitio oficial. No se citan cláusulas de la norma: su texto completo no se leyó (la plataforma de consulta de ISO exige aceptar términos de uso).

**Reparto del trabajo y por qué.**

| Paso | Quién | Cómo | Por qué así |
|---|---|---|---|
| Identificar | La herramienta | Cada riesgo del catálogo tiene una regla que se activa con un dato concreto, y muestra ese dato como evidencia con su fuente | Es lo único que los datos permiten afirmar sin suponer |
| Analizar (probabilidad e impacto) | El usuario | Elige baja/media/alta para cada uno; **no hay valores precargados** | No existe un dato que permita asignar la probabilidad o el impacto por él (por ejemplo, la cantidad de denuncias no dice qué tan probable es que le roben a un inversor concreto). Precargarlos sería inventarlos |
| Evaluar (nivel) | Regla fija | Nivel = probabilidad × impacto (1-3 × 1-3): 1-2 bajo, 3-4 medio, 6-9 alto | Matriz cualitativa de probabilidad e impacto; los cortes son una **convención de este proyecto**, no una norma |
| Tratar | La herramienta propone, el usuario decide | Acciones que son trámites o normas oficiales, cada una con su fuente; decisión: evitar, reducir, transferir o aceptar | Las acciones tienen respaldo documental. Las cuatro decisiones son una **convención de este proyecto** para registrar qué se hará |
| Dar seguimiento | El usuario | Marca las acciones hechas; la evaluación se guarda en el navegador (por punto) | Uso personal; no se envía a ningún servidor |
| Comunicar | La herramienta | **Ficha en PDF** (botón «Descargar PDF»: informe con el resumen, el detalle de cada riesgo, el registro con la matriz y las limitaciones, que se guarda con el diálogo de impresión del navegador); además, el registro en CSV y los datos crudos en JSON | Deja constancia de qué se sabía y qué se decidió, en un formato que cualquiera puede leer |

**Catálogo.** Definido en `public/js/riesgos.js` (`CATALOGO`). Cada regla está probada con casos sintéticos en `scripts/verificar-datos.mjs`.

| Id | Riesgo | Se identifica cuando… | Fuente del dato | Tratamiento propuesto (fuente) |
|---|---|---|---|---|
| N1 | La zona no permite construir | la regla de la zona tiene `edificable = no` | Reglamento PDM, Título III | Certificado de parámetros o de zonificación y vías (Ley 29090) |
| N2 | Los parámetros no están fijados en el plano | `edificable = condicionado` (plan específico o zona del entorno) | Reglamento PDM, Título III | Certificados (Ley 29090) |
| N3 | El lote es menor que el mínimo | el usuario escribe un área de lote menor que `lote_min_m2` | Reglamento PDM, Título III | Certificados (Ley 29090) |
| N4 | La altura depende del ancho de la vía | zona comercial (altura = 1,5 × (vía + retiros)) | Reglamento PDM, Título III | Certificados (Ley 29090) |
| N5 | El plan cumplió su vigencia y hay uno nuevo en trámite | el punto está dentro o fuera del plano (siempre que se consultó) | Título Preliminar del Reglamento (vigencia 10 años); página de la MPA (consulta del PDM nuevo, 13/10 al 11/12/2025) | Consultar al IMPLA; certificados |
| N6 | Posible suspensión judicial | el punto tiene zona en el plano: la herramienta no puede saber si el predio era agrícola o de reserva paisajista en el PDM 2002-2015 | Sentencia de Vista 183-2019 (transcrita por el Colegio de Arquitectos) | Consultar al IMPLA |
| N7 | El plano no asigna zona | el punto está fuera del área zonificada | Plano de zonificación | Consultar al IMPLA; certificados |
| D1 | Zona de riesgo muy alto según el plano | la zona es `ZRE-RI1` o `ZRE-RI2` (grupo «riesgo») | Reglamento PDM, Título III | Evaluación de riesgo según el manual del CENEPRED; certificados |
| D2 | Peligros geológicos documentados cerca | hay al menos un registro a 500 m | Inventario de INGEMMET | Revisar el SIGRID del CENEPRED; evaluación de riesgo (CENEPRED) |
| D3 | Peligro sísmico de la zona | el punto cae en un distrito | E.030 2026 (Anexo II, Tabla N.° 1); límites del INEI | EMS o ITS (E.030, Art. 16.1); diseño según la E.030 (Art. 4) |
| D4 | Peligro volcánico (Misti) no evaluado | el punto cae en un distrito | Mapa de peligros del Misti (INGEMMET), citado por informes | Ubicar el predio en ese mapa |
| S1 | Robos y hurtos denunciados | hay al menos una denuncia a 500 m en el periodo | SIDPOL (MININTER) | Sin trámite oficial: comparar con la ciudad en el mapa de calor y decidir medidas (recomendación práctica, declarada como tal) |

**Fuentes de los tratamientos y su nivel de verificación.**

- **Certificados (Ley 29090).** El Certificado de Parámetros Urbanísticos y Edificatorios lo emite la municipalidad distrital y es requisito de la licencia de edificación de un predio urbano. El Certificado de Zonificación y Vías lo emite la municipalidad provincial y se usa en la habilitación urbana. Ambos están en el art. 14 del TUO de la Ley 29090; una resolución de INDECOPI cita el TUO aprobado por D.S. 006-2017-VIVIENDA y una guía cita otro decreto (D.S. 029-2019-VIVIENDA), así que la versión vigente debe confirmarse. **Verificación:** solo con fuentes secundarias (guías de trámites, resoluciones de INDECOPI y una resolución de gerencia municipal que cita el art. 14); el texto oficial de la ley no se leyó. La aplicación lo dice y pide confirmar en el TUPA de la municipalidad.
- **E.030, Arts. 4 y 16.1.** Leídos en el texto oficial de 2026: la norma «es de cumplimiento obligatorio a nivel nacional» en el diseño de edificaciones nuevas, y «todo proyecto de edificación debe contar con Estudio de Mecánica de Suelos (EMS) o Informe Técnico de Suelos (ITS), según sea el caso, conforme a lo indicado en la Norma Técnica E.050».
- **CENEPRED.** Manual para la Evaluación de Riesgos originados por Fenómenos Naturales, 2.ª versión, aprobado por la Resolución N.° 112-2014-CENEPRED. Una nota del CENEPRED de 2025 indica que sigue usándolo en sus asistencias técnicas. **Verificación:** con el registro de la resolución y notas institucionales; no se leyó el manual completo.
- **SIGRID.** Portal del CENEPRED (`sigrid.cenepred.gob.pe`) que publica estudios y mapas de peligro; sus documentos aparecieron en las búsquedas de este trabajo, pero no se revisó qué cubre para cada sector de Arequipa.
- **Mapa de peligros del Misti.** Publicado por el INGEMMET. Según informes del INGEMMET y del CENEPRED, la Municipalidad Provincial lo adoptó como documento de gestión mediante la Ordenanza 658-MPA. **Verificación:** fuentes secundarias; el texto de la ordenanza no se leyó.

**Qué no hace el registro, a propósito.**

- No asigna probabilidad, impacto ni nivel por el usuario, y no suma los riesgos en un puntaje global.
- No incluye el entorno (servicios, transporte, áreas verdes): no hay una base para decir desde cuántos elementos la falta de servicios es un «riesgo».
- No reemplaza la evaluación de riesgo del CENEPRED, el estudio de suelos ni los certificados municipales: los propone como tratamiento.
- La evaluación se guarda solo en el navegador del usuario. Si borra los datos del sitio, se pierde; por eso se puede descargar.

## 11. Asistente de chat

**Qué es.** Un chat (`public/js/asistente.js` para la lógica y `public/js/asistente-ui.js` para la vista) que responde sobre el punto ya consultado y busca zonas de Arequipa según lo que la persona pide. Usa los mismos archivos, umbrales y cálculos de las cinco variables; no agrega fuentes de datos.

**Papel del modelo de lenguaje (Gemini).** La regla del proyecto es no inventar datos: un modelo de lenguaje podría responder con cifras que no están en ninguna fuente. Por eso el modelo nunca calcula ni responde por su cuenta. Solo tiene dos tareas acotadas, que corren en el servidor (`api/_lib/gemini.js`, la función `/api/chat`), con la clave en una variable de entorno:

1. **Interpretar.** Convierte la frase en la misma consulta estructurada que produce el intérprete de reglas. Usa como única salida una función declarada (`consulta_asistente`, en modo de llamada obligatoria). El resultado se valida con un esquema (`AsistenteLLM.validarSpec`): campos desconocidos, enumeraciones y rangos recortados. Después lo ejecuta el motor determinista en el navegador, con `Calculos`, `Zonificacion`, `Equipamiento` y `Contexto`.
2. **Redactar.** Reescribe la respuesta determinista. `AsistenteLLM.verificarTexto` exige que toda cifra y todo nombre propio del texto estén en el resultado del motor. También que se mantenga el aviso «referencial» y que no haya recomendaciones de compra. Si algo no se cumple, se muestra el texto determinista.

Ante cualquier fallo se usa el intérprete de reglas (palabras clave sin tildes ni mayúsculas): no hay clave, el servidor da error, se pasa el tiempo límite o el sitio es estático. La explicación «Por qué, fuente y límites» se arma siempre de forma determinista. Al modelo solo se envían la frase, los últimos seis turnos y, al redactar, el texto ya calculado; los datos geográficos no salen del navegador. **Límite:** la calidad de la interpretación depende del modelo. Si entiende mal una frase, la consulta resultante sigue siendo válida, pero puede no ser la que la persona quería. La frase equivalente se muestra en las búsquedas armadas con los menús.

**Qué entiende.**

| Tipo | Ejemplos | Respuesta |
|---|---|---|
| Sobre el punto | «¿qué zona es?», «resumen», «¿hay un colegio cerca de mi punto?» | Los mismos resultados de la ficha, con su distancia y su referencia |
| Construir | «¿cuánto puedo construir en un lote de 200 m²?» | `Zonificacion.potencial`, el mismo cálculo de la ficha; no calcula en zonas condicionadas ni no construibles |
| PDM nuevo | «¿cambiará la zonificación?» | El aviso de `CONFIG.estadoPDM` con su fuente y fecha, y aclara que no hay mapa |
| Fuentes | «¿de dónde salen los datos?» | Fuentes y umbrales |
| Buscar zonas | «busco cerca de un colegio y un parque», «busco en Paucarpata un sector con colegio y parque cerca» | Sectores donde se cumple todo a la vez, sin ranking (ver abajo) |
| Contar en un distrito | «¿cuántos colegios hay en Paucarpata?» | «En Paucarpata hay N colegios: a inicial, b primaria, c secundaria (ESCALE, con OpenStreetMap de respaldo, fecha; puede faltar alguno)» y los muestra en el mapa |
| Perfil de un distrito | «quiero vivir en Paucarpata», «la mejor zona para vivir en Paucarpata» | Resumen de ese distrito y la pregunta «¿Qué es lo primero para ti…?» con botones |
| «La mejor zona» sin distrito | «la mejor zona para vivir» | Explica que no elige una «mejor» y pregunta qué importa |
| Precio del distrito | «¿cuánto cuesta el m² en Cayma?», «precio por metro cuadrado», «¿qué distrito es el más caro?» | El precio de oferta por m² de Aptología con avisos, periodo y atribución (§13); sin cifra para el distrito, lo dice |
| Sin datos | «¿es seguro?», «precio de esta casa», «alquiler en Cayma», «una zona barata» | Dice que no tiene seguridad ni el precio de un inmueble o alquiler en particular (solo promedios de oferta por distrito); no responde a medias |

**Criterios de búsqueda y sus umbrales.**

| Criterio | Cómo se mide | Umbral por defecto | Origen |
|---|---|---|---|
| Salud, transporte, área verde | Igual que V2, V4 y V5 | `CONFIG.umbrales` | Los de la ficha |
| Colegio sin nivel | Cumple si hay uno de **inicial o primaria** dentro de su umbral | 500 m / 1500 m | MINEDU. Secundaria no entra: con 3000 m casi toda la ciudad cumple y «cerca de un colegio» dejaría de distinguir zonas. Quien la quiere dice «secundaria» |
| Inicial, primaria, secundaria | Igual que V3 | 500 / 1500 / 3000 m | MINEDU |
| Campiña | Distancia al polígono más cercano de `ZA` o `ZRE-PA` | 500 m | Convención del proyecto |
| Zona residencial | La celda está dentro de una zona del grupo `residencial` | dentro | Plano |
| Tranquilo | La celda está en `RDB` o `RDM-1` | dentro | **Aproximación**: no hay datos de ruido |
| Comercial («mall») | Distancia a una zona del grupo `comercial` | 600 m | **Aproximación**: no hay datos de centros comerciales |
| Centro histórico («barrio tradicional») | Distancia a `ZRE-CH` | 800 m | **Aproximación**: no hay datos de barrios tradicionales |

Los umbrales de campiña, comercial y centro histórico son convenciones del proyecto (`CONFIG.asistente.umbralesZona`); ninguna norma los fija.

**Distancias.** Una sola distancia en el mensaje («en un radio de 1 km») vale para todos los criterios; varias («colegio a 500 m y parque a 300 m») se asignan a su criterio. Con «cerca de mi punto» la distancia limita el área de búsqueda alrededor del punto elegido.

**Cómo se busca.**

1. Se arma una cuadrícula de celdas de 250 m (`CONFIG.asistente.pasoCeldaM`) cuyo centro cae en una zona **construible** del plano (o también condicionada, si se pide). Si dos zonas se superponen gana la última, como en el plano. La cuadrícula es un **andamio interno**: nunca se muestra.
2. En cada celda se evalúa cada criterio con las funciones de `Calculos` (haversine y área geodésica) sobre el equipamiento congelado (RENIPRESS, ESCALE y el respaldo de OpenStreetMap). Si la persona nombró un distrito, solo se evalúan las celdas de ese distrito.
3. Las celdas donde se cumple **todo a la vez** se juntan en **sectores**: zonas continuas (las celdas que se tocan, también por una esquina; `public/js/sectores.js`). El borde de cada sector es la unión de sus celdas, suavizada. Un sector de una sola celda no se muestra si hay otros más grandes.
4. Cada sector se nombra con el **elemento con nombre más cercano** (colegio, parque, posta o paradero, a 500 m o menos; si la persona pidió un tipo, gana el de ese tipo). Si no hay ninguno con nombre, el sector queda sin nombre: no se inventan nombres ni calles, porque los datos no traen calles.
5. La respuesta dice, por ejemplo, «Encontré 3 sectores de Paucarpata donde tienes a la vez un colegio inicial a menos de 500 m y un parque a menos de 300 m», con cada sector, su tamaño aproximado en hectáreas y lo que hay en su centro, y los botones «Ver en el mapa» y «Consultar este punto».

**Sin ranking, salvo que se pida.** Ya no hay «% del suelo que cumple» ni «coincidencia ponderada»: eran cifras difíciles de entender y de usar. Los sectores se numeran solo para ubicarlos y se ordenan del más extenso al más pequeño. Solo si la persona marca una prioridad («lo más importante es el parque») se ordenan por cercanía a eso, y el texto lo dice. Si no hay sectores, el texto dice qué criterio limita más y ofrece quitarlo.

**Distritos.** Un distrito se reconoce por su nombre sin importar tildes, mayúsculas ni errores de tipeo razonables (`Distritos.buscarNombre`: distancia de edición proporcional al largo del nombre, con prueba contra palabras comunes para evitar falsos positivos). «Arequipa» a secas es la ciudad; el distrito se pide con «cercado» o «distrito de Arequipa». El archivo de límites trae 25 distritos, entre ellos los 21 del ámbito del PDM Arequipa 2016-2025 (memoria, cap. I, 5.1.2: Alto Selva Alegre, Arequipa, Cayma, Cerro Colorado, Characato, Jacobo Hunter, José Luis Bustamante y Rivero, Mariano Melgar, Miraflores, Mollebaya, Paucarpata, Sabandía, Sachaca, Socabaya, Tiabaya, Uchumayo, Yanahuara, Yura, Quequeña, Yarabamba y Chiguata). Los cuatro distritos de la provincia que no están en el archivo (Vítor y los tres de Siguas) no forman parte de Arequipa Metropolitana; el chat los reconoce y dice que no están en los datos.

**Contar y perfil de un distrito.** «¿Cuántos colegios hay en Paucarpata?» cuenta los elementos (de RENIPRESS, ESCALE u OpenStreetMap de respaldo) cuyo punto cae dentro del límite del distrito (`public/js/entidades.js`; un parque cuenta por el centro de su caja). Un colegio con varios niveles suma en cada uno, y los de OpenStreetMap que no declaran su nivel se cuentan como primaria y secundaria (regla de `Calculos.nivelesEducativos`; los locales de ESCALE siempre dicen el suyo); el texto lo aclara. El perfil («quiero vivir en Paucarpata») agrega cómo se reparte la zonificación (puntos cada 300 m dentro del distrito, por tipo principal de zona) y qué cauces de la red de la ANA lo cruzan, y termina preguntando qué es lo primero para la persona, con botones que buscan **dentro de ese distrito**. «La mejor zona» sin distrito no elige una: explica que depende de lo que importe y pregunta qué importa. Si hay datos, el perfil suma dos líneas más: las **líneas de SmartBus que cruzan el distrito** (§6c) y el **precio de oferta por m²** de Aptología (§13). El precio solo existe para los distritos con cifra publicada (hoy tres); en los demás se omite, sin valores estimados.

**Mapa por entidades.** El mapa dibuja lo que existe, no celdas (`public/js/capas.js` decide, `public/js/capas-ui.js` dibuja): colegios con un icono por nivel (inicial círculo, primaria cuadrado, secundaria hexágono) y, si son pocos, un círculo tenue con la distancia de referencia; establecimientos de salud y paraderos con su círculo de 1000 m y 400 m si son pocos; consultorios médicos como una capa propia (icono «C»), sin círculo porque no hay distancia de referencia; parques como polígonos verdes; solo las zonas del plano del tipo pedido (residencial, tranquila, campiña, comercial, centro histórico); quebradas como líneas; sismos como círculos de 3 a 16 px según la magnitud. En una búsqueda se dibujan las entidades que hacen que cada sector cumpla y **una sola región resaltada**, los sectores; lo que no cumple no se pinta. La leyenda explica cada capa en una línea. Con muchos puntos (más de 350) se usan círculos de lienzo en vez de iconos. Con las **líneas de bus** (preguntas sobre buses) se dibujan los recorridos de SmartBus, **un color por línea** (el mismo siempre) con una etiqueta con su nombre y una fila de leyenda por línea; con un punto elegido se dibuja además la parada más cercana de cada línea. El archivo de recorridos (4,9 MB) se baja solo cuando hay líneas que dibujar.

**Qué NO es.** No es una probabilidad ni una recomendación ni un ranking de zonas. La resolución es de 250 m: los bordes de un sector son aproximados y no distinguen cuadras. Hereda todos los límites de la ficha (distancia en línea recta, OpenStreetMap incompleto, plano 2016-2025).

**Líneas de transporte.** «¿Qué buses pasan por aquí?» y «¿qué líneas pasan por Paucarpata?» se responden con los recorridos de SmartBus (§6c), no con el criterio «transporte» de las búsquedas. Sobre el punto usa las líneas a 400 m o menos de la ficha; con un distrito (no necesita punto), las líneas cuyo trazado entra en él. El distrito se reconoce con el mismo buscador de nombres que «contar», «perfil» y las búsquedas (tildes, mayúsculas y errores de tipeo); si el nombre no es un distrito de la provincia, o es uno que no está en los datos (Vítor, Siguas), lo dice en vez de adivinar. El modelo (Gemini) usa el mismo campo `distrito`, validado con la misma regla y resuelto con el mismo buscador. Cita siempre la fuente, el permiso verbal con confirmación escrita pendiente y que no hay frecuencias ni horarios.

**Riesgo del distrito ante El Niño (CENEPRED).** «¿Paucarpata se inunda?», «riesgo de huaico en Sachaca» y «¿qué dice el CENEPRED de mi punto?» se responden con el nivel de riesgo del distrito (§12.8), sin decir «sí se inunda» ni «no se inunda» y sin «cumple» ni puntaje; «¿qué distritos se inundan?» lista los 25 por nivel. «Huaico», «deslizamiento» o «derrumbe» solos (sin distrito) siguen siendo una pregunta de quebradas o de peligros del punto. «Muéstrame en el mapa…» colorea los distritos. Con Gemini, la intención `riesgo_cenepred` (campos `fenomenoRiesgo` y `verEnMapa`) llega al mismo motor.

**Peligro volcánico del Misti.** «¿Estoy en peligro por el volcán?», «¿hay lahares cerca de mi punto?» y «¿Paucarpata está en peligro por el Misti?» se responden con las zonas del IGP (§12.6): sobre el punto, en qué nivel cae por cada fenómeno; sobre un distrito, qué porcentaje de él cae en cada nivel (muestra de puntos cada 250 m). Se atiende antes que el perfil del distrito (la frase nombra un distrito pero no pide su perfil). Siempre con fuente, límites y «no es una evaluación de riesgo»; nunca «cumple» ni puntaje. Una búsqueda de zonas «lejos del Misti» no se atiende y el chat lo dice en vez de ignorar el pedido. El modelo (Gemini) usa la intención `volcan` y el campo `fenomeno` opcional (lahar, flujo_piroclastico, lava, avalancha, ceniza), validados en el servidor y otra vez en el navegador.

**Resumen del punto en llano.** Al consultar un punto, el chat publica un resumen corto (`public/js/resumen.js`) con lo que la ficha ya calculó: dónde estás y qué se puede construir, qué tienes cerca, qué queda más lejos de lo recomendado (con la distancia de referencia) y el cauce más cercano. Trae los botones «Ver detalle técnico», «Guardar para comparar» y «¿Qué debo verificar antes de comprar?». La ficha empieza con las mismas tres líneas y deja las fuentes, el método y los límites en secciones plegadas (no se quitó ningún dato). Cuando hay datos de SmartBus agrega una frase como «Pasan 2 líneas a menos de 400 m: C2 (Cono Norte), C5 (EtraBus)»; si ninguna pasa tan cerca, lo dice, y si no se pudieron leer, no dice nada.

**Ajustes sobre la búsqueda anterior.** «agrega transporte», «quita el parque», «prioriza el colegio», «incluye zonas condicionales». La cuadrícula se reutiliza entre ajustes porque no depende de los criterios; el distrito de la búsqueda anterior se conserva.

**Verificación.**

- Pruebas de lógica (`test/asistente*.spec.ts`, `distritos`, `entidades`, `sectores`, `capas`, `resumen`, `transporte`): interpretación con y sin distrito (incluida la frase «quiero vivir en pauccarpata cuantos colegios hay ahi»), equivalencia entre el intérprete de reglas y el esquema del modelo, conteos, sectores y su contorno, capas del mapa y resumen del punto.
- `scripts/verificar-datos.mjs`, sección C, con los datos reales: la zona de 300 celdas al azar coincide con `Zonificacion.lookup`; las distancias y veredictos de salud, transporte e inicial en 120 celdas coinciden con una fuerza bruta con la ley esférica de los cosenos; los colegios por distrito suman como máximo el total (ninguno se cuenta en dos distritos); Paucarpata tiene colegios, salud, paraderos y parques; una búsqueda dentro de Paucarpata solo devuelve sectores de Paucarpata y su texto no habla de suelo ni de celdas; y los tiempos.
- **Lo que no se verificó:** que los sectores coincidan con lo que una persona consideraría un buen lugar para vivir ni que los nombres de los sectores ayuden a ubicarlos; no hay una prueba con usuarios del chat. Tampoco se validó la comprensión del lenguaje más allá de los casos de prueba: una frase fuera de las reglas se reconoce como «no entendí».

## 12. Quebradas y cauces, y contexto de riesgo (informativo)

> Origen de la elección: [`INVESTIGACION-VARIABLES.md`](INVESTIGACION-VARIABLES.md) §2.1 (fila 2), §3 (tabla A) y §4 (variables N1 y N9). Allí están las fuentes, lo verificado y lo no verificado. Esta sección dice cómo se implementó.

**Regla común.** Nada de esto es una evaluación de peligro. No existe un umbral normativo para ninguna de estas variables, así que su estado es **INFORMATIVO**: se muestra el dato, su fuente, su fecha y lo que no cubre, sin decir «cumple» ni «no cumple». Un estado INFORMATIVO nunca cuenta como prioridad en «Comparar puntos» ni entra en una búsqueda del asistente salvo por el umbral que fija la persona.

### 12.1 Cercanía a quebradas y cauces (ANA)

- **Fuentes (tres, unidas).** Cada tramo del archivo trae su `fuente` y la metadata (`metadata.fuentes`) guarda, por fuente, la capa, la fecha de extracción, la elaboración, la atribución, la licencia y los conteos:
  - **ANA** (Autoridad Nacional del Agua): `https://geosnirh.ana.gob.pe/server/rest/services/ws_Rios_Quebradas/MapServer`, capa 37 «Cuerpos de Agua». Red hidrográfica Pfafstetter, **elaborada en enero de 2018** (según el servicio), de escala nacional. No se localizó una licencia; se atribuye a la ANA. Los tramos se guardan completos.
  - **IGP** (Instituto Geofísico del Perú): `https://ide.igp.gob.pe/arcgis/rest/services/monitoreocenvul/ArequipaMisti/MapServer`, capa 2 «Quebrada» (46 líneas, 36 sin nombre; nombra Agua Salada, Huarangueros, Huarangal, Barranco, Pato, El Peral, San Lázaro y Moto) y capa 3 «RiosArequipa» (2 238 líneas en total; se recortan a la caja de Arequipa metropolitana y quedan 234, que incluyen torrenteras como «Torrentera Chullo» y avenidas-cauce como «Av. Venezuela»). El servicio no trae fecha, escala ni licencia (`copyrightText` vacío): se atribuye al IGP y se dice. Los nombres vienen sin tildes («Qda. San Lazaro») y se normalizan (`scripts/lib/cauces.js`).
  - **OpenStreetMap** (ODbL): consulta Overpass de `way[waterway=river|stream]` en la caja, con `[maxsize:64MB]`, una sola solicitud con un User-Agent propio. Llegaron 669 vías: se guardan las 36 con nombre o de tipo río (se descartan 633 arroyos sin nombre, que son ruido para la ficha; el conteo queda en la metadata). **Aquí figura la «Quebrada Anashuayco»** (escrita así en OSM; se restituye «Añashuayco», la grafía de INGEMMET) y «Quebrada Paccha», «La Chucca», «Río Dolores», «Río Cancahuani», «Río Chacalaque» y «Río Aycata».
- **Unión sin duplicados (`scripts/lib/cauces.js`, con pruebas).** Prioridad ANA, IGP Quebrada, IGP RiosArequipa, OSM. Un tramo de una fuente se descarta si al menos el 70 % de su longitud (puntos cada 25 m) queda a 30 m o menos de líneas ya aceptadas de otra fuente. **Ningún nombre se pierde**: la línea aceptada que el descartado cubre hereda su nombre si no tenía uno o lo guarda como `alias` si tenía otro distinto (por ejemplo, un tramo del IGP llamado «Quebrada Estanquillo» que OpenStreetMap llama «Quebrada Añashuayco» muestra ambos), y se anota en `tambienEn` qué otra fuente la repetía. Los parámetros (70 %, 30 m, 25 m) son decisiones del proyecto, no normas.
- **Descarga.** `node scripts/descargar-quebradas.mjs` → `public/data/quebradas_aqp.geojson`. **Resultado del 2026-11-03: 265 tramos con 42 nombres** (ANA 14 de 14 recibidos; IGP 231 de 280 recibidos, 49 duplicados; OSM 20 de 669 recibidos, 16 duplicados de los 36 con nombre o río). Si CUALQUIERA de las fuentes falla no se escribe nada y se conserva el archivo anterior; si el archivo falta, la variable queda SIN DATO.
- **Cálculo.** `Calculos.distanciaALineaM` proyecta cada tramo a un plano local centrado en el punto (la misma proyección de los polígonos) y toma el tramo más cercano; `Calculos.evaluarCauces` devuelve el nombre, el tipo y la distancia al cauce más cercano. `scripts/verificar-datos.mjs` la contrasta con un método independiente (líneas densificadas a ~5 m y ley esférica de los cosenos): error máximo de 1,5 m en 60 puntos al azar.
- **Estado.** INFORMATIVO sin umbral. **«Mis umbrales»** (`public/js/umbrales.js`, en la tarjeta de quebradas): la persona puede fijar su **distancia mínima** a un cauce (1 a 50 000 m); entonces el estado pasa a CUMPLE si el cauce está a esa distancia o más lejos y NO CUMPLE si no, rotulado «según tu umbral». Se guarda solo en localStorage (con try/catch). No hay valor por defecto ni opciones recomendadas: ninguna norma fija esta distancia (la faja marginal solo existe donde la ANA la delimitó; [`INVESTIGACION-VARIABLES.md`](INVESTIGACION-VARIABLES.md) §4, N1).
- **Dónde se nombra la fuente.** La tarjeta (nombre del cauce y «Fuente»), el resumen en llano («Lo más cercano en riesgo: Río Chili a 1,86 km (IGP)»), el chat («… a 180 m en línea recta de tu punto (fuente: IGP)»), la fila de «Comparar puntos», el informe PDF (sección y fuentes) y el mapa (el globo de cada tramo dice «Fuente: …» y la leyenda cuenta los tramos por fuente).
- **Qué no cubre** (se muestra en la tarjeta, el chat y el PDF): ninguna de las tres fuentes es completa ni un mapa de peligro de huaicos o inundación; la faja marginal no está delimitada; la distancia es a la línea del mapa, no al cauce real, y es en línea recta. **Las quebradas conocidas que aún no figuran se calculan, no se escriben a mano** (`Calculos.quebradasMencionadas` y `quebradasAusentes`): se toman los nombres de quebradas que aparecen en 2 o más registros del campo `sector` del inventario de INGEMMET y las que citan los informes (`CONFIG.quebradas.citadas`: Chullo, Los Incas, Añashuayco, San Lázaro y El Pato), y se descartan las que sí están en los nombres (o alias) del archivo. Hoy faltan: Cabrería (10 registros de INGEMMET), Pajonal (4), Onda (3), Honda (2), Mariano Melgar (2) y Pisac (2). Añashuayco y San Lázaro, que antes faltaban, ahora figuran. `scripts/verificar-datos.mjs` recalcula esta lista con un método propio.

### 12.2 Peligros geológicos (INGEMMET) como contexto

El mismo inventario de §4, ahora visible siempre dentro de «Contexto de riesgo (informativo)». Se cuentan los eventos a 500 m o menos (`CONFIG.peligros.radio`) y se da el más cercano con su tipo, sector y año. **No es una evaluación**: es un inventario de eventos documentados; que no haya registros cerca no significa que el lugar sea seguro. El archivo congelado tiene 394 registros (2003 a 2023; ver §4 sobre el cambio de servicio).

### 12.3 Sismicidad reciente (IGP)

- **Fuente.** Instituto Geofísico del Perú, `https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0` (CORS abierto; catálogo en datosabiertos con Open Data Commons Attribution; no se localizó la licencia del servicio).
- **Qué contiene de verdad.** El 2026-11-02 la capa tenía **765 sismos de todo el país entre el 1 de enero y el 2 de noviembre de 2026**: una ventana de unos 10 meses, **no** el catálogo histórico 1960-2025 que menciona [`INVESTIGACION-VARIABLES.md`](INVESTIGACION-VARIABLES.md) (ese es un CSV aparte). Por eso la ficha siempre muestra el periodo junto al conteo.
- **Descarga.** `node scripts/descargar-sismos.mjs` → `public/data/sismos_igp.geojson` (recuadro de ±1,2° alrededor de Arequipa, 94 sismos, magnitud máxima 5,1). Guarda `fechaDesde`, `fechaHasta` y `totalCapa`.
- **Cálculo.** `Calculos.resumirSismos`: sismos con epicentro a `CONFIG.sismos.radioM` (100 km, **convención del proyecto para dar contexto, no un umbral**) o menos, con la magnitud máxima y el más reciente del radio.
- **Qué no es.** No predice sismos ni mide el peligro del lugar; no reemplaza la zona sísmica de la Norma E.030 (por distrito, §4) ni el Estudio de Mecánica de Suelos. Un conteo bajo no dice nada del pasado fuera del periodo.

### 12.4 En la ficha, en «Comparar puntos» y en el asistente

- **Ficha.** La tarjeta «Quebradas y cauces» está junto a los servicios; peligros y sismos están en el desplegable «Contexto de riesgo (informativo)». Todas son tarjetas desplegables con fuente, fecha, método y «Qué no cubre», y el estado INFORMATIVO tiene su propio icono y texto (no solo color).
- **Comparar puntos.** «Quebradas y cauces» es una fila más; puede marcarse como prioridad, pero solo se puede confirmar con el umbral de la persona (sin él, el punto queda «incompleto»: no se supone que cumple). Peligros y sismos son filas de contexto separadas, nunca prioridad. Los puntos guardados conservan la distancia, no el estado: al cambiar el umbral, la tabla se recalcula.
- **Asistente.** Responde sobre el punto a «quebrada, torrentera, cauce, huaico», «sismos, temblores», «peligros, riesgo geológico» y «volcán, Misti, lahar, ceniza» (§12.6), siempre con la fuente y los límites (y con «Por qué, fuente y límites» desplegable). **También se puede buscar «lejos de quebradas a más de N m»**: encaja con la búsqueda porque la persona fija la distancia mínima; sin distancia el asistente la pide en vez de usar un valor por defecto. En los menús es el selector «Lejos de quebradas y ríos». La búsqueda usa la misma red de la ANA y lo advierte (limitaciones de §12.1). «Cerca de una quebrada» no es una búsqueda: es una pregunta sobre el punto.

### 12.5 Verificación

- `test/contexto.spec.ts` (distancia a líneas, estado INFORMATIVO / «según tu umbral», conteo de sismos, almacenamiento de umbrales), `test/comparar.spec.ts` (filas informativas, umbral, dominancia) y `test/asistente-riesgo.spec.ts` (preguntas, búsqueda «lejos de quebradas», textos con fuente y límites).
- `test/cauces-fuentes.spec.ts` (unión de fuentes, duplicados, nombres y alias, recorte y simplificación, fuente del cauce más cercano, quebradas ausentes calculadas).
- `scripts/verificar-datos.mjs`: integridad de `quebradas_aqp.geojson` (las tres fuentes con su metadata, cada tramo con su fuente, conteos por fuente que cuadran, nombres con alias), `sismos_igp.geojson` y `peligro_volcanico_misti.geojson` (§12.6), distancia a la red frente a un método independiente (y que el cauce elegido y su fuente estén entre los más cercanos), recálculo independiente de las quebradas ausentes, conteos de sismos y peligros frente a un recuento por ley esférica de los cosenos, y que sin archivos las variables queden en SIN DATO.
- **Lo que no se verificó:** que la red de la ANA coincida con el terreno real (no se contrastó con imágenes ni con los informes de INGEMMET), que el sentido de «cerca» de una quebrada coincida con el peligro real de huaico, ni los datos de CENEPRED/SIGRID (`sig.cenepred.gob.pe` no respondió desde la red de prueba).

### 12.6 Peligro volcánico del Misti (IGP)

- **Qué es.** En qué zonas de peligro del Misti cae el punto, por fenómeno: **lahares, flujos piroclásticos, lava, avalanchas de escombros y ceniza**, cada uno con nivel alto, moderado o bajo (la ceniza, además, por escenario de erupción y espesor del depósito). **Siempre INFORMATIVO**: nunca «cumple / no cumple» ni puntaje, y no entra en una búsqueda ni es prioridad de «Comparar puntos».
- **Fuente.** Instituto Geofísico del Perú (IGP, CENVUL), `https://ide.igp.gob.pe/arcgis/rest/services/monitoreocenvul/Vulcanologia/MapServer` (CORS abierto, consultado el 2026-11-03). Las capas no traen descripción, fecha ni licencia (`copyrightText` vacío). Capas congeladas con `node scripts/descargar-peligro-volcanico.mjs` → `public/data/peligro_volcanico_misti.geojson` (87 polígonos, unos 0,5 MB):
  - Lahares: capas 29, 30 y 31 (LaharAltoMisti, LaharMediaMisti, LaharBajaMisti; 1 polígono útil cada una, de un ráster de más de un millón de vértices: se simplifican a ~22 m) y, solo con `volcan = 'Misti'`, las capas 18, 19 y 20 (Lahares Alta, Media y Baja: 26, 19 y 22 polígonos, con probabilidad y volumen del escenario). Los dos modelos no coinciden del todo (el segundo cubre más): donde difieren, la ficha da el nivel más alto.
  - Flujos piroclásticos: capas 15, 16 y 17. Lava: 21, 22 y 23. Avalanchas de escombros: 9, 10 y 11. Ceniza: 12, 13 y 14 (escenarios vulcaniano, subpliniano y pliniano; las zonas alta, moderada y baja de cada uno son anillos anidados con el espesor del depósito: ≤ 5 cm, ≤ 40 cm y ≤ 100 cm en la zona alta). Las capas 24 a 27 (las mismas zonas unidas) y las de otros volcanes no se guardan. Las capas de lahares de otros volcanes (Chachani, Coropuna, Sabancaya, Ubinas, Huaynaputina) se descartan.
  - Sin campo de volcán, las capas de flujos, lava y avalanchas se asignan al Misti porque todas contienen su cima y su extensión está centrada en ella; las de ceniza están centradas en el Misti (sus zonas altas), pero el servicio **no dice de qué volcán son**: se anota en la metadata.
- **Cuál es el mapa oficial y qué edición es esta.** El mapa de peligros oficial es el de INGEMMET: Boletín Serie C n.° 100 «Geología y nuevos mapas de peligros del volcán Misti» (K. Cueva y J. Mariño, 2025; `https://hdl.handle.net/20.500.12544/5309`), que reemplaza al Boletín n.° 60 (Mariño, Rivera, Thouret y Macedo, 2016) y al mapa de 2007. **No se pudo confirmar de qué edición salen las capas del IGP**, así que la ficha las rotula «capa del IGP, sin metadatos de fecha» y cita la referencia oficial aparte. No se afirma que reproduzcan el mapa vigente.
- **Cálculo.** `public/js/volcan.js` (puro, con pruebas): `enZonas` busca los polígonos que contienen el punto (MultiPolygon y huecos incluidos), `resumirPunto` deja el nivel más alto de cada fenómeno y `frasePunto` redacta «Tu punto está en zona de peligro bajo por lahares del Misti, según el IGP». Para un distrito, `porDistrito` prueba un punto cada 250 m dentro de él y cuenta, por fenómeno, el nivel más alto de cada punto (es una muestra: el resultado se da redondeado y el texto lo aclara).
- **Dónde aparece.** «Contexto de riesgo (informativo)» (tarjeta con fuente, fecha, método y «Qué no cubre»), el resumen en llano, una fila informativa en «Comparar puntos» (los puntos guardados antes de esta fila siguen siendo válidos y muestran «Sin dato»), el informe PDF, el mapa («Peligro volcánico (Misti)»: polígonos por nivel con una línea de leyenda por nivel; la ceniza cubre toda la ciudad y no se dibuja) y el chat (en el punto y por distrito; el modelo usa la intención `volcan` con el campo opcional `fenomeno`, validada como las demás).
- **Qué no cubre.** Es un mapa de escala regional y sin fecha de elaboración: el borde de una zona no es exacto a nivel de predio. No es una evaluación de riesgo, no dice si habrá una erupción ni cuándo, no incluye el efecto de la lluvia sobre los lahares más allá de los escenarios del IGP, y que un punto no esté en una zona no significa que no haya peligro. Para decidir: CENEPRED (SIGRID), la municipalidad y el IGP o INGEMMET.
- **Verificación.** `test/volcan.spec.ts` y `test/asistente-volcan.spec.ts`; `scripts/verificar-datos.mjs` comprueba la integridad del archivo (tipos, niveles, anillos cerrados, conteos que cuadran con la metadata), 400 puntos al azar frente a un método independiente de número de vueltas (0 diferencias) y la parte de Paucarpata y Cayma en cada nivel frente a una muestra independiente cada 150 m (±4 puntos).

### 12.7 Peligro sísmico oficial: qué se revisó y por qué no se integró

Se revisaron las dos capas del IGP que podrían dar un peligro sísmico por punto (consultadas el 2026-11-03):

- `monitoreocensis/PeligroSismico`: isolíneas «Periodo_retorno_500» (contornos de 310 a 400 en la caja de Arequipa) y «Periodo_retorno_1000» (380 a 470), campo `contour` sin unidades, sin descripción ni fecha, con un campo de prueba (`prueba`/`multiplo`) y sin polígonos. Se infiere una aceleración en gal (cm/s²), pero **no está documentado**; interpolar entre isolíneas sin unidades confirmadas sería inventar un valor.
- `monitoreocensis/AceleracionGRD`: una capa de líneas por magnitud y departamento (`sismos_magnitud`); **sin registros para Arequipa**.
- Resultado: **no hay peligro sísmico oficial por punto verificable en la API del IGP**. La referencia normativa sigue siendo la zona sísmica de la Norma E.030 por distrito (§4), que ya está en el proyecto (módulo de desastre, oculto). La API solo ofrece los sismos reportados de 2026 (§12.3); el **catálogo histórico (1960 en adelante) debe descargarse a mano** de `https://www.datosabiertos.gob.pe/dataset/cat%C3%A1logo-s%C3%ADsmico-desde-1960-instituto-geof%C3%ADsico-del-per%C3%BA-igp` (o de `https://ultimosismo.igp.gob.pe/repositorio/datos-sismicos`) y congelarse con fecha; no se hizo.

### 12.8 Riesgo del distrito ante El Niño (CENEPRED)

- **Qué es.** El nivel de riesgo (bajo, medio, alto o muy alto) que el CENEPRED estima para cada **distrito** ante **inundaciones** y ante **movimientos en masa** en un escenario de lluvias como las de los veranos de 1983, 1998, 2017 y 2023 (años El Niño). Es un escenario, no un pronóstico. Siempre INFORMATIVO: nunca cumple / no cumple ni puntaje.
- **Fuente.** SIGRID del CENEPRED, servicio `https://sigrid.cenepred.gob.pe/arcgis/rest/services/FEN/ER_NINO2027_BD/MapServer` (consulta pública sin llave, CORS abierto, consultada el 2026-11-03), capa 4 «Riesgos a inundación» y capa 5 «Riesgos a movimientos en masa» (polígonos distritales; los 25 de `distritos_aqp.geojson` se emparejan por ubigeo). Se congelan con `node scripts/descargar-riesgo-cenepred.mjs` en `public/data/riesgo_cenepred_fen2027.json`.
- **Cita de la metodología.** CENEPRED (2026). «Estudio de escenarios de riesgo por inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño», mayo de 2026 (Subdirección de Gestión de la Información, Dirección de Gestión de Procesos). https://sigrid.cenepred.gob.pe/sigridv3/storage/biblioteca//22033_estudio-de-escenarios-de-riesgo-por-inundaciones-y-movimientos-en-masa-ante-lluvias-intensas-asociadas-al-fenomeno-el-nino.pdf La capa dice estar «actualizada en base al Informe Técnico N.° 69-2026/SENAMHI-DMA-SPC»; ese informe no se encontró, así que no se sabe qué cambió respecto del estudio de mayo. También se usó, para el método de los indicadores: CENEPRED (2024), «Escenarios de riesgo por inundaciones y movimientos en masa en el marco del Plan Multisectorial 2025-2027».
- **Cómo se obtiene el nivel (del estudio).** Susceptibilidad del distrito (el nivel que predomina en más del 50 % de su ámbito, combinado con las zonas y puntos críticos registrados por INGEMMET y la ANA, a partir de la anomalía de lluvias de los cuatro eventos El Niño) por vulnerabilidad (exposición de viviendas, locales educativos, establecimientos de salud, red vial y superficie agrícola en áreas altamente susceptibles, más fragilidad: pobreza monetaria y porcentaje de establecimientos de salud expuestos). «Los resultados se presentan en cuatro niveles de riesgo: muy alto, alto, medio y bajo».
- **Campos que se usan y su significado confirmado.** El servicio no documenta sus campos (el alias de cada uno es su propio nombre). Se confirmaron con el estudio:
  - `nriesgo_in` (capa 4) y `nriesgo_mm` (capa 5): nivel de riesgo del distrito (la leyenda de la capa lo rotula con esos cuatro niveles; «Muy Alto» y «Muy alto» son el mismo).
  - `viv_sinu` (capa 4) y `vivsm_ma_a` (capa 5): viviendas del distrito en áreas de mayor susceptibilidad; `iiee_sinu` y `iiee_smm`: locales educativos; `eess_sinu` y `eess_smm`: establecimientos de salud. Son los indicadores de exposición del estudio (§5.2, Tablas 5 y 6 y los totales «mayor susceptibilidad» de sus Tablas 7 a 10). **Cómo se confirmó la correspondencia:** el servicio trae además las clases 1 a 5 de esos indicadores (`viv_1`, `eess_1`) y, aplicando los rangos de las Tablas 5 y 6 a las viviendas y a los establecimientos de salud, coinciden en los 109 distritos de Arequipa; el script repite esa comprobación en cada descarga y no escribe nada si deja de cuadrar. (Los locales educativos se muestran igual, pero la tabla trae una fila ambigua para 1 local en movimientos en masa, así que no entran en esa comprobación.)
  - **No se usan:** `pob_2017` y `viv_2017` (en varios distritos las viviendas casi igualan o superan a la población, lo que no cuadra con el censo), los niveles intermedios de susceptibilidad y vulnerabilidad (`niv_sinu`, `npel_mm`, `nvuln_in`, `vuln_mm`: las etiquetas coinciden uno a uno con los valores 1 a 5 de las matrices del estudio, pero el servicio no las documenta), `v_smm2` (es el valor de susceptibilidad 1 a 5, **no** un número de viviendas) y el resto de los campos de apoyo.
- **Un dato a tener en cuenta.** El estudio generaliza la susceptibilidad al ámbito del distrito y, cuando el nivel predominante es muy alto, todas las viviendas del distrito cuentan como expuestas (p. ej. Sachaca: 7 926 de 7 926). Los conteos son por distrito, no una medida de cuántas viviendas se inundarían.
- **Resultado (2026-11-03, los 25 distritos).** Inundación: muy alto 7 (Arequipa, Jacobo Hunter, José Luis Bustamante y Rivero, La Joya, Sachaca, Socabaya, Yanahuara), alto 17, medio 1 (Chiguata), bajo 0. Movimientos en masa: muy alto 0, alto 4, medio 17, bajo 4.
- **Cálculo.** `public/js/cenepred.js` (puro, con pruebas): `buscar` encuentra el distrito por ubigeo o por nombre (con `Distritos.buscarNombre`), `frase` arma «Según el CENEPRED, el distrito de Sachaca tiene riesgo muy alto ante inundaciones … en un escenario El Niño (estimación por distrito, no del predio).», `lineas` los conteos y `porNivel` la leyenda del mapa. Un distrito que no está en los datos (Vítor y los de Siguas) da SIN DATO con su causa.
- **Dónde aparece.** «Contexto de riesgo (informativo)» (tarjeta con fuente, fecha, método y «Qué no cubre»), una frase en el resumen en llano del punto, el perfil del distrito en el chat, una fila informativa en «Comparar puntos» (los puntos guardados antes quedan «Sin dato»), la sección de contexto del informe PDF, el chat (reglas y Gemini) y el mapa, que colorea los 25 distritos por nivel de un fenómeno a la vez, con leyenda por nivel (con los nombres cuando son pocos), globo por distrito y sin depender solo del color. El elemento «Peligros y riesgo de desastres» de «Verificaciones recomendadas antes de comprar» apunta al visor público del SIGRID (`https://sigrid.cenepred.gob.pe/sigridv3/`, HTTP 200 el 2026-11-03).
- **Qué no cubre.** Es el escenario del **distrito**, no del predio: dentro de un distrito el riesgo cambia mucho de una calle a otra (el estudio mismo recomienda «evaluaciones de riesgos con mayor detalle» en los distritos de riesgo alto y muy alto). No es una predicción de que vaya a llover así ni de que algo vaya a inundarse. Para decidir: la evaluación de riesgos de la municipalidad y el SIGRID del CENEPRED. La definición de «movimientos en masa» (deslizamientos, huaicos y derrumbes) es la general del campo; el estudio no la enumera.
- **Capas de susceptibilidad (1 y 2): no integradas.** Son capas ráster del mismo servicio (`Raster Layer`) que rechazan la consulta por envolvente con 400. La identificación de un punto sí responde, pero solo da «Pixel Value» (3 para inundación y 4 para movimientos en masa en un punto de Sachaca), sin tabla de clases: no se puede saber si el valor 3 es «medio» o «alto» (la leyenda lista cinco clases, de «Muy Bajo» a «Muy Alto», sin decir el valor de cada una), y su descripción habla de centros poblados de otro estudio («escenario de riesgo por lluvias para el verano 2027», Informe Técnico N.° 07-2026/SENAMHI-DMA-SPC). Sin esa tabla no se afirma nada.
- **Verificación.** `test/cenepred.spec.ts`, `test/riesgo-cenepred-datos.spec.ts`, `test/asistente-cenepred.spec.ts`, las secciones nuevas de `test/capas.spec.ts`, `test/comparar.spec.ts`, `test/reporte.spec.ts`, `test/resumen.spec.ts`, `test/verificaciones.spec.ts` y `test/integracion-distritos.spec.ts`; `scripts/verificar-datos.mjs` comprueba los 25 distritos por ubigeo, que los niveles sean los conocidos, los conteos enteros, el resumen por nivel y que 400 puntos al azar den el nivel del distrito que da un método independiente.

## 13. Precio de oferta por m² del distrito (informativo)

**Regla común.** Es un dato de contexto, igual que §12: no hay umbral que diga si un precio es alto o bajo, así que su estado es **INFORMATIVO** (o **SIN DATO** con su causa). Nunca produce CUMPLE / NO CUMPLE, nunca es una prioridad de «Comparar puntos» y nunca entra en un puntaje.

- **Fuente y licencia.** Aptología (Daniel Mauricio Pinzón Pineda), estudio «Vivienda en Arequipa: precio por m², arriendo, habitaciones y rentabilidad (octubre 2026)». Datos abiertos bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Verificado el 2026-11-03: la ficha del conjunto de datos declara `license: cc-by-4.0` (<https://huggingface.co/datasets/aptologia/vivienda-arequipa-por-distrito-2026>), y la página de condiciones de la fuente (<https://www.aptologia.com/datos-abiertos>) dice que los datos, CSV y gráficas se publican bajo Creative Commons Atribución 4.0 Internacional, que no se requiere inicio de sesión ni llave de API, y pide la atribución «Datos: Aptologia» con un enlace visible a la página de origen del dato. La fuente canónica del estudio está en <https://github.com/elbroker/aptologia-datos/tree/main/estudios/vivienda-arequipa-por-distrito-2026>. La descarga es una solicitud HTTP simple a un CSV público; no se eludió ninguna protección.
- **Qué mide.** La **mediana del precio pedido por m²** de departamentos en venta, por distrito, a partir de avisos de portales inmobiliarios vistos del 11 al 18 de octubre de 2026 (corte del 18 de octubre), deduplicados entre portales y recortados al percentil 1-99. Es precio de **oferta** (lo que se pide en el aviso), **no de cierre**. Se publica solo con al menos 30 avisos por distrito; el arriendo no alcanza esa muestra en ningún distrito de Arequipa.
- **Cobertura real.** De los 25 distritos del GeoJSON, **3 tienen cifra**: Cayma (S/ 4 905/m², 118 avisos), Yanahuara (S/ 4 765/m², 47 avisos) y Cerro Colorado (S/ 4 390/m², 108 avisos); 273 avisos de venta en total. Para los otros 22 el resultado es SIN DATO con la causa («la fuente solo publica cifras con al menos 30 avisos»); no se estima ni se interpola.
- **Descarga.** `node scripts/descargar-precios.mjs` → `public/data/precios_m2_distrito.json`. El script exige que la ficha del conjunto declare CC BY 4.0 (si no, no escribe nada), normaliza el nombre del distrito (sin tildes, en mayúsculas, con alias como «José Luis Bustamante») para que coincida con `distritos_aqp.geojson`, redondea a soles enteros y guarda en el JSON: fuente, URLs, licencia, texto de atribución, cita, fecha de descarga, periodo de los datos, tipo («precio de oferta (avisos), no de cierre»), moneda (PEN), unidades, estadístico, muestra mínima y número de avisos. Si la descarga falla se conserva el archivo anterior.
- **Cálculo.** Ninguno: `Precios.buscar(datos, distrito)` (`public/js/precios.js`) busca el distrito del punto y devuelve la cifra publicada; es una función pura con `test/precios.spec.ts`.
- **En la ficha.** Sección «Precio de referencia del distrito»: tarjeta desplegable «Precio de oferta del distrito» con la cifra, el número de avisos, el periodo, el enlace *Datos: Aptologia*, la licencia y «Qué no cubre» (precios pedidos y no de cierre; mediana del distrito y no el precio de este inmueble; solo departamentos y distritos con al menos 30 avisos; periodo corto, sin tendencia). La atribución también figura en «Fuentes de datos».
- **En «Comparar puntos».** Fila informativa «Precio de oferta del distrito (por m²)» en un bloque aparte, rotulado como promedio del distrito y no del inmueble. Dos puntos del mismo distrito muestran la misma cifra. Los puntos guardados antes de existir la fila aparecen como SIN DATO.
- **En el PDF.** Sección «Precio de oferta del distrito (informativo)» con la cifra, el periodo, la atribución, la licencia y lo que no cubre, una fila en el resumen y una limitación.
- **En el asistente.** «¿Cuánto cuesta el m² en X?» se responde con esta cifra (reglas: intención `precio`; Gemini: intención `precio_distrito` con el distrito validado contra la lista de 25). El texto dice que es oferta y no cierre, el promedio del distrito, el periodo y la atribución; sin cifra para el distrito, lo dice y nombra los que sí tienen. **El precio de «esta casa», de un terreno, un alquiler o una búsqueda por precio sigue fuera de alcance** y la respuesta dice que solo se conocen promedios de oferta por m² de algunos distritos.
- **Verificación.** `test/precios.spec.ts`, `test/asistente-precio.spec.ts`, las secciones nuevas de `test/comparar.spec.ts`, `test/reporte.spec.ts` y `test/asistente-llm.spec.ts`, y las comprobaciones «Precios» de `scripts/verificar-datos.mjs` (metadatos y atribución, fechas, rotulado de oferta, nombres iguales a los del GeoJSON, rangos y muestra mínima, suma de avisos, SIN DATO en un distrito sin cifra).
- **Lo que no se verificó.** Que los avisos reflejen el mercado real (solo se contrastó que las tres cifras coincidan con las publicadas por Aptología) ni la calidad del recorte de valores atípicos de la fuente. TuLugar publica otro índice (USD 1 441/m² para Arequipa) con una muestra pequeña; no se usa porque su licencia no permite rehospedar el conjunto de datos.
