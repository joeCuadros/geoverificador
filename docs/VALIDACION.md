# GeoVerificador — Verificación y validación

Distinguimos dos cosas, porque responden preguntas distintas:

- **Verificación (hecha, automática):** ¿el código calcula lo que dice calcular y los archivos están íntegros?
- **Validación (pendiente, con personas y documentos externos):** ¿los datos coinciden con la realidad y la herramienta sirve a quien la usa?

> **Estado honesto:** la verificación está hecha y se puede repetir con un comando. De la validación externa se hicieron cuatro partes (§2.1: la tabla de reglas contra el Reglamento oficial; §2.2: los polígonos contra lugares reales de OpenStreetMap; §2.3: la superficie contra la Memoria oficial; §2.4: los polígonos contra el PDF oficial del plano); lo demás **todavía no se ha hecho**: este documento define el protocolo y deja las plantillas vacías. Ningún resultado que no exista aparece aquí.

## 1. Hipótesis y criterios de éxito

| # | Hipótesis | Cómo se prueba | Criterio de éxito (fijado el 2026-10-12, antes de medir) |
|---|---|---|---|
| H1 | La zona que la app asigna a un punto coincide con la zonificación oficial (certificado de zonificación y vías). | §3.1 (la fidelidad del archivo al plano ya está en §2.4) | ≥ 90 % de coincidencia en la muestra, y registrar dónde falla. |
| H2 | Con la app se responde «qué se puede construir aquí» más rápido y sin perder aciertos que con el PDF y el reglamento. | §3.2 | Menor tiempo mediano con igual o mayor proporción de respuestas correctas. |
| H3 | El mapa de calor de denuncias es coherente con lo que se sabe de la ciudad. | §3.3 | Revisión cualitativa; no se declara como predictor. |

**Los criterios quedan fijados con este commit**, antes de medir cualquier resultado de H1 y H2. Si el equipo decide otros, el cambio debe hacerse en un commit explícito antes de levantar datos, de modo que el historial del repositorio muestre que no se ajustaron al resultado. El criterio de H3 es cualitativo a propósito: no se declara el mapa de calor como predictor.

## 2. Verificación automática (hecha)

Comando (sin internet ni dependencias):

```bash
node scripts/verificar-datos.mjs
```

Corrida del 2026-10-13: **43 de 43 comprobaciones correctas.**

**A. Integridad de los archivos**

- Zonas: formato GeoJSON, todos los polígonos con `codigo` y `color`, todo código del plano existe en la tabla de reglas, coordenadas dentro de Arequipa, y cada color corresponde a un solo código (29 colores, 29 códigos, sin conflictos).
- Reglas: 29 códigos con nombre y `edificable` válido; `coef_max` nunca menor que `coef_base`.
- Delitos: el número de registros coincide con los metadatos; solo robo y hurto; fechas válidas; ids únicos; sin dirección, cuadra ni hora exacta; la cobertura mensual guardada coincide, mes a mes, con los registros descargados.
- Peligros: número de registros coincide con los metadatos; ningún código crudo quedó sin traducir; ids únicos; años coherentes.

- Distritos y zona sísmica: 25 distritos con ubigeo, nombre y fuente del límite; ubigeos únicos; la transcripción del Anexo II de la E.030 tiene 21 distritos de la provincia en zona 3 y 8 en zona 4; los factores Z coinciden con la Tabla N.° 1; todos los distritos tienen zona.

**B. Cálculos del navegador frente a un método independiente.** Se ejecuta el mismo código que corre en el navegador (`zonificacion.js`, `peligros.js`, `delitos.js`) y se compara con un cálculo escrito aparte, con puntos al azar de semilla fija:

| Cálculo | Método independiente | Muestra | Diferencias |
|---|---|---|---|
| Zona de un punto | Número de vueltas (winding number) en lugar de ray casting | 2 000 puntos (402 dentro del plano) | 0 |
| Potencial constructivo | Aritmética directa con una regla real | 3 comprobaciones | 0 |
| Peligros a 500 m y más cercano | Fuerza bruta con ley esférica de los cosenos | 200 puntos | 0 |
| Distrito del punto | Número de vueltas (winding number) | 1 500 puntos, más la Plaza de Armas (distrito Arequipa, zona 3, Z = 0,35) | 0 |
| Registro de riesgos | 14 casos sintéticos (cada regla con su dato y sin él) | 14 casos; además: fuentes en cada riesgo y acción, sin valores precargados y matriz 3 × 3 completa | 0 |
| Denuncias a 500 m (total, robo, hurto) | Fuerza bruta con ley esférica de los cosenos | 300 puntos (169 con ≥ 1 denuncia) | 0 |
| Periodo de denuncias | Regla de cobertura reescrita | 1 | 0 |

**Se comprobó que la prueba puede fallar** (también en las reglas de riesgo: cambiar «menor que» por «menor o igual que» en la regla del lote mínimo hace fallar un caso). al introducir a propósito un error en el radio de las denuncias (+50 m), la prueba reportó 139 diferencias en 300 puntos y falló.

**Qué NO demuestra la verificación:** que el plano esté bien digitalizado ni que las denuncias reflejen el delito real. Solo que, dados los datos, el cálculo es correcto.

## 2.1 Validación externa ya hecha: reglas frente al Reglamento

Se contrastó `reglas_zonas.json` con el texto del Título III del Reglamento del PDM (zonificación y compatibilidades). Resultado: **29 de 29 códigos coinciden** en lote mínimo, frente, pisos, coeficiente, área libre y condición de edificabilidad. El detalle por grupo, las observaciones (una discrepancia interna del propio Reglamento en RDA-1 y una errata «ZRE-RE») y las fuentes están en `METODOLOGIA.md` §3.

Fuente: el Capítulo IV oficial de la Memoria del PDM (archivo aportado por el equipo) y la copia del Título III alojada por municipalidades distritales; los 201 valores numéricos de la copia aparecen en el documento oficial, sin faltantes (detalle en `METODOLOGIA.md` §3). Límites: se compararon valores numéricos, no cada palabra, y se validó la **transcripción de las reglas**, no los polígonos del plano.

## 2.3 Validación externa ya hecha: superficie frente a la Memoria oficial

La Memoria oficial del PDM (Título II) establece que el ámbito define 50 246 ha, de las cuales el **área urbana representa 37 107 ha** y el área de expansión urbana de reserva 3 818 ha. La suma de las áreas de los 793 polígonos digitalizados es **38 233 ha** (calculada con proyección local; muestreando 12 127 puntos dentro del plano no se encontró ninguno cubierto por dos polígonos, así que no hay doble conteo), es decir **+3,0 %** frente a la cifra oficial. La comprobación automática acepta ±10 % como cota de cordura; el 3,0 % es lo observado, no un criterio fijado para pasar.

**Qué respalda:** que la escala, la proyección y la cobertura total del plano digitalizado son coherentes con el plano oficial; descarta, por ejemplo, un error de escala o la pérdida de zonas enteras.
**Qué no respalda:** la exactitud de cada polígono ni de cada código; dos errores opuestos se compensarían en la suma. Tampoco se sabe con certeza qué incluye exactamente la cifra oficial de «área urbana» (el plano incluye zonas agrícolas, de reserva y de riesgo, como `ZA` con 8 140 ha), por lo que la diferencia de 3 % no se interpreta como una tasa de error.

## 2.4 Validación externa ya hecha: polígonos frente al PDF oficial del plano

El equipo aportó el PDF del plano publicado con la Ordenanza 975 (ArcMap 10.1, creado el 2016-05-18; SHA-256 `3d7b899d0ab472ed426048e1425c9f95c6a3b120be20ff116b1e34049abea27b`). El script `scripts/validar-zonificacion-plano.mjs` re-extrae de ese PDF sus polígonos (rellenos vectoriales) y etiquetas, los georreferencia con los puntos de control del propio PDF y los compara con `zonas_aqp.geojson` (comando: `npm run datos:validar-plano -- "ruta/al/plano.pdf"`; el PDF no se versiona; resultado en `docs/validacion/resultado-plano.json`).

| Comprobación | Resultado |
|---|---|
| Colores | 29 de 29 idénticos |
| Polígonos | 793 = 793, mismo número en cada uno de los 29 códigos |
| Área por código | −0,22 % a −0,24 % en todos (diferencia uniforme por proyección, no por datos) |
| 30 000 puntos al azar | 13,251 de 13,255 coinciden (99.970 %); 0 puntos pintados por el PDF y omitidos por la app o viceversa |
| Etiquetas impresas (793) | 778 (98.1 %) coinciden; las demás a ≤ 97 m de su propio polígono |
| Georreferenciación | Rectángulo UTM alineado; la cuadrícula impresa coincide (Este ≤ 4 m) |
| Discrepancias de OSM (§2.2) | En 1 147 de 1 148, el plano oficial pinta la misma zona que la app |

**Qué cierra.** La duda de si el GeoJSON reproduce el plano: sí, con una concordancia del 99,97 % en puntos y número de polígonos idéntico por código. También resuelve los seis casos «sin explicación» de §2.2: en esos puntos **el plano oficial pinta la misma zona** que la app, de modo que no son errores del equipo; si hay un error, está en el plano o en la ubicación del lugar en OpenStreetMap.

**Qué no cierra.** Que ese PDF sea la versión vigente (lo aportó el equipo, no se descargó del portal), que el plano coincida con la realidad legal de cada predio (§3.1, con certificados) y qué ocurrió con modificaciones posteriores a 2016. Nueve polígonos grandes se extienden más allá del marco impreso (ver `METODOLOGIA.md` §3).

## 2.2 Validación externa ya hecha: polígonos frente a lugares reales (OpenStreetMap)

**Qué se hizo.** Se tomaron de OpenStreetMap (fuente independiente del plano) los hospitales, universidades, parques y aeropuertos de Arequipa metropolitana, se ubicó cada uno en el plano con el mismo código de la aplicación y se midió cuántos caen en la zona que el Reglamento les asigna. La expectativa de cada tipo sale del texto del Reglamento y se fijó antes de ver los resultados:

| Tipo OSM | Zona esperada | Respaldo en el Reglamento |
|---|---|---|
| Hospital | `H` | 3.4 Servicios Públicos Complementarios: Salud (H-1 a H-4) |
| Universidad | `E` | 3.4: Educación Superior Universitaria (E-3) |
| Parque | `ZR` | 3.6 Zonas de Recreación (plazas, parques, campos deportivos…) |
| Aeropuerto | `OU2` | 3.5 Usos Especiales tipo 2 (terminales terrestres, ferroviarios y aéreos) |

Los cementerios se excluyeron: el Reglamento no les asigna una zona, y suponerla sería inventar la expectativa. Además de la tasa de acierto se calcula la **base**: qué porcentaje de puntos al azar dentro del plano cae en esa misma zona, para saber si la tasa es mejor que el azar.

**Datos y reproducción.** Referencia guardada en `docs/validacion/osm_referencia.json` (OpenStreetMap, licencia ODbL; descargada el 2026-10-12, datos OSM al 2026-05-06). Comando: `npm run datos:validar-osm` (no necesita internet). Resultado completo, con las discrepancias una por una, en `docs/validacion/resultado-osm.json`.

**Resultados.**

| Tipo | Lugares (dentro del plano) | En la zona esperada | Base al azar | Lectura |
|---|---|---|---|---|
| Hospital | 24 (24) | 4 (17 %) | 0,1 % | Mucho mejor que el azar, pero la mayoría cae en otras zonas |
| Universidad | 19 (19) | 5 (26 %) | 0,4 % | Igual |
| Aeropuerto | 1 (1) | 1 (100 %) | 2,5 % | Un solo caso: casi no informa |
| Parque | 1 144 (1 126) | 12 (1 %) | 1,8 % | **No concluyente** (ver abajo) |

**Cómo leer estos números (con honestidad).**

1. **Lo que sí apoya.** Los polígonos `H`, `E` y `OU2` están donde hay hospitales, universidades y un aeropuerto muy por encima del azar. Eso es coherente con una georreferenciación y una asignación de códigos razonables, y descarta un desplazamiento grande del plano. Un caso concreto: el «Hospital Docente de la UNSA» (etiquetado como universidad en OSM) cae justo en `H`.
2. **Lo que no demuestra.** Con 24, 19 y 1 lugares la muestra es pequeña y no sirve para decir «el plano es X % exacto». Y que solo el 17-26 % caiga en `H`/`E` no es en sí un error del plano: el Reglamento remite educación y salud a la zona predominante del entorno, y OSM incluye consultorios, postas y oficinas.
3. **Lectura de las discrepancias (manual, hecha después de ver los resultados, por lo tanto exploratoria).**
   - Varias tienen una explicación en el Reglamento: hospitales y universidades dentro de `ZRE-CH` (zona de reglamentación especial del Centro Histórico: Hospital Goyeneche, Hospital Seguín Escobedo, sedes de la UNSA); el Hospital Militar en `OU2` (que incluye establecimientos de las fuerzas armadas); y postas, consultorios y filiales pequeñas en zonas residenciales o comerciales.
   - **No son errores de borde.** Se midió la distancia de cada discrepancia al polígono más cercano de la zona esperada: solo 1 de 20 hospitales y 0 de 14 universidades quedan a 50 m o menos (el único es una «Posta Médica» a 2 m). La mayoría está a cientos de metros o kilómetros de cualquier zona `H` o `E`, así que una tolerancia de ubicación no explica los casos de abajo.
   - **Casos sin explicación en el Reglamento** (en los seis, el plano oficial pinta esa misma zona, §2.4: no son errores de digitalización del equipo) (entre paréntesis, distancia a la zona esperada: «Intermedic» 1,32 km, «Fisioterapia» 1,27 km, «Centro médico Pedro P. Díaz» 238 m, «Hospital Maritza Campos Díaz» 2,58 km, «Hospital Edmundo Escomel» 439 m, «Universidad Autónoma San Francisco» 442 m): «Intermedic» y «Fisioterapia» en `RP` (reserva paisajista; -16,38832 -71,53692 y -16,38788 -71,53744), «Centro médico Pedro P. Díaz» (-16,41505 -71,50066) y «Hospital Maritza Campos Díaz» (-16,32655 -71,56015) en `ZR`, «Hospital Edmundo Escomel» en `I-1` (-16,41722 -71,50866) y «Universidad Autónoma San Francisco» en `ZA` (-16,44923 -71,60000). Dado que el plano oficial pinta esa zona, lo que queda por saber es si el plano es correcto allí, si OpenStreetMap ubica mal el lugar o si es un uso existente que la norma tolera; con estos datos no se puede decidir cuál.
4. **Parques: no concluyente.** La expectativa se fijó antes y el resultado fue 1 % (peor que la base). Se encontró después una explicación plausible: el Reglamento (3.6) dice que las áreas agrícolas zonificadas como `ZR` mantienen su condición, así que `ZR` no equivale a «parque», y OSM incluye parques de barrio demasiado pequeños para el plano. Como esa explicación se halló después de ver el resultado, **esta prueba no se usa ni a favor ni en contra del plano**.
5. **Otras limitaciones.** OSM es colaborativo y el punto de un lugar grande es su centro, que puede caer fuera de su propio edificio; una discrepancia no siempre es un error del plano.

**Qué falta para cerrar H1:** la comparación con certificados o con el plano oficial (§3.1), que es la única que da una tasa de exactitud utilizable.

## 3. Validación externa (pendiente)

### 3.1 Zonificación frente a documentos oficiales (H1)

**Objetivo:** medir el porcentaje de acierto de la zona asignada y detectar dónde falla (por ejemplo, cerca de los bordes entre zonas, por haber asignado el código por color).

**Procedimiento:**

1. Elegir una muestra de 20 a 30 puntos. Incluir: al menos un punto por cada grupo de zona (residencial, comercial, industrial, equipamiento, recreación, especial, riesgo, protección), y varios cerca de bordes entre zonas.
2. Para cada punto, obtener la zona oficial de una fuente independiente: un Certificado de Zonificación y Vías real (idealmente de predios conocidos por el equipo o por quien colabore), o el plano oficial consultado a mano.
3. Registrar el resultado de la app y el oficial en `docs/plantillas/validacion-zonificacion.csv`.
4. Calcular: % de coincidencia total, % por grupo y lista de discrepancias con su causa probable.

**Resultado:** _pendiente_.

**Cuidado:** si la muestra se elige mirando la app, se sesga a favor. Elegir los puntos **antes** de consultarla.

### 3.2 Prueba con usuarios (H2)

**Objetivo:** ver si la herramienta ahorra tiempo sin perder aciertos frente al método actual (PDF del plano y reglamento).

**Procedimiento:**

1. Reclutar de 5 a 8 personas con contacto con el tema (estudiantes de arquitectura o ingeniería civil, agentes inmobiliarios).
2. Definir de 2 a 4 tareas con respuesta correcta conocida (una de ellas puede ser armar el registro de riesgos de un predio y decir qué trámite corresponde a cada riesgo), por ejemplo: «¿Se pueden construir 5 pisos en un lote de 300 m² en este punto?» y «¿Hay algún peligro geológico registrado a menos de 500 m?». Fijar la respuesta correcta con el reglamento **antes** de la prueba.
3. Cada participante hace las tareas de las dos formas (PDF y app), alternando cuál va primero para repartir el efecto del aprendizaje.
4. Medir tiempo y si la respuesta es correcta (`docs/plantillas/prueba-usuarios.csv`). Al final, un cuestionario corto de usabilidad (por ejemplo, SUS) y una pregunta abierta: «¿qué le faltó?».
5. Reportar medianas y casos, no solo promedios; con 5 a 8 personas no hay significancia estadística, y debe decirse así.

**Resultado:** _pendiente_.

### 3.3 Coherencia del mapa de calor (H3)

**Objetivo:** comprobar que lo que muestra el mapa tiene sentido, sin afirmar que prediga nada.

**Procedimiento:** con conocedores de la ciudad (vecinos, serenazgo, estudiantes), revisar si las zonas más intensas coinciden con lo esperado (centro, mercados, ejes comerciales) y anotar discrepancias. Opcional: comparar con las estadísticas por distrito que publica la fuente.

**Resultado:** _pendiente_. Lo único que se puede afirmar hoy, porque se observó en el mapa, es que el centro histórico y los ejes de la Av. Ejército y de Cayma concentran la mayor densidad; eso es una observación, no una validación.

### 3.4 OpenStreetMap frente a RENIPRESS y ESCALE (K2)

**Resultado de la primera corrida (2026-11-09, resultado completo en `docs/validacion/k2-resultado.json`; las cifras de lo oficial tenían tres errores de filtro que se corrigieron el mismo día, ver «Decisión tomada y corrida corregida» más abajo, y la conclusión no cambia):** con los archivos oficiales **OpenStreetMap no alcanza el criterio de aceptación fijado antes de medir (85 % de exhaustividad y de precisión), ni en salud ni en educación**. Es una corrida real; los números salen del script sin ajustes.

**Archivos usados.** RENIPRESS: `RENIPRESS_30-10-2026.csv` (edición del 2026-10-30, `datosabiertos.gob.pe`; 36 249 filas). ESCALE: `Padron_web_20261030.zip` (padrón al 2026-10-30; `Padron_web.dbf` con 180 943 registros). OpenStreetMap: la copia congelada del 2026-10-28. Comando: `--min-exhaustividad=0.85 --min-precision=0.85 --fecha-escale=2026-10-30 --fecha-renipress=2026-10-30`.

**Preparación de los archivos en la primera corrida (ya no hace falta: el script lee el CSV y el DBF tal cual).** Las descargas directas con `curl` funcionaron esta vez (el CSV de RENIPRESS y el ZIP de ESCALE; no hizo falta el navegador). (1) El CSV de RENIPRESS no trae columnas `LATITUD` y `LONGITUD`: trae `NORTE` y `ESTE`, que en las 967 filas de Arequipa con valor son grados decimales (por ejemplo -16,4 y -71,5; ninguna es UTM ni está invertida), y se renombraron en el encabezado para que el script las acepte; se dejaron solo las filas del departamento de Arequipa. (2) El padrón de ESCALE viene en `.dbf` con codificación CP850; se convirtió a CSV UTF-8 con un conversor propio fuera del repositorio y se dejaron solo las filas del departamento de Arequipa (8 463).

**Qué quedó en la comparación.** RENIPRESS: de 1 688 filas del departamento, se descartaron 710 sin coordenadas (**el 42 %**), 194 de otra provincia, 30 fuera de la zona, 72 inactivas, 243 consultorios y 33 repetidas, y quedaron **406 establecimientos**. ESCALE: de 8 463 filas se descartaron 41 sin coordenadas, 2 357 de otra provincia, 313 fuera de la zona y 1 998 de otro nivel, y quedaron 3 754 instituciones en **2 227 locales** (una fila por código de local).

| Categoría | Oficiales | En OSM | Exhaustividad (50 / 100 / 200 m) | Precisión (50 / 100 / 200 m) | Desfase (mediana; p90, a 200 m) | Puntos de la malla (1 536) donde cambia CUMPLE / NO CUMPLE |
|---|---|---|---|---|---|---|
| Salud (1000 m) | 406 | 164 | 19,2 / 19,7 / 20,2 % | 49,7 / 51,0 / 52,2 % | 10 m; 31 m | 97 (6,3 %): OSM cumple y el oficial no, 20; el oficial cumple y OSM no, 77 |
| Educación (todos los niveles) | 2 227 | 2 151 | 42,7 / 45,6 / 46,7 % | 44,9 / 48,0 / 49,2 % | 6 m; 45 m | no se calcula por total |
| Inicial (500 m) | 1 666 | 1 191 | 41,3 / 43,8 / 45,1 % | 58,1 / 61,6 / 63,4 % | 6 m; 44 m | 103 (6,7 %): 27 y 76 |
| Primaria (1500 m) | 1 273 | 892 | 42,9 / 47,3 / 48,5 % | 63,3 / 69,8 / 71,6 % | 10 m; 53 m | 65 (4,2 %): 6 y 59 |
| Secundaria (3000 m) | 717 | 556 | 41,1 / 47,1 / 48,5 % | 56,1 / 64,3 / 66,2 % | 15 m; 60 m | 73 (4,8 %): 3 y 70 |

La diferencia mediana de la distancia al establecimiento más cercano es de 14 m en salud, 20 m en inicial, 17 m en primaria y 34 m en secundaria (percentil 90: 436, 406, 306 y 757 m). Por distrito (radio de 200 m), la exhaustividad más baja en salud es la del Cercado (6 de 111, 5,4 %), Yanahuara (2 de 51, 3,9 %) y Paucarpata (12 de 78, 15,4 %); en educación, la del Cercado (124 de 400, 31,0 %), Miraflores (34,8 %) y José Luis Bustamante y Rivero (36,5 %).

**Cómo leerlo.** (1) Lo que OSM sí tiene está bien ubicado (desfase mediano de 6 a 15 m). (2) Le falta más de la mitad de lo oficial, sobre todo en salud, y esa ausencia mueve el resultado de CUMPLE / NO CUMPLE solo en el 4 % al 7 % de los puntos de la malla, casi siempre en el sentido de que OSM dice «no cumple» donde el registro oficial dice «cumple». (3) La precisión es una cota baja: un colegio o un puesto de OSM con otro nombre que el del registro no se empareja (el parecido mínimo es 0,9) y cuenta como sin correspondencia; no se revisó a mano ninguna muestra de los no emparejados. (4) La exhaustividad de salud está medida sobre los 406 establecimientos con coordenadas: el 42 % de las filas de RENIPRESS en Arequipa no las trae y no se pueden contrastar. (5) Las coordenadas de ESCALE son las del local, reportadas por la UGEL. **Decisión:** el equipo eligió usar RENIPRESS y ESCALE como fuente primaria, con OpenStreetMap solo de respaldo y con la fuente de cada dato a la vista (la alternativa que ya figuraba en este documento). Está implementada: ver «Decisión tomada y corrida corregida» más abajo y `docs/METODOLOGIA.md` §6. El script, la lógica y el protocolo siguen siendo los de `docs/INVESTIGACION-VARIABLES.md` §5.1.

### Decisión tomada y corrida corregida (2026-11-09)

**Decisión.** Salud y educación pasan a salir de los registros oficiales: **RENIPRESS** para salud y el **padrón de ESCALE** para colegios, con **OpenStreetMap como respaldo** solo donde ningún punto oficial de la misma categoría está a 200 m (el radio con que se midió la exhaustividad). Cada establecimiento muestra su fuente y su código oficial en la ficha, el mapa, el chat y el informe. `pnpm datos:oficial` arma los archivos (descarga con caché, pausa entre solicitudes y procedencia); las reglas están en `docs/METODOLOGIA.md` §6.1 a §6.4.

**Tres errores de la corrida anterior, corregidos.** Al armar la fusión se leyeron los archivos oficiales con más cuidado y se encontraron tres fallas en cómo K2 filtraba lo oficial (no en OpenStreetMap):

1. **Estado.** El filtro solo descartaba lo que decía «inactivo», «baja» o «cerrado». En ESCALE el estado viene en dos columnas (`ESTADO` = 1 o 2 y `D_ESTADO` = Activo o Inactivo) y el `2` no se reconocía: **las 2 458 instituciones inactivas de la provincia entraron como si estuvieran activas**. En RENIPRESS el «cierre temporal» (160 registros de Arequipa) tampoco se descartaba. Ahora solo cuenta lo claramente activo.
2. **Niveles.** `A3` es «Inicial - Cuna-jardín», no «programa no escolarizado» (ese es `A5`): se perdían las cuna-jardín. Y la primaria y secundaria de adultos y la educación básica especial se contaban como colegio. Ahora solo cuenta la educación básica regular (`docs/METODOLOGIA.md` §6.2).
3. **Categorías de salud.** K2 dejaba pasar el servicio médico de apoyo (laboratorios, imágenes, hemodiálisis, ópticas…) y los centros odontológicos. Ahora solo cuentan los establecimientos con o sin internamiento de categoría I-1 a III-E, y el consultorio médico se incluía (K2 lo había excluido); desde el 2026-11-10 es una categoría aparte (ver «Consultorios como categoría aparte»). Además, el CSV de RENIPRESS ya se lee tal cual: `NORTE` y `ESTE` son latitud y longitud y se aceptan solo si son grados decimales (antes había que renombrar las columnas a mano), y el padrón se lee directo del `Padron_web.dbf` en CP850 (antes se convertía a CSV con un conversor propio).

**Resultado de la corrida corregida** (mismos archivos de RENIPRESS y ESCALE del 2026-10-30, misma copia de OpenStreetMap del 2026-10-28, mismos criterios fijados antes de medir; resultado completo en `docs/validacion/k2-resultado-v2.json`, el anterior se conserva en `k2-resultado.json`):

| Categoría | Oficiales | En OSM | Exhaustividad (50 / 100 / 200 m) | Precisión (50 / 100 / 200 m) | Desfase (mediana; p90, a 200 m) | Puntos de la malla (1 536) donde cambia CUMPLE / NO CUMPLE |
|---|---|---|---|---|---|---|
| Salud (1000 m) | 494 | 164 | 15,8 / 16,2 / 16,6 % | 49,7 / 51,0 / 52,2 % | 10 m; 31 m | 98 (6,4 %): OSM cumple y el oficial no, 16; el oficial cumple y OSM no, 82 |
| Educación (todos los niveles) | 1 508 | 2 151 | 63,9 / 68,2 / 69,5 % | 45,5 / 48,6 / 49,6 % | 6 m; 44 m | no se calcula por total |
| Inicial (500 m) | 1 221 | 1 191 | 61,8 / 65,1 / 66,5 % | 63,6 / 67,1 / 68,5 % | 6 m; 36 m | 100 (6,5 %): 27 y 73 |
| Primaria (1500 m) | 823 | 892 | 60,5 / 67,1 / 68,4 % | 57,8 / 64,0 / 65,3 % | 11 m; 53 m | 85 (5,5 %): 30 y 55 |
| Secundaria (3000 m) | 523 | 556 | 53,7 / 61,8 / 63,1 % | 53,4 / 61,4 / 62,7 % | 15 m; 59 m | 73 (4,8 %): 3 y 70 |

La conclusión no cambia: **OpenStreetMap sigue sin alcanzar el 85 % de exhaustividad ni de precisión, ni en salud ni en educación**. En educación la exhaustividad sube (del 46,7 % al 69,5 % a 200 m) porque ya no se cuentan las 2 458 instituciones inactivas; en salud baja (del 20,2 % al 16,6 %) porque ahora hay más establecimientos oficiales válidos (494 frente a 406: entran los consultorios y los que antes se descartaban mal, y salen los de apoyo). La precisión sigue siendo una cota baja por la razón de siempre: un nombre distinto del oficial no se empareja y no se revisó a mano ninguna muestra de los no emparejados.

**Composición de los archivos que lee la aplicación** (`pnpm datos:oficial`, 2026-11-09; el conteo vive en `metadata.conteo_por_fuente` de cada archivo):

| Archivo | Fuente primaria | Respaldo de OpenStreetMap | Total |
|---|---|---|---|
| `salud.geojson` | RENIPRESS: 494 | 14 (de 164; 150 descartados a 200 m, 83 de ellos también por nombre) | 508 |
| `educacion.geojson` | ESCALE: 1 508 locales (2 569 instituciones). Por nivel: inicial 1 221, primaria 823, secundaria 523 | 205 elementos (de 2 174; 1 946 descartados y 23 sin nivel básico). Por nivel: inicial 74, primaria 94, secundaria 77 | 1 713 |

**Lo que sigue sin resolverse.** (1) Cerca del 42 % de los registros de salud de Arequipa en RENIPRESS no trae coordenadas: 13 181 filas del país no se pueden ubicar y ahí el respaldo de OpenStreetMap es lo único que puede aparecer. (2) ESCALE da la ubicación del local que reportó la UGEL; no se verificó contra el terreno. (3) No se revisó a mano una muestra de los no emparejados. (4) Los archivos de RENIPRESS y de ESCALE se congelan: la fecha de cada fuente queda en `metadata.fuentes` y se muestra en el método de cada resultado.

### Consultorios como categoría aparte (2026-11-10)

**Decisión.** Los consultorios médicos se conservan pero como categoría separada de los establecimientos de salud (regla en `docs/METODOLOGIA.md` §6.1). K2 se alineó: la **salud** se valida solo con los 256 establecimientos de RENIPRESS frente a los 128 elementos de OpenStreetMap que son salud (127 desde que se excluye lo odontológico, ver más abajo), y los **consultorios** se miden aparte (237 de RENIPRESS frente a 36 de OpenStreetMap con `amenity=doctors` o `healthcare=doctor`) en una sección informativa del informe, sin impacto en cumple / no cumple porque no tienen umbral. Se repitió con los mismos archivos del 2026-10-30 (RENIPRESS y ESCALE) y la misma copia de OpenStreetMap del 2026-10-28; resultado completo en `docs/validacion/k2-resultado-v3.json` (los anteriores se conservan). Educación no cambia: mismas cifras que en la corrida corregida.

| Categoría | Oficiales | En OSM | Exhaustividad (50 / 100 / 200 m) | Precisión (50 / 100 / 200 m) | Desfase (mediana; p90, a 200 m) | Puntos de la malla (1 536) donde cambia CUMPLE / NO CUMPLE |
|---|---|---|---|---|---|---|
| Salud, solo establecimientos (1000 m) | 256 | 127 | 21,1 / 21,9 / 22,7 % | 44,6 / 46,3 / 47,9 % | 16 m; 44 m | 172 (11,2 %): OSM cumple y el oficial no, 22; el oficial cumple y OSM no, 150 |
| Consultorios (informativo, sin umbral) | 237 | 36 | 0,0 / 0,0 / 0,0 % | 0,0 / 0,0 / 0,0 % | sin dato | no aplica: no hay umbral |

**Cómo leerlo.** (1) La conclusión de salud no cambia: **OpenStreetMap sigue sin llegar al 85 %** (22,7 % de exhaustividad y 47,5 % de precisión a 200 m). La exhaustividad sube respecto de la corrida con consultorios incluidos (16,6 %) porque el denominador baja de 494 a 256, aunque los emparejamientos también bajan (de 82 a 58 a 200 m). Una explicación probable, que **no se revisó caso por caso**, es que algunos elementos de OSM con `amenity=clinic` se emparejaban por nombre con consultorios oficiales y ahora, al ser categorías distintas, ya no. (2) De los consultorios, **ninguno de los 237 oficiales tiene un par** entre los 36 elementos de OpenStreetMap con `amenity=doctors` o `healthcare=doctor` a 50, 100 ni 200 m con un nombre parecido (≥ 0,9); a 200 m, 5 de esos 36 están cerca de un consultorio oficial pero con otro nombre. OpenStreetMap casi no mapea consultorios en Arequipa, así que ahí RENIPRESS es prácticamente la única fuente y el respaldo de OSM aporta 31 puntos (ver la composición abajo). Como el consultorio es informativo, esto no mueve ningún cumple / no cumple. (3) En salud cambia CUMPLE / NO CUMPLE en más puntos de la malla (172, el 11,2 %, frente a 98, el 6,4 %): con solo establecimientos hay menos puntos oficiales (256 frente a 494) y la distancia al más cercano del lado oficial es mayor; tampoco se analizó punto por punto.

**Composición de los archivos que lee la aplicación** (`pnpm datos:oficial`, 2026-11-10, con la edición de RENIPRESS del 2026-10-30; el conteo vive en `metadata.conteo_por_fuente` de cada archivo):

| Archivo | Fuente primaria | Respaldo de OpenStreetMap | Total |
|---|---|---|---|
| `salud.geojson` | RENIPRESS: 256 | 24 (de 127 de OSM que son salud; 103 descartados a 200 m de un establecimiento oficial, 59 de ellos también por nombre) | 280 |
| `consultorios.geojson` | RENIPRESS: 162 (75 de los 237 con nombre dental quedaron fuera, ver abajo) | 32 (de 36 de OSM que son consultorio; 4 descartados a 200 m de un consultorio oficial, ninguno por nombre) | 194 |

**Lo odontológico de OpenStreetMap queda fuera (2026-11-10).** `Calculos.esDental` excluye de la salud y de los consultorios los elementos de OSM con `amenity=dentist`, `healthcare=dentist`, `healthcare:speciality` con dentistry o un nombre con «dental», «odontolog…» o «dentist…» (sin distinguir mayúsculas ni tildes). En la copia del 2026-10-28 es **1 elemento** (`node/4313458191`, «Policlínico odontológico del sur», `amenity=clinic`, que contaba como establecimiento): la salud de OSM pasa de 128 a 127 elementos y el archivo de 281 a 280. K2 se repitió con los mismos archivos del 2026-10-30 (`docs/validacion/k2-resultado-v4.json`): la precisión de la salud sube de 47,5 % a 47,9 % a 200 m y la exhaustividad no cambia (22,7 %); sigue sin llegar al 85 %. Los consultorios no cambian (36 de OSM, ninguno dental en esa copia).

**Los dentales de RENIPRESS por el nombre también quedan fuera (2026-11-10).** Decisión de la persona responsable del proyecto: la regla de OpenStreetMap se aplica también a RENIPRESS. además del tipo, un registro de RENIPRESS no cuenta ni como salud ni como consultorio si su **nombre** es dental, con la misma regla de OpenStreetMap (`Calculos.esDental`: «dental», «odontolog…» o «dentist…», sin distinguir mayúsculas ni tildes; función `esNombreDental` de `scripts/lib/equipamiento-oficial.js`, que usan también `pnpm datos:oficial` y K2), **salvo** que el nombre diga además medicina, médico/a, hospital, centro/puesto/posta de salud, especialidades o multiespecialidad («Policlínico X - Medicina y Odontología» se queda). «Clínica», «policlínico» y «salud» solas no bastan para quedarse («Clínica Odontológica del Sur», «Consultorio Dental Characato Salud» salen). Con la edición del 2026-10-30 salen 75 consultorios (237 pasan a 162) y ningún establecimiento de salud; ningún nombre dental era multiespecialidad, así que la excepción no quitó ninguno. Quedan sin cubrir 16 nombres con raíz dental que el patrón no reconoce («ODONTO MEDICC», «ODONTO MONTESINOS», «FACE DENT», «Belldent», «DENTASIA», «DENTAMIA», «NOVA DENT», «Kova Dent», «PLUS DENT IMPLANT», «ROCA DENT¨S», «FIMAHO DENT´S», «ChimuDent», «DENTRICS», «DENTA VITALIS E.I.R.L.», «SMILE DESIGN AQP», «mil sonrisas» y similares); ampliar el patrón cambiaría también la regla de OpenStreetMap y queda como decisión pendiente. Efecto: **consultorios 268 → 194** (RENIPRESS 237 → 162, OpenStreetMap 31 → 32, porque un consultorio de OSM que estaba a 200 m de uno dental oficial ya no se descarta) y salud sin cambios (280). K2 se repitió con los mismos archivos del 2026-10-30 (`docs/validacion/k2-resultado-v5.json`): la salud no cambia (22,7 % de exhaustividad y 47,9 % de precisión a 200 m, sigue sin llegar al 85 %), educación tampoco, y los consultorios oficiales medidos bajan de 237 a 162 con el mismo resultado (ningún par con OSM a 50, 100 ni 200 m). El consultorio más cercano a la Plaza de Armas deja de ser uno dental: ahora es «Consultorio Médico Cardiológico», a 149 m.

**Dónde descargar cada archivo** (con `pnpm datos:oficial` el script los descarga solo —el CSV de RENIPRESS y el ZIP de ESCALE respondieron sin navegador el 2026-11-09— y los deja en `.cache-equipamiento-oficial/`; si una descarga automática falla, estas son las páginas para hacerlo a mano):

| Archivo | Dónde | Qué guardar |
|---|---|---|
| RENIPRESS (salud) | `https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress` (SUSALUD/MINSA, licencia Open Data Commons Attribution) | El CSV de la edición más reciente que traiga las columnas de **latitud y longitud** (el catálogo lista ediciones mensuales). Anota la edición (por ejemplo «2026-09») |
| Padrón de ESCALE (educación) | `https://escale.minedu.gob.pe/web/inicio/padron-de-iiee` (MINEDU); el ZIP está en la biblioteca de documentos (`https://escale.minedu.gob.pe/uee/-/document_library_display/GMv7/view/958881`, archivo `Padron_web_AAAAMMDD.zip`) | El `Padron_web.dbf` del ZIP (CP850; `--escale=` lo acepta tal cual, o un CSV con código de local, nombre, nivel, estado, distrito y las coordenadas del local). Anota la fecha |

Si tu archivo de RENIPRESS solo trae coordenadas UTM (Norte y Este), el script lo rechaza y dice qué columnas faltan: busca otra edición con latitud y longitud.

**Comando** (no usa internet; lee la copia de OpenStreetMap ya congelada en `public/data/equipamiento`):

```bash
pnpm datos:validar-oficial -- --escale=ruta/padron_escale.csv --renipress=ruta/renipress.csv   --fecha-escale=2026-10 --fecha-renipress=2026-09 --salida=docs/validacion/k2-resultado.json
```

Opciones: `--radios=50,100,200` (m), `--umbral-nombre=0.9`, `--paso=500` (separación, en m, de la malla de puntos), (`--sin-consultorios` ya no existe: los consultorios son una categoría aparte, la salud se valida solo con establecimientos y los consultorios se miden por separado), `--escale=` acepta el `Padron_web.dbf` y, para fijar los criterios de aceptación **antes de mirar los números**, `--min-exhaustividad=0.85 --min-precision=0.85` (el informe dice si se cumplen; el 85 % es la referencia de caminabilidad del estudio de Santiago de Chile citado en el protocolo, no una norma).

**Qué hace, paso a paso:**

1. Filtra Arequipa metropolitana: provincia y departamento AREQUIPA (si el archivo los trae), coordenadas dentro de la caja de la herramienta, estado claramente activo y, en RENIPRESS, solo establecimientos con o sin internamiento de categoría I-1 a III-E, sin servicio médico de apoyo ni centros odontológicos (`docs/METODOLOGIA.md` §6.1; los consultorios médicos se separan de la salud y se miden aparte, ver «Consultorios como categoría aparte»). La OSM que se compara es la copia cruda de `public/data/equipamiento/osm`, no la fusión. Las filas descartadas se cuentan y se muestran por causa.
2. ESCALE: solo educación básica regular, `NIV_MOD` A1, A2, A3, B0 y F0 (no el programa no escolarizado, la educación de adultos, la básica alternativa ni la especial; `docs/METODOLOGIA.md` §6.2), solo instituciones activas, y **una fila por código de local** (un local alberga varias instituciones; sus niveles se juntan y se guardan todos sus nombres).
3. Empareja con OpenStreetMap de forma **uno a uno** por parecido de nombre ≥ 0,9 (sin tildes, signos ni palabras como «colegio», «puesto» o «centro de salud»; distancia de edición normalizada, sin importar el orden de las palabras) y distancia, barriendo **50, 100 y 200 m**. Los elementos de OSM sin nombre no se pueden emparejar por nombre: se cuentan aparte.
4. Reporta, por radio y por categoría (salud, educación y cada nivel): **exhaustividad** (qué parte de lo oficial aparece en OSM), **precisión** (qué parte de lo de OSM con nombre corresponde a un registro oficial), **desfase posicional** (mediana y percentil 90) y la exhaustividad **por distrito**.
5. **Impacto en la variable:** en una malla de puntos dentro del plano de zonificación calcula la distancia al establecimiento más cercano con OSM y con el registro oficial, y cuenta en cuántos puntos cambia CUMPLE / NO CUMPLE con los umbrales de la ficha (salud 1000 m; educación 500, 1500 y 3000 m), en qué dirección, y la diferencia mediana de la distancia.

**Límites del método:** la precisión es una cota baja (un establecimiento real de OSM que el registro no incluye, o que se llama distinto, cuenta como no emparejado) y conviene revisar a mano una muestra de los no emparejados. Las coordenadas de ESCALE son las del local, reportadas por la UGEL, y pueden estar desplazadas. OSM etiqueta poco el nivel de los colegios: la ficha supone primaria y secundaria cuando no hay etiqueta, y este informe usa la misma regla. Si OSM no basta, la decisión posterior (a fijar por el equipo) es usar RENIPRESS y ESCALE como fuente primaria y mostrar la fuente y la fecha de cada dato.

### 3.5 Mercados de OpenStreetMap frente al CENAMA 2016 (cobertura, 2026-11-10)

**Qué se midió.** El Censo Nacional de Mercados de Abastos 2016 (INEI/PRODUCE) es una tabla anonimizada sin nombres ni coordenadas (`docs/METODOLOGIA.md` §6.5.5), así que **no se puede emparejar mercado con mercado ni medir exactitud de posición**. Solo se compara el conteo por distrito del censo (provincia de Arequipa: 89 mercados) con los elementos `amenity=marketplace` de OSM dentro de los distritos (89 tras unir repetidos), con el mismo recorte de la caja metropolitana. Resultado completo: `docs/validacion/cenama-cobertura.json` (`pnpm datos:comercio`).

| Distrito | CENAMA 2016 | OSM |
|---|---|---|
| Alto Selva Alegre | 4 | 2 |
| Arequipa | 8 | 20 |
| Cayma | 6 | 6 |
| Cerro Colorado | 13 | 8 |
| Characato | 0 | 1 |
| Jacobo Hunter | 4 | 3 |
| José Luis Bustamante y Rivero | 19 | 26 |
| La Joya | 2 | 0 |
| Mariano Melgar | 5 | 3 |
| Miraflores | 7 | 5 |
| Paucarpata | 14 | 7 |
| Sabandía | 0 | 1 |
| Santa Rita de Siguas (fuera de los 25 distritos del proyecto) | 1 | 0 |
| Socabaya | 1 | 0 |
| Tiabaya | 1 | 1 |
| Yanahuara | 2 | 4 |
| Yura | 2 | 2 |
| **Total** | **89** | **89** |

**Cómo leerlo.** Los dos totales coinciden por casualidad, no por cobertura: **solo 3 de los 17 distritos de la tabla coinciden** (Cayma, Tiabaya y Yura). En 9 hay menos mercados en OSM que en el censo (Paucarpata 7 frente a 14, Cerro Colorado 8 frente a 13, Alto Selva Alegre, Mariano Melgar, Miraflores, Jacobo Hunter, Socabaya, La Joya y Santa Rita de Siguas) y en 5 hay más (Arequipa 20 frente a 8, José Luis Bustamante y Rivero 26 frente a 19, Yanahuara, y Characato y Sabandía, que el censo no registra). Una parte de lo que sobra son galerías, ferias y comercios que OSM etiqueta como mercado (hay cuatro «Botica Dermia»), pero no se revisó caso por caso. Tampoco son los mismos mercados: el censo es de 2016 y OSM de 2026. **Límites:** (1) el conteo no demuestra que sean los mismos mercados, ni que falte o sobre alguno; (2) el CENAMA solo cuenta mercados de abastos formales censados en 2016; (3) OSM etiqueta distinto (ferias, galerías); (4) no hay umbral de aceptación fijado antes de medir, así que no se declara «aprobado» ni «rechazado»: es una descripción. La conclusión que sí se sostiene es que **OSM no reproduce el censo por distrito**, de modo que el conteo de mercados por distrito del chat es el de OSM y lo dice.

## 4. Riesgos para la validez (amenazas conocidas)

| Amenaza | Efecto | Qué se hace |
|---|---|---|
| El código de zona se asignó por color | Errores cerca de bordes o en colores compartidos | Muestra con puntos de borde (§3.1) y limitación visible en la app |
| Cambio de captura de coordenadas en delitos (≈ 25 % → ≈ 90 %) | Sesgo temporal si se mezclan periodos | Periodo con cobertura homogénea (METODOLOGIA §5) |
| El inventario de peligros refleja dónde se inspeccionó | Ausencia de registro ≠ seguridad | Aviso visible y redacción cuidadosa |
| Muestra de usuarios pequeña | Sin significancia estadística | Reportar medianas y casos, decirlo explícitamente |
| Pocos lugares de referencia para H, E y OU2 en OpenStreetMap | La validación de §2.2 no estima una tasa de exactitud | Se presenta como prueba de consistencia, no de exactitud |
| Fuentes públicas que cambian | Cifras distintas al repetir la descarga | Fecha de descarga en cada archivo; scripts reproducibles |
| Overpass público (entorno) caído o saturado | La sección de entorno no responde | La app muestra el error; no inventa resultados |
| El PDM 2016-2025 llegó al fin de su vigencia (10 años) y una sentencia suspendió ciertos actos de ejecución | La zona mostrada puede no ser la que hoy aplica el IMPLA | Limitación visible en la app; el Certificado de Zonificación y Vías es el único documento con valor legal (METODOLOGIA §3) |

## 5. Qué falta para cerrar la validación

- [ ] Leer el texto de la Ordenanza 961 (escaneo sin texto; requiere OCR o lectura a ojo) y el Anexo 01 de la 975.
- [ ] Obtener los certificados u otra referencia oficial para la muestra (§3.1).
- [ ] Reclutar participantes y fijar las tareas con su respuesta correcta (§3.2).
- [ ] Revisión del mapa de calor con conocedores (§3.3).
- [x] Descargar RENIPRESS y el padrón de ESCALE, fijar los criterios de aceptación y correr `pnpm datos:validar-oficial` (§3.4; hecho el 2026-11-09, y repetido el mismo día con los filtros oficiales corregidos). Fuente primaria decidida e implementada: RENIPRESS y ESCALE, con OpenStreetMap de respaldo. Falta revisar a mano una muestra de los no emparejados.
- [ ] Registrar resultados en las plantillas y completar este documento.
