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

**Fuente y marco legal.**

- Plano de Zonificación y Reglamento del Plan de Desarrollo Metropolitano (PDM) de Arequipa 2016-2025, de la Municipalidad Provincial de Arequipa (MPA) e IMPLA.
- **Ordenanzas.** La Ordenanza Municipal 961-MPA aprobó el PDM 2016-2025. La Ordenanza 975-MPA es la «restitución de zonificación urbana y desarrollo de secciones viales metropolitanas en el PDM Arequipa 2016-2025». El plano que usa la aplicación es el de la zonificación restituida por la 975, dentro del PDM aprobado por la 961. (Fuente: presentación del Colegio de Arquitectos del Perú, que las cita junto con el texto de la sentencia.) **Hay un relato distinto sin resolver:** el resumen de una búsqueda sobre un comunicado del IMPLA de agosto de 2025 (la página no se pudo abrir para leerlo) describe las ordenanzas 961 y 975 como los dos únicos cambios de zonificación hechos al PDM 2016-2025, ambos para proyectos del sector Salud. No se pudo leer el texto de ninguna de las dos ordenanzas en el portal municipal, que bloquea las descargas automáticas; el equipo debe confirmarlo en el portal normativo de la Municipalidad.
- **Vigencia.** El Título Preliminar del Reglamento (portal de transparencia de la MPA, documento fechado en 2016) establece: «La vigencia del presente Plan se establece en diez (10) años […], debiendo procederse posteriormente a su revisión o actualización.» Un PDM nuevo está en consulta pública: la página de la MPA indica que la etapa inició el 13 de octubre de 2025 y terminó el 11 de diciembre de 2025.

**Cómo se obtuvo cada archivo.**

| Archivo | Procedimiento | Verificación |
|---|---|---|
| `zonas_aqp.geojson` (793 polígonos, EPSG:4326) | Declarado por el equipo: polígonos extraídos del PDF vectorial del plano con QGIS; el código se asignó por el **color de relleno** usando la leyenda. | Comprobado por script: los 29 colores corresponden **uno a uno** con los 29 códigos, sin conflictos. Comparado con lugares reales de OpenStreetMap (hospitales, universidades, aeropuerto): coherente y muy por encima del azar, con 6 casos sin explicación por revisar (`VALIDACION.md` §2.2). El equipo también reporta haber contado etiquetas. **No comprobado:** la exactitud de cada polígono frente al plano oficial (`VALIDACION.md` §3.1). |
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
- Este contraste usa una **copia** del Título III. La misma copia está alojada en dos municipalidades distritales (Yanahuara y Yura) y los dos archivos son **idénticos byte a byte** (mismo MD5, `90256c11ac9a79870e9c9f466db5db6f`): no son fuentes independientes entre sí, pero sí confirman que circula un único documento. La carátula del PDF lleva el encabezado de la MPA y fue creado el 2016-02-08. El Título III en el portal oficial de la MPA no se pudo descargar (nombre de archivo no localizado y bloqueo de descargas automáticas). Conviene que el equipo lo confirme una vez contra el portal oficial.

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
- El código se asignó por color: cerca del borde entre zonas puede no ser exacto. El plano pinta con el mismo color varios niveles de `E` y `H`, y la zona agrícola con la de expansión agrícola (`ZA`).
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
