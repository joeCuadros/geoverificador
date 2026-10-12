# GeoVerificador — Verificación y validación

Distinguimos dos cosas, porque responden preguntas distintas:

- **Verificación (hecha, automática):** ¿el código calcula lo que dice calcular y los archivos están íntegros?
- **Validación (pendiente, con personas y documentos externos):** ¿los datos coinciden con la realidad y la herramienta sirve a quien la usa?

> **Estado honesto:** la verificación está hecha y se puede repetir con un comando. De la validación externa se hicieron dos partes (§2.1: la tabla de reglas contra el Reglamento; §2.2: los polígonos contra lugares reales de OpenStreetMap); lo demás **todavía no se ha hecho**: este documento define el protocolo y deja las plantillas vacías. Ningún resultado que no exista aparece aquí.

## 1. Hipótesis y criterios de éxito

| # | Hipótesis | Cómo se prueba | Criterio de éxito (fijado el 2026-10-12, antes de medir) |
|---|---|---|---|
| H1 | La zona que la app asigna a un punto coincide con la zonificación oficial. | §3.1 | ≥ 90 % de coincidencia en la muestra, y registrar dónde falla. |
| H2 | Con la app se responde «qué se puede construir aquí» más rápido y sin perder aciertos que con el PDF y el reglamento. | §3.2 | Menor tiempo mediano con igual o mayor proporción de respuestas correctas. |
| H3 | El mapa de calor de denuncias es coherente con lo que se sabe de la ciudad. | §3.3 | Revisión cualitativa; no se declara como predictor. |

**Los criterios quedan fijados con este commit**, antes de medir cualquier resultado de H1 y H2. Si el equipo decide otros, el cambio debe hacerse en un commit explícito antes de levantar datos, de modo que el historial del repositorio muestre que no se ajustaron al resultado. El criterio de H3 es cualitativo a propósito: no se declara el mapa de calor como predictor.

## 2. Verificación automática (hecha)

Comando (sin internet ni dependencias):

```bash
node scripts/verificar-datos.mjs
```

Corrida del 2026-10-12: **29 de 29 comprobaciones correctas.**

**A. Integridad de los archivos**

- Zonas: formato GeoJSON, todos los polígonos con `codigo` y `color`, todo código del plano existe en la tabla de reglas, coordenadas dentro de Arequipa, y cada color corresponde a un solo código (29 colores, 29 códigos, sin conflictos).
- Reglas: 29 códigos con nombre y `edificable` válido; `coef_max` nunca menor que `coef_base`.
- Delitos: el número de registros coincide con los metadatos; solo robo y hurto; fechas válidas; ids únicos; sin dirección, cuadra ni hora exacta; la cobertura mensual guardada coincide, mes a mes, con los registros descargados.
- Peligros: número de registros coincide con los metadatos; ningún código crudo quedó sin traducir; ids únicos; años coherentes.

**B. Cálculos del navegador frente a un método independiente.** Se ejecuta el mismo código que corre en el navegador (`zonificacion.js`, `peligros.js`, `delitos.js`) y se compara con un cálculo escrito aparte, con puntos al azar de semilla fija:

| Cálculo | Método independiente | Muestra | Diferencias |
|---|---|---|---|
| Zona de un punto | Número de vueltas (winding number) en lugar de ray casting | 2 000 puntos (402 dentro del plano) | 0 |
| Potencial constructivo | Aritmética directa con una regla real | 3 comprobaciones | 0 |
| Peligros a 500 m y más cercano | Fuerza bruta con ley esférica de los cosenos | 200 puntos | 0 |
| Denuncias a 500 m (total, robo, hurto) | Fuerza bruta con ley esférica de los cosenos | 300 puntos (169 con ≥ 1 denuncia) | 0 |
| Periodo de denuncias | Regla de cobertura reescrita | 1 | 0 |

**Se comprobó que la prueba puede fallar:** al introducir a propósito un error en el radio de las denuncias (+50 m), la prueba reportó 139 diferencias en 300 puntos y falló.

**Qué NO demuestra la verificación:** que el plano esté bien digitalizado ni que las denuncias reflejen el delito real. Solo que, dados los datos, el cálculo es correcto.

## 2.1 Validación externa ya hecha: reglas frente al Reglamento

Se contrastó `reglas_zonas.json` con el texto del Título III del Reglamento del PDM (zonificación y compatibilidades). Resultado: **29 de 29 códigos coinciden** en lote mínimo, frente, pisos, coeficiente, área libre y condición de edificabilidad. El detalle por grupo, las observaciones (una discrepancia interna del propio Reglamento en RDA-1 y una errata «ZRE-RE») y las fuentes están en `METODOLOGIA.md` §3.

Límites de esta validación: usa una copia del Reglamento alojada en otro sitio municipal, no el portal oficial de la MPA (que bloquea la descarga automática); y valida la **transcripción de las reglas**, no los polígonos del plano. Sigue pendiente que el equipo la confirme contra el portal oficial.

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
   - **Casos sin explicación, a revisar a ojo contra el plano oficial:** «Intermedic» y «Fisioterapia» en `RP` (reserva paisajista; -16,38832 -71,53692 y -16,38788 -71,53744), «Centro médico Pedro P. Díaz» (-16,41505 -71,50066) y «Hospital Maritza Campos Díaz» (-16,32655 -71,56015) en `ZR`, «Hospital Edmundo Escomel» en `I-1` (-16,41722 -71,50866) y «Universidad Autónoma San Francisco» en `ZA` (-16,44923 -71,60000). Pueden ser errores del plano, errores de ubicación en OSM, o usos que la norma permite; con estos datos no se puede decidir cuál.
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
2. Definir de 2 a 3 tareas con respuesta correcta conocida, por ejemplo: «¿Se pueden construir 5 pisos en un lote de 300 m² en este punto?» y «¿Hay algún peligro geológico registrado a menos de 500 m?». Fijar la respuesta correcta con el reglamento **antes** de la prueba.
3. Cada participante hace las tareas de las dos formas (PDF y app), alternando cuál va primero para repartir el efecto del aprendizaje.
4. Medir tiempo y si la respuesta es correcta (`docs/plantillas/prueba-usuarios.csv`). Al final, un cuestionario corto de usabilidad (por ejemplo, SUS) y una pregunta abierta: «¿qué le faltó?».
5. Reportar medianas y casos, no solo promedios; con 5 a 8 personas no hay significancia estadística, y debe decirse así.

**Resultado:** _pendiente_.

### 3.3 Coherencia del mapa de calor (H3)

**Objetivo:** comprobar que lo que muestra el mapa tiene sentido, sin afirmar que prediga nada.

**Procedimiento:** con conocedores de la ciudad (vecinos, serenazgo, estudiantes), revisar si las zonas más intensas coinciden con lo esperado (centro, mercados, ejes comerciales) y anotar discrepancias. Opcional: comparar con las estadísticas por distrito que publica la fuente.

**Resultado:** _pendiente_. Lo único que se puede afirmar hoy, porque se observó en el mapa, es que el centro histórico y los ejes de la Av. Ejército y de Cayma concentran la mayor densidad; eso es una observación, no una validación.

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

- [ ] Confirmar el contraste de reglas (§2.1) contra el Título III en el portal oficial de la MPA.
- [ ] Revisar a ojo contra el plano oficial los 6 casos sin explicación de §2.2.
- [ ] Obtener los certificados u otra referencia oficial para la muestra (§3.1).
- [ ] Reclutar participantes y fijar las tareas con su respuesta correcta (§3.2).
- [ ] Revisión del mapa de calor con conocedores (§3.3).
- [ ] Registrar resultados en las plantillas y completar este documento.
