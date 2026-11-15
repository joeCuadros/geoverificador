# Datos: qué hay, qué falta y qué no se debe prometer

> Estado al 2026-11-03, sobre `main` (commit `c9508f7`, tras el PR #7). Las rutas son relativas al repositorio `joeCuadros/geoverificador`. El sitio publicado es <https://geoverificador-nine.vercel.app>, pero esa versión se desplegó **antes** del PR #7. Lo marcado «según lectura del código» no se ejecutó; las pruebas y la verificación de datos sí se ejecutaron (ver §2).
> Para ejemplos de forma de los datos, ver `contrato-datos.json`.

## 1. Lo que ya existe y funciona

| Dato | Archivo | Contenido | Estado | Límites |
|---|---|---|---|---|
| **Zonificación** (plano del PDM 2016-2025) | `public/data/zonas_aqp.geojson` | 793 polígonos, 29 códigos, con `codigo` y `color` | **Validado:** 793 = 793 frente al PDF oficial; 99,97 % de coincidencia en 13 255 puntos | El PDM cumplió su vigencia de 10 años; el nuevo (2026-2046) **no está aprobado ni publicado**; el plano no incluye modificaciones posteriores a 2016 |
| **Reglas por zona** | `public/data/reglas_zonas.json` | Por código: nombre, grupo, `edificable` (`si`/`condicionado`/`no`), pisos, coeficiente, área libre, lote mínimo, frente | **Contrastado** con el Reglamento (29 de 29) | Máximos teóricos; no consideran retiros ni estacionamientos |
| **Salud** | `public/data/equipamiento/salud.geojson` | 164 puntos de OpenStreetMap (incluye consultorios) | Congelado el **2026-10-28** | OSM puede estar incompleto; no distingue hospital de consultorio en el cálculo |
| **Educación** | `…/educacion.geojson` | 2 174 puntos (jardines y colegios) | Congelado el 2026-10-28 | OSM casi no etiqueta el nivel: un colegio sin nivel se toma como primaria y secundaria |
| **Transporte** | `…/transporte.geojson` | 414 paraderos | Congelado el 2026-10-28 | El transporte es en gran parte informal: puede haber paradas sin mapear |
| **Áreas verdes** | `…/areas_verdes.geojson` | 1 320 polígonos; se usan los de ≥ 5 000 m² | Congelado el 2026-10-28 | No distingue parque cuidado de terreno baldío |
| **Distritos** | `public/data/distritos_aqp.geojson` | 25 distritos con ubigeo | Fuente: GEOCATMIN / INEI | — |
| **Quebradas y ríos** (ANA) | `public/data/quebradas_aqp.geojson` | 14 líneas, 7 cursos: ríos Chili, Yura y Yarabamba y 4 quebradas con nombre. Descargado el 2026-11-02 (red de enero de 2018) | **Contexto informativo**; solo es criterio si la persona fija una distancia mínima (no hay una oficial) | **Faltan** quebradas urbanas como Añashuayco y San Lázaro |
| **Sismos recientes** (IGP) | `public/data/sismos_igp.geojson` | 94 puntos, ventana 2026-01-01 a 2026-11-02 (el servicio trae 765 en total; magnitud máxima 5,1) | **Contexto informativo** (radio 100 km) | No es el catálogo histórico |
| **Peligros geológicos** (INGEMMET) | `public/data/peligros_aqp.geojson` | 394 registros (2003 a 2023), descargados el 2026-10-12 | **Contexto informativo** (radio 500 m) en «Contexto de riesgo» | El servicio público hoy devuelve solo 291 de los 394; el script no sobrescribe el archivo sin `--forzar`. Inventario con sesgo de muestreo |
| Zona sísmica (E.030) | `public/data/zonas_sismicas_e030.json` | 21 distritos en zona 3, 8 en zona 4 | **Oculto**, fuera de alcance (el módulo antiguo de desastres sigue apagado: `CONFIG.modulos.desastre=false`) | Casi no distingue entre predios de la ciudad |
| Denuncias (SIDPOL) | `public/data/delitos_aqp.geojson` | 8 245 denuncias de robo y hurto con ubicación | **Oculto**, fuera de alcance | Son denuncias, no delitos |

## 2. Cálculos y código reutilizables

| Qué | Dónde | Notas |
|---|---|---|
| Distancias (haversine), área geodésica, punto en polígono, distancia a polígono, evaluación más cercano y área verde | `public/js/calculos.js` | Funciones puras; verificadas contra métodos independientes |
| Asistente de reglas, cuadrícula de 250 m, búsqueda por distrito, textos, `construirConsulta` | `public/js/asistente.js` | Plan B cuando no hay modelo |
| Contrato con el LLM: esquema, `validarSpec`, `verificarTexto` | `public/js/asistente-llm.js` | Se usa en navegador y servidor; 43 pruebas (`asistente-llm.spec.ts`) |
| Endpoint del chat | `api/chat.js`, `api/_lib/gemini.js`, `src/chat.controller.ts` | GET `{disponible}`; POST `interpretar` o `redactar`; 19 pruebas del manejador |
| Comparador (hasta 3 puntos) | `public/js/comparar.js`, `comparar-ui.js` | Sin pesos ni puntaje global; 62 pruebas |
| Contexto de riesgo, verificaciones, tour, umbral de usuario | `contexto.js`, `verificaciones.js`, `tour.js`, `umbrales.js` | `umbrales.js` solo tiene `quebradaMinM` (1 a 50 000 m, **sin valor por defecto**) |
| Umbrales y fuentes | `public/js/config.js` (`umbrales`, `fuentesUmbral`, `asistente`, `peligros`, `sismos`) | Ver tabla 3 |
| Verificación de datos y búsqueda | `scripts/verificar-datos.mjs` | **91 de 91 correctas** (ejecutado el 2026-11-03 sobre `c9508f7`); búsqueda de 3 criterios sobre 2 358 celdas: 740 ms, y 295 ms con la cuadrícula en caché |
| Pruebas | `test/*.spec.ts` | **434 pruebas en 14 suites, todas pasan** (ejecutado el 2026-11-03 sobre `c9508f7`, 9 s). `docs/ENTREGA.md` dice 324: está desactualizado |
| Metodología y validación | `docs/METODOLOGIA.md`, `docs/VALIDACION.md` | Origen de cada dato y límites |

## 3. Umbrales y su fuente

| Criterio | Valor | Fuente | ¿Se puede precargar? |
|---|---|---|---|
| Educación inicial | 500 m (15 min) | MINEDU, Instructivo FTE, Cuadro N.° 4 (RVM 104-2019 y 208-2019) | **Sí**, con su fuente |
| Educación primaria | 1 500 m (30 min) | MINEDU (ídem) | **Sí** |
| Educación secundaria | 3 000 m (45 min) | MINEDU (ídem) | **Sí** |
| Área verde | ≥ 0,5 ha a ≤ 300 m | OMS Europa (2016) | **Sí** |
| Salud | 1 000 m | **Convención del proyecto** | Solo como «sugerencia sin fuente» |
| Paradero | 400 m | Práctica habitual (400 m ≈ 5 min); convención del proyecto | Solo como sugerencia |
| Borde de zona | 20 m | **Convención del proyecto** | Interno |
| Campiña, comercial, centro histórico | 500 / 600 / 800 m | **Convención del proyecto** | **No**: preguntar |
| **Máximo tolerable** de cualquier criterio | — | **No existe** | **No**: lo fija la persona |
| **Pesos** | — | **No existen** | **No**: los fija la persona |

## 4. Lo que existe fuera del proyecto y todavía no se usa

| Dato | Dónde | Utilidad | Advertencias |
|---|---|---|---|
| **RENIPRESS** (establecimientos de salud con latitud, longitud, categoría y estado) | Portal de datos abiertos: <https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress> (CSV mensual, licencia ODC-By, actualizado el 2026-09-30). También como servicio ArcGIS del MINSA (`RENIPRESS_PERU`, consulta por distancia, salida GeoJSON) | Contrastar o **reemplazar OSM** en salud; distinguir categoría (I-1 a I-4) | Las coordenadas oficiales también tienen errores (en Brasil, solo el 63 % de los hospitales del registro tenía coordenadas correctas) |
| **ESCALE** (padrón de instituciones educativas) | <https://escale.minedu.gob.pe/padron-de-iiee/> (descarga por correo) | Colegios con nivel **oficial** | MINEDU advierte que las ubicaciones urbanas son referenciales |
| **Precios de oferta por distrito** (Perú, octubre 2026) | Aptología, CC BY 4.0: <https://huggingface.co/datasets/aptologia/microestudios-vivienda-peru-2026> | Contexto de presupuesto **por distrito** | **Precios pedidos, no de cierre.** Muestras pequeñas (30 a 120 avisos por distrito). Autor individual: validar |
| **Otras fuentes del Estado** (denuncias MININTER, suelo sísmico IGP, Misti INGEMMET, riesgo SIGRID, valor MiVivienda, OSINERGMIN, INDECI y más) | Sondeo del 2026-11-03 | Ver `05-FUENTES-ADICIONALES.md` | Casi ninguna declara licencia; varias no tienen CORS (precalcular, no consultar en vivo) |

## 5. Lo que NO existe (y no se debe prometer)

| Falta | Por qué importa | Qué se hace |
|---|---|---|
| **Tiempos por red a trabajo y colegio** | Es el corazón de las anclas | Servidor de rutas **propio** (Valhalla u OpenRouteService) con el extracto de OSM de Perú. Los servidores públicos de demostración **no son para producción** |
| **Tiempos en transporte público** | El transporte es informal; no se encontró GTFS | Mostrar «paradero cercano», **no** «tiempo en bus» |
| **Calidad escolar** | Aparece en la literatura como factor positivo | Declarar que no está |
| **Seguridad, ruido, precios** | Pesan en la decisión | Declarar que no están **en el producto**. Hoy el asistente ya responde «sin datos» a estos tres temas (`no_soportado`) y, si van dentro de una búsqueda, la ejecuta y añade el aviso. (La seguridad existe pero está oculta.) Existen **fuentes candidatas** fuera del proyecto (denuncias del MININTER, valor de vivienda financiada de MiVivienda): ver `05-FUENTES-ADICIONALES.md`. Ruido sigue sin fuente |
| **Quebradas urbanas** (Añashuayco, San Lázaro, etc.) | Un «lejos de quebradas» incompleto da falsa tranquilidad | Mostrar el límite de la fuente en cada uso |
| **Zonificación futura (PDM 2026-2046)** | Es el «futuro» del predio | Aviso con fuente y fecha; **no hay mapa** |
| **Precios por predio o por zona fina** | «Compra y venta» | Solo rango distrital de oferta. **No raspar portales** sin revisar sus términos |
| **Pesos con respaldo para Arequipa** | Ponderar la decisión | Los fija la persona |

## 6. Datos del usuario (diseño)

| Dato | Dónde vive | Quién lo ve |
|---|---|---|
| Miembros, anclas (direcciones), modos y ventanas horarias | **Dispositivo** (almacenamiento local) | Solo la persona |
| Pesos, umbrales, restricciones | Dispositivo + **identificadores y valores** hacia el servidor | El motor |
| Texto del chat | **Hoy** viaja al proveedor del modelo (Gemini) cuando está activo: mensaje de hasta 300 caracteres, hasta 6 turnos previos, si hay punto y los criterios previos; al redactar, también el texto determinista (distrito, zona, nombres de servicios, distancias). **No** viajan coordenadas ni archivos (según lectura del código) | El LLM y su proveedor |
| Direcciones exactas | **Hoy** no se envían, pero **si la persona las escribe en el chat llegan al modelo**. Diseño objetivo: nunca al LLM | — |

**Inconsistencia a resolver:** el paso 4 del tour y el encabezado de `asistente.js` dicen que el asistente «no usa un modelo de lenguaje ni envía lo que escribes». Eso ya no es cierto con Gemini activo; el diseño debe incluir un aviso de privacidad honesto.

(La geocodificación con Nominatim sí envía la dirección a un servicio externo: decidir si se avisa o se reemplaza por selección en el mapa.)

## 7. Endpoints

**Ya existe:** `GET /api/chat` (devuelve `{disponible}` sin llamar al modelo) y `POST /api/chat` con `mode: interpretar` (devuelve una consulta estructurada validada) o `redactar` (devuelve texto que el cliente verifica). Errores: 400, 405, 503 sin clave, 429 con `reintentarEnS`, 504, 502. Límite: 20 solicitudes por minuto por IP en memoria de cada instancia. En Vercel corre como función (`maxDuration: 20`) y en local, en Nest.

**Propuestos para la fase con LLM:**

| Endpoint | Función |
|---|---|
| `POST /api/chat` (ampliado) | Orquesta el LLM con herramientas y el verificador numérico por herramienta |
| `POST /api/ruta` | Tiempo por red entre dos puntos y modo |
| `POST /api/matriz` | Tiempos de una ancla a muchas celdas (para el ranking) |
| `GET /api/precio-distrito` | Rango de oferta y tamaño de muestra |

El frontend sigue siendo **estático** (`public/`), con una sola función de servidor (`/api/chat`): las rutas nuevas requieren más funciones o un servicio aparte.
