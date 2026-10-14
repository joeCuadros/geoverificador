# GeoVerificador — Metodología y trazabilidad

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
| De entorno | ¿Hay servicios, transporte y áreas verdes cerca? | OpenStreetMap | §6 |

## 2. Cómo se calcula «cerca»

- Distancia entre dos puntos: fórmula de **haversine** con radio medio terrestre de 6 371 008,8 m (`public/js/geo.js`).
- Radio de peligros y de denuncias: **500 m** (`CONFIG.peligros.radio`, `CONFIG.delitos.radio`). Es un valor de trabajo (unas cinco cuadras), no un umbral con base empírica; se puede cambiar en `public/js/config.js`.
- El código del navegador se contrasta con una fórmula independiente (ley esférica de los cosenos) en `scripts/verificar-datos.mjs`; ver `VALIDACION.md`.

## 3. Riesgo normativo: zonificación

**Fuente y marco legal.**

- Plano de Zonificación y Reglamento del Plan de Desarrollo Metropolitano (PDM) de Arequipa 2016-2025, de la Municipalidad Provincial de Arequipa (MPA) e IMPLA.
- **Ordenanzas (leídas del texto de la Ordenanza 975, que el equipo aportó).** Sus considerandos dicen: «mediante Ordenanza Municipal 961, del 03 de febrero de 2016, se aprueba el Plan de Desarrollo Metropolitano de Arequipa, PDM Arequipa 2016-2025». La Ordenanza 975, aprobada por el Concejo Municipal en sesión del 29 de abril de 2016 (el cargo de trámite del documento lleva el sello del 17 de mayo de 2016), se titula «Restitución de zonificación urbana y desarrollo de secciones viales metropolitanas en el PDM Arequipa 2016-2025». Explica que, al aplicar el PDM, se detectaron «imprecisiones gráficas y/o omisiones de zonificación en predios que en el Plan Director […] 2002-2015 figuraban en áreas urbanas» y dispone restituir la zonificación de los predios del Anexo 01, **actualizando el Plano 2.2 de Zonificación y el Plano 2.4 de Expansión Urbana** (y los planos viales 2.3 y 2.3.1 con el Anexo 02). Aclara además que, conforme al D.S. 004-2011-VIVIENDA, la ordenanza «no incurre en causal de modificación» del PDM. Es decir: la **961 aprueba el PDM** y la **975 corrige su plano de zonificación**; el plano que usa la aplicación debe ser el Plano 2.2 tal como quedó tras la 975. (Esto último es lo declarado por el equipo: se trabajó con el plano publicado con la 975.)
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
| Distrito, zona sísmica y Z | Punto-en-polígono sobre los límites del INEI; zona y Z de la E.030 | `distritos.js`, `distritos_aqp.geojson`, `zonas_sismicas_e030.json` |
| Riesgos identificados | Reglas del catálogo sobre los datos anteriores | `riesgos.js` (`CATALOGO`, `identificar`) |
| Nivel de cada riesgo | Probabilidad × impacto elegidos por el usuario (matriz 3 × 3) | `riesgos.js` (`nivel`) |
| Resumen del punto | Une las líneas anteriores sin puntaje | `app.js` (`renderResumen`) |

## 8. Cómo reproducir

```bash
npm install
node scripts/descargar-peligros.mjs   # public/data/peligros_aqp.geojson
node scripts/descargar-delitos.mjs    # public/data/delitos_aqp.geojson
node scripts/descargar-distritos.mjs  # public/data/distritos_aqp.geojson
node scripts/verificar-datos.mjs      # comprobaciones automáticas
npm run start:dev                     # http://localhost:3000
```

Las fuentes públicas cambian: al volver a descargar, las cifras de este documento pueden cambiar. La fecha de cada descarga queda en `metadata.descargado` de cada archivo.

## 9. Lo que la ficha no cubre (huecos declarados)

- Peligro volcánico (Misti), licuación y amplificación por el suelo del predio, y tsunami. El peligro sísmico solo está a escala de distrito (zona E.030).
- Precio del suelo, rentabilidad o demanda: no se relaciona ningún factor con el valor de un predio. Eso exigiría datos de precios y es un trabajo aparte.
- Calidad de la construcción, servicios básicos (agua, desagüe, luz) y situación legal del predio (títulos, cargas).
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
| Comunicar | La herramienta | Descarga del registro en CSV (y dentro del JSON de descarga) con evidencias, fuentes, evaluación, decisión y acciones | Deja constancia de qué se sabía y qué se decidió |

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
