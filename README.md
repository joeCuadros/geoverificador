# GeoVerificador

Ficha de un predio en Arequipa metropolitana, con datos públicos. Se elige un punto en el mapa y la aplicación evalúa **5 variables**, cada una por separado y con su fuente:

| Variable | Qué muestra | Umbral | Fuente |
|---|---|---|---|
| V1a Zonificación vigente | Zona, nombre, parámetros (pisos, coeficiente, área libre, lote), m² construibles según el lote y alerta si otra zona queda a 20 m o menos | 20 m (convención del proyecto) | Plano y Reglamento del PDM Arequipa 2016-2025 |
| V1b Zonificación proyectada | Solo un aviso de texto sobre el estado del PDM nuevo; aparece únicamente si `CONFIG.estadoPDM` tiene fuente y fecha. No hay mapa | — | Diario Correo (nota de prensa) |
| V2 Salud | Establecimiento de salud más cercano (hospitales, clínicas, centros y puestos de salud, policlínicos; **sin consultorios médicos**) | 1000 m (convención del proyecto) | RENIPRESS (SUSALUD), con OpenStreetMap de respaldo |
| C1 Consultorio médico | Consultorio médico más cercano y su distancia. Es una **categoría aparte de la salud** y **`INFORMATIVO`**: sin umbral (la distancia de referencia es una decisión pendiente), no dice cumple ni no cumple, no suma a ningún puntaje, no entra en la búsqueda de zonas del asistente y no cuenta como «salud cerca» | Ninguno (decisión pendiente) | RENIPRESS (SUSALUD), con OpenStreetMap de respaldo |
| V3 Educación | Colegio más cercano por nivel: inicial, primaria y secundaria | 500 / 1500 / 3000 m (MINEDU, numeral 7.1, Cuadro N.° 1, distancias referenciales; RVM 104-2019 y 208-2019-MINEDU) | Padrón de ESCALE (MINEDU), con OpenStreetMap de respaldo |
| V4 Transporte | Paradero más cercano y líneas de bus que pasan a 400 m o menos | 400 m (convención del proyecto) | OpenStreetMap (paradero); SmartBus, con permiso verbal (líneas) |
| V5 Área verde | Área verde de al menos 5000 m² a 300 m o menos (y, como sensibilidad, de al menos 1 ha) | 300 m / 5000 m² (OMS Europa, 2016, p. 39; indicador, no norma) | OpenStreetMap |
| N1 Quebradas y cauces | Cauce más cercano de la red hidrográfica y su distancia. **Estado `INFORMATIVO`**: no hay umbral normativo, así que no dice cumple ni no cumple, salvo con el umbral que fije la persona en «Mis umbrales» («según tu umbral») | Ninguno (parámetro del usuario) | ANA (red de 2018), IGP (quebradas y ríos de Arequipa) y OpenStreetMap (ODbL), unidos sin duplicados; cada tramo, y cada cifra, dice de cuál fuente es. Ninguna es completa |
| Contexto de riesgo | Peligros geológicos registrados a 500 m, sismos reportados a 100 km y **peligro volcánico del Misti** (en qué zonas de peligro alto, moderado o bajo por lahares, flujos piroclásticos, lava, avalanchas y ceniza cae el punto). **Siempre `INFORMATIVO`**: contexto, no una evaluación de peligro; nunca cumple / no cumple ni puntaje | — | INGEMMET (inventario), IGP (sismos reportados desde el 2026-01-01) e IGP (zonas de peligro volcánico, sin fecha de elaboración en el servicio) |
| Riesgo del distrito ante El Niño | Nivel de riesgo ante inundaciones y ante movimientos en masa que el CENEPRED estima para el **distrito** del punto en un escenario de lluvias como las de El Niño (más las viviendas, locales educativos y establecimientos de salud del distrito en zonas de mayor susceptibilidad). **Siempre `INFORMATIVO`**: estimación por distrito, no del predio; nunca cumple / no cumple ni puntaje | — | CENEPRED (SIGRID), escenario ante El Niño 2026-2027 |
| Precio de oferta del distrito | Mediana del **precio pedido** por m² de departamentos en venta en el distrito del punto, con número de avisos y periodo. **Siempre `INFORMATIVO`** (nunca cumple / no cumple ni puntaje): son precios de avisos, no de cierre, y el promedio del distrito, no el de un inmueble. Solo hay cifra en los distritos con al menos 30 avisos (hoy Cayma, Yanahuara y Cerro Colorado); en los demás es `SIN DATO` con su causa | — | Aptología, «Vivienda en Arequipa» (octubre de 2026), datos abiertos [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): *Datos: Aptologia* |

Cada resultado tiene la forma `{ estado: 'CUMPLE' | 'NO CUMPLE' | 'SIN DATO' (o 'INFORMATIVO' en quebradas, contexto y precio del distrito), nombre, distanciaM, umbralM, fuente, fecha, metodo }`. Las distancias son **en línea recta** (haversine, R = 6 371 008,8 m), no recorrido a pie. Los cálculos están en `public/js/calculos.js`, como funciones puras con pruebas en `test/calculos.spec.ts`.

La aplicación **no recomienda** dónde comprar ni construir y **no da un puntaje global**: no hay base para decidir cuánto pesa cada variable. Cada dato indica qué no cubre.

### Módulos fuera de alcance

Seguridad (denuncias), desastre (peligros geológicos), zona sísmica y registro de riesgos siguen en el código, pero están ocultos (`CONFIG.modulos` en `public/js/config.js`). Para mostrarlos se usa el parámetro `?modulos=todos`, por ejemplo `http://localhost:3000/?modulos=todos`.

## Asistente de chat

El botón **Asistente** de la barra superior abre un chat que usa los mismos datos y umbrales de la ficha. Los números, distancias y estados los calcula siempre el motor determinista (`public/js/asistente.js`) en el navegador, con los archivos congelados. Si el servidor tiene configurado Gemini, el modelo solo **interpreta** la frase y **redacta** la respuesta; si no, el chat entiende el texto con reglas explícitas. La cabecera del chat indica «Modo: Gemini» o «Modo: reglas».

### Asistente con Gemini

- **Qué hace el modelo:**
  1. Convierte la frase en una consulta estructurada. Lo hace con la única función que puede llamar (`consulta_asistente`). La salida se valida contra un esquema (`public/js/asistente-llm.js`), en el servidor y otra vez en el navegador.
  2. Reescribe en pocas líneas la respuesta que ya calculó el motor. Se comprueba que cada cifra y cada nombre propio estén en ese resultado, que se conserve el aviso «referencial» y que no haya recomendaciones de compra. Si algo no pasa, se muestra el texto determinista.
- **Qué no hace:** no calcula, no elige pesos, no da puntajes ni recomienda comprar. No recibe los datos geográficos, solo la frase, los últimos turnos y, al redactar, el texto ya calculado.
- **Respaldo:** si no hay clave (503), si falla, si tarda más de 8 s o si el sitio no tiene la función (por ejemplo, un servidor estático), el chat usa las reglas sin interrumpirse.
- **Clave:** se lee solo en el servidor, desde `GEMINI_API_KEY`; nunca llega al navegador. Opcionalmente, `GEMINI_MODEL` cambia el modelo (por defecto `gemini-3.5-flash-lite`).
  - **Local:** crea `.env.local` con `GEMINI_API_KEY=...`, como muestra `.env.example`. `pnpm start` lo lee y git lo ignora.
  - **Vercel:** Project → Settings → Environment Variables → `GEMINI_API_KEY`. La función está en `api/chat.js`.
- **Límite:** 20 solicitudes por minuto por IP y mensajes de 300 caracteres como máximo.

- **Sobre tu punto:** «¿qué zona es?», «¿hay un colegio cerca de mi punto?», «¿cuánto puedo construir en un lote de 200 m²?», «¿cambiará la zonificación?», «dame un resumen».
- **Contar en un distrito:** «¿cuántos colegios hay en Paucarpata?» (también «parques», «postas», «paraderos»). Responde «En Paucarpata hay N colegios: a inicial, b primaria, c secundaria (ESCALE, con OpenStreetMap de respaldo, fecha; puede faltar alguno)» y dibuja esos colegios en el mapa. El nombre del distrito se entiende sin tildes ni mayúsculas y con errores de tipeo («pauccarpata», «cerro colorao»).
- **Perfil de un distrito:** «quiero vivir en Paucarpata» o «la mejor zona para vivir en Paucarpata» da un resumen de ese distrito (zonificación por tipo, servicios, quebradas que lo cruzan) y pregunta qué es lo primero para ti, con botones que buscan dentro de ese distrito. «La mejor zona» sin distrito no elige una: explica que depende de lo que te importe y pregunta qué importa. Suma las líneas de SmartBus que lo cruzan y, si el distrito tiene cifra, el precio de oferta por m².
- **Buscar zonas:** «busco cerca de un colegio y un parque», «busco en Paucarpata un sector con colegio y parque cerca». Responde en lenguaje llano («Encontré 3 sectores de Paucarpata donde tienes a la vez un colegio a menos de 500 m y un parque a menos de 300 m»), nombra cada sector con el colegio, parque o posta más cercano que tenga nombre y trae «Ver en el mapa» y «Consultar este punto». No hay porcentajes ni ranking; solo si marcas una prioridad («lo más importante es el parque») se ordena por cercanía a ella. Se ajusta con «agrega transporte», «quita el parque», «prioriza el colegio» o «incluye zonas condicionales».
- **Mapa por entidades:** sobre el mapa, «Ver en el mapa:» dibuja lo que existe: los colegios (con una letra y forma por nivel), la salud, los paraderos, los parques como polígonos, solo las zonas del plano que pediste, las quebradas como líneas y los sismos como círculos según su magnitud. Una búsqueda resalta los sectores donde se cumple todo a la vez; lo que no cumple no se pinta. La leyenda explica cada capa y «Quitar del mapa» las limpia.
- **Tu punto, en llano:** al consultar un punto, el chat resume lo que importa para comprar (zona y cuánto se puede construir, qué tienes cerca, qué queda más lejos de lo recomendado, el cauce más cercano) con los botones «Ver detalle técnico», «Guardar para comparar» y «¿Qué debo verificar antes de comprar?». La ficha empieza con ese resumen y deja las fuentes, el método y los límites plegados. Incluye «Pasan N líneas a menos de 400 m: …» con los recorridos de SmartBus.
- **Sin escribir:** «Armar una búsqueda sin escribir» abre menús desplegables: qué quieres tener cerca (servicios y tipo de zona, con selección múltiple), nivel educativo, lo más importante, distancia máxima y «Incluir zonas condicionales», más búsquedas rápidas con un toque. Los menús generan la misma consulta que el chat saca de una frase (`Asistente.construirConsulta`), así que hay un solo motor de decisión. Cada distrito del resultado se abre y cierra, y cada respuesta trae un apartado «Por qué, fuente y límites».
- **Líneas de transporte:** «¿qué buses pasan por aquí?» (sobre tu punto) o «¿qué líneas pasan por Paucarpata?» (sobre un distrito). Usa los recorridos de SmartBus; no tiene frecuencias ni horarios. Dibuja en el mapa los recorridos de cada línea (un color por línea, con etiqueta y leyenda) y la parada más cercana a tu punto.
- **Riesgo del distrito ante El Niño (CENEPRED):** «¿Paucarpata se inunda?», «riesgo de huaico en Sachaca» o «¿qué dice el CENEPRED de mi punto?». Responde con el nivel de riesgo del distrito ante inundaciones y movimientos en masa, su fuente y sus límites (es una estimación por distrito, no del predio), sin «cumple» ni puntaje. «Muéstrame en el mapa…» colorea los distritos por nivel con su leyenda, y también hay dos botones en «Ver en el mapa». Aparece además en el resumen del punto, en el perfil del distrito, en «Comparar puntos» y en el informe.
- **Peligro volcánico del Misti:** «¿estoy en peligro por el volcán?», «¿hay lahares cerca de mi punto?» (sobre tu punto) o «¿Paucarpata está en peligro por el Misti?» (qué parte del distrito cae en cada nivel). Responde con las zonas del IGP, su fuente y sus límites, sin «cumple» ni puntaje, y dibuja las zonas en el mapa (una línea de leyenda por nivel; la ceniza cubre toda la ciudad y no se dibuja). Una búsqueda de zonas «lejos del volcán» todavía no se puede y el chat lo dice.
- **Quebradas, sismos y peligros:** «¿hay una quebrada cerca de mi punto?», «¿cuántos sismos hubo?», «¿hay peligros geológicos cerca?» se responden sobre el punto con su fuente y sus límites, como contexto informativo. También se puede pedir «lejos de quebradas a más de 200 m» (o elegirlo en el menú «Lejos de quebradas y ríos»): la distancia la fija la persona, porque no existe una oficial; si falta, el asistente la pide.
- **Qué entiende:** salud, colegio (inicial, primaria o secundaria), transporte, área verde, campiña (zona agrícola), zona residencial, tranquilo, comercial y centro histórico. «Tranquilo», «mall» y «barrio tradicional» son aproximaciones con la zonificación y el chat lo avisa.
- **Precio por m² del distrito:** «¿cuánto cuesta el m² en Cayma?», «precio por metro cuadrado en Yanahuara» o «¿qué distrito es el más caro?» se responden con el precio de oferta de Aptología (con avisos, periodo y atribución). Si el distrito no tiene cifra, lo dice y no la estima. Sin distrito en la frase usa el del punto.
- **Qué no sabe:** seguridad y ruido, ni el precio de una casa, un terreno o un alquiler en particular, ni buscar zonas por precio. Solo conoce el promedio de oferta por m² de algunos distritos, y lo dice en vez de responder a medias.

Las reglas y sus límites están en [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md), §11.

## Inicio de sesión opcional (Google)

La aplicación funciona completa sin cuenta. Si el servidor tiene configurado Google como proveedor de identidad, la barra superior muestra una entrada discreta «Iniciar sesión» (o «Hola, nombre») que lleva a `login.html`, con un enlace «Continuar sin cuenta». Si falta la configuración o el sitio es estático, la entrada no aparece y nada más cambia.

- **Cómo funciona:** OpenID Connect con código de autorización y PKCE (S256), `state` y `nonce`. El navegador va a Google, vuelve a `/api/auth/callback`, y el servidor canjea el código con el secreto del cliente y valida los reclamos del ID token (`iss`, `aud`, `exp`, `nonce`). No añade dependencias: usa `crypto` y `fetch` de Node.
- **Qué lee y qué guarda:** pide solo `openid profile`. Guarda `sub` (identificador opaco) y `name`; no pide el correo ni la foto, y no guarda ningún token de Google. No hay base de datos ni almacén en el servidor.
- **Sesión:** una cookie firmada con HMAC-SHA256 (`HttpOnly`, `SameSite=Lax`, `Secure` si `AUTH_BASE_URL` es https, con prefijo `__Host-` en ese caso) que dura 7 días. «Cerrar sesión» es un `POST` que solo acepta peticiones del mismo origen.
- **Endpoints** (mismos en Vercel y en Nest; la lógica está en `api/_lib/auth.js`):
  - `GET /api/auth/google` inicia el flujo.
  - `GET /api/auth/callback` lo termina y abre la sesión.
  - `GET /api/auth/me` devuelve `{ "autenticado": boolean, "nombre"?: string }`.
  - `POST /api/auth/logout` cierra la sesión.
  - Si falta cualquier variable, responden `503` con `{ "error": "no_configurado" }`.
- **Variables de entorno** (solo en el servidor; nunca en el código ni en el navegador):
  - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: credenciales «ID de cliente de OAuth» (aplicación web) de Google Cloud Console.
  - `AUTH_SESSION_SECRET`: secreto para firmar las cookies, de 32 caracteres o más. Por ejemplo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Cambiarlo cierra todas las sesiones.
  - `AUTH_BASE_URL`: origen público de la aplicación, sin ruta ni barra final. Define el URI de redireccionamiento `${AUTH_BASE_URL}/api/auth/callback`. Debe ser https, salvo `http://localhost` o `http://127.0.0.1` en local.
- **URIs de redireccionamiento autorizados** (Google Cloud Console → Credenciales → tu cliente OAuth):
  - Local: `http://localhost:3000/api/auth/callback` (con `AUTH_BASE_URL=http://localhost:3000`).
  - Producción: `https://geoverificador-nine.vercel.app/api/auth/callback` (con `AUTH_BASE_URL=https://geoverificador-nine.vercel.app`).
  - La pantalla de consentimiento solo necesita los alcances `openid` y `profile`.
- **Local:** añade las cuatro variables a `.env.local` (git lo ignora) y ejecuta `pnpm start`.
- **Vercel:** Project → Settings → Environment Variables. Las funciones están en `api/auth/*.js`. Los despliegues de vista previa tienen otro dominio: no coincide con `AUTH_BASE_URL`, así que el inicio de sesión solo funciona en el dominio registrado.

## Ayudas para decidir

- **Recorrido guiado.** La primera visita abre un recorrido de 6 pasos (qué hace y qué no hace la herramienta, cómo elegir un punto, cómo leer una tarjeta, el asistente, comparar puntos y las verificaciones antes de comprar). Se puede omitir y se vuelve a abrir con «¿Cómo funciona?». Con `?tour=no` en la URL no se abre solo. Contenido en `public/js/tour.js`.
- **Tarjetas desplegables.** Cada servicio muestra su estado y su distancia frente al umbral; al abrirla trae el método, la fuente, la fecha y lo que el dato no cubre.
- **Comparar puntos.** En el reporte, «Guardar para comparar» guarda hasta 3 puntos; «Comparar» (barra superior) los muestra lado a lado con las 5 variables (estado, distancia en línea recta y umbral). **No hay puntaje global.** La persona marca qué variables son su prioridad (se guardan solo en su navegador) y la tabla resalta qué punto las cumple y qué pares de puntos se dominan; nunca declara un ganador. Lógica pura en `public/js/comparar.js`.
- **Verificaciones recomendadas antes de comprar.** Panel plegable del reporte que separa lo que la herramienta calculó de lo que la persona debe comprobar (certificados municipales, SUNARP, saneamiento, licencias, servicios básicos, peligros). Es contenido estático en `public/js/verificaciones.js`: para agregar una verificación se suma un objeto a `ITEMS`. Solo lleva enlaces comprobados.

## Límites

- **Distancia en línea recta**, no recorrido real. Un colegio o paradero a 400 m en línea recta puede estar mucho más lejos por la red vial.
- **Referencial.** No reemplaza el Certificado de Zonificación y Vías ni el Certificado de Parámetros Urbanísticos y Edificatorios, que son los documentos con valor legal (los emite el IMPLA o la municipalidad distrital).
- **Vigencia del PDM incierta.** El PDM 2016-2025 llegó al fin de su vigencia de diez años, hay un PDM nuevo en trámite y hay una suspensión judicial de ciertos actos de ejecución. La zona mostrada puede no ser la que aplica hoy. Ver [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md), §3.
- **Líneas de transporte (SmartBus).** Son los recorridos que SmartBus publicó en la fecha de descarga (`metadata.fecha_descarga`): sin frecuencias ni horarios, y un cambio de ruta por tramos puede no estar reflejado. Se usan con autorización verbal de SmartBus; la confirmación escrita está pendiente. Las paradas de SmartBus tienen nombres numerados («Cettar - 12»).
- **Salud y educación: registros oficiales, no completos.** Salud sale de RENIPRESS y los colegios del padrón de ESCALE; cada establecimiento dice de qué fuente es y su código oficial. RENIPRESS no trae las coordenadas de cerca del 42 % de los establecimientos de Arequipa (no pueden ubicarse), y ESCALE ubica el local que reportó la UGEL. OpenStreetMap solo completa donde ningún registro oficial tiene un punto del mismo tipo a 200 m.
- **Paraderos y áreas verdes: OpenStreetMap.** Los datos dependen de lo mapeado por los colaboradores; pueden faltar o estar desactualizados paraderos y áreas verdes.

## Documentación

- [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md): de dónde sale cada dato, cómo se transforma, por qué se decidió así y qué límites tiene.
- [`docs/VALIDACION.md`](docs/VALIDACION.md): qué está verificado, qué falta validar y el protocolo para hacerlo.
- [`docs/ENTREGA.md`](docs/ENTREGA.md): estado del proyecto, qué funciona y qué está pendiente.

## Requisitos

- Node.js 22 o superior.
- **[pnpm](https://pnpm.io/) 11 o superior.** No uses `npm install`: no hay `package-lock.json`, y npm resolvería versiones distintas a las de `pnpm-lock.yaml`.

## Ejecutar localmente

```bash
pnpm install
pnpm start             # compila y arranca en http://localhost:3000
```

- Para desarrollo con recarga automática: `pnpm start:dev`.
- Nest sirve el frontend estático de `public/` y expone `GET /api`.
- El puerto se cambia con la variable de entorno `PORT`.

`pnpm-workspace.yaml` guarda dos ajustes de pnpm:

- `allowBuilds`: los scripts de instalación de `@parcel/watcher` y `unrs-resolver` están desactivados a propósito (traen binarios precompilados; esos scripts solo compilan desde el código fuente).
- `overrides`: parches de seguridad para dependencias transitivas de desarrollo.

El frontend es JavaScript sin dependencias de compilación (Leaflet se carga desde CDN). Las cinco variables se resuelven con archivos locales de `public/data`: la zonificación y el equipamiento ya congelado en `public/data/equipamiento` (salud de RENIPRESS y colegios de ESCALE, con OpenStreetMap de respaldo; paraderos y áreas verdes de OpenStreetMap). Solo la búsqueda de direcciones (Nominatim) consulta un servicio externo, al pulsar «Buscar». Si falta un archivo de equipamiento, la aplicación consulta Overpass en vivo como respaldo, con reintentos entre los servidores de `CONFIG.overpassEndpoints`.

## Scripts

| Comando | Qué hace | Red |
|---|---|---|
| `pnpm start` | Compila y arranca el servidor | No |
| `pnpm start:dev` | Arranca con recarga automática | No |
| `pnpm build` | Compila TypeScript a `dist/` | No |
| `pnpm test` | Pruebas unitarias (Jest) | No |
| `pnpm test:e2e` | Pruebas extremo a extremo (`GET /` y `GET /api`) | No |
| `pnpm lint` | Análisis estático con oxlint (`src/` y `test/`) | No |
| `pnpm datos:verificar` | Integridad de los datos y cálculos frente a un método independiente | No |
| `pnpm datos:rutas` | Descarga las rutas y paradas de SmartBus a `public/data/rutas_smartbus.geojson` (≥ 1 s entre solicitudes, User-Agent propio, caché en `.cache-smartbus/`; se detiene si el sitio pide sesión o bloquea) | Sí (smartbus.app) |
| `pnpm datos:extraer` | Descarga el equipamiento de OpenStreetMap: paraderos y áreas verdes a `public/data/equipamiento` y, como respaldo, salud y educación a `public/data/equipamiento/osm` | Sí (Overpass) |
| `pnpm datos:oficial` | Descarga RENIPRESS (SUSALUD) y el padrón de ESCALE (MINEDU) y arma `salud.geojson`, `consultorios.geojson` y `educacion.geojson` con los registros oficiales como fuente primaria y la copia de OpenStreetMap como respaldo (caché en `.cache-equipamiento-oficial/`, fuera del repositorio; unos minutos la primera vez, por el DBF de 290 MB). Reglas en `docs/METODOLOGIA.md` §6 | Sí |
| `pnpm datos:validar-osm` | Contrasta la zonificación con lugares de OpenStreetMap (usa la referencia guardada en `docs/validacion/`) | No |
| `pnpm datos:validar-plano` | Contrasta la zonificación con el PDF oficial del plano (la ruta del PDF se pasa como argumento) | No |
| `node --use-system-ca scripts/descargar-peligros.mjs` | Regenera `public/data/peligros_aqp.geojson` desde el servicio público de INGEMMET (solo trae los movimientos en masa: no sobrescribe el archivo congelado, que tiene más registros, sin `--forzar`) | Sí |
| `node scripts/descargar-quebradas.mjs` | Genera `public/data/quebradas_aqp.geojson`: cauces de la ANA, el IGP (capas Quebrada y RiosArequipa) y OpenStreetMap (consulta Overpass de `waterway=river\|stream`), sin duplicados y con la fuente de cada tramo. Si una fuente falla no escribe nada (`--osm-json=ruta` reutiliza una respuesta de Overpass ya guardada) | Sí |
| `node scripts/descargar-riesgo-cenepred.mjs` | Genera `public/data/riesgo_cenepred_fen2027.json` (nivel de riesgo ante inundaciones y movimientos en masa de los 25 distritos, con las viviendas, locales educativos y establecimientos de salud en zonas de mayor susceptibilidad; capas 4 y 5 del SIGRID del CENEPRED). Falla y conserva el archivo si falta un distrito, aparece un nivel desconocido o el significado de un campo deja de cuadrar con las tablas del estudio | Sí |
| `node scripts/descargar-peligro-volcanico.mjs` | Genera `public/data/peligro_volcanico_misti.geojson` (zonas de peligro volcánico del Misti del IGP: lahares, flujos piroclásticos, lava, avalanchas y ceniza) | Sí |
| `pnpm datos:validar-oficial -- --escale=... --renipress=...` | K2: contrasta la copia de OpenStreetMap con RENIPRESS y el padrón de ESCALE (los archivos de la caché de `pnpm datos:oficial` o descargados a mano; `--escale` acepta el `Padron_web.dbf`; ver `docs/VALIDACION.md` §3.4): exhaustividad, precisión, desfase y cuántos puntos cambian de cumple a no cumple | No |
| `node scripts/descargar-sismos.mjs` | Genera `public/data/sismos_igp.geojson` (sismos reportados por el IGP; cubre desde 2026-01-01, no es el catálogo histórico) | Sí |
| `node scripts/descargar-precios.mjs` | Genera `public/data/precios_m2_distrito.json` (precio de oferta por m² por distrito, Aptología CC BY 4.0). Solo escribe si la ficha del conjunto declara CC BY 4.0; si falla, conserva el archivo existente | Sí |
| `node scripts/descargar-delitos.mjs` | Genera `public/data/delitos_aqp.geojson` | Sí |
| `node scripts/descargar-distritos.mjs` | Genera `public/data/distritos_aqp.geojson` (zona sísmica E.030) | Sí |

Los datos ya descargados están en el repositorio: solo es necesario regenerarlos si cambia la fuente.

## Integración continua y despliegue

- `.github/workflows/ci.yml` se ejecuta en cada `push` y `pull_request`: instala con `pnpm install --frozen-lockfile`, y corre `lint`, `test`, `build` y `datos:verificar`. No usa red para las pruebas.
- El sitio se despliega en Vercel como sitio estático (`vercel.json` publica `public/` sin instalación ni build) más las funciones de `api/` (`api/chat.js` y `api/auth/*.js`). La versión desplegada no incluye `GET /api` ni el servidor de Nest.

## Datos y licencias

- **RENIPRESS.** Salud: Registro Nacional de Entidades Prestadoras de Servicios de Salud, Superintendencia Nacional de Salud (SUSALUD), publicado en [datosabiertos.gob.pe](https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress) bajo la licencia [Open Data Commons Attribution (ODC-By)](http://opendefinition.org/licenses/odc-by/); se atribuye a SUSALUD.
- **Padrón de ESCALE.** Colegios: padrón de instituciones educativas de [ESCALE](https://escale.minedu.gob.pe/padron-de-iiee), Unidad de Estadística del Ministerio de Educación. **No declara una licencia abierta**: el archivo trae un «Acuerdo de uso de datos» (la fuente es el Padrón de Servicios Educativos; la ubicación la proporcionan las DRE/GRE y las UGEL y corresponde al local educativo). Se usa con atribución al MINEDU y sin redistribuir el padrón completo: el repositorio solo guarda los locales de la provincia de Arequipa con su código.
- **OpenStreetMap.** Respaldo de salud y colegios, paraderos, áreas verdes y mapa base: © colaboradores de OpenStreetMap, bajo [ODbL](https://opendatacommons.org/licenses/odbl/). La atribución figura en la aplicación.
- **Zonificación.** Plano de Zonificación y Reglamento del Plan de Desarrollo Metropolitano de Arequipa 2016-2025, aprobado por la Ordenanza Municipal N.° 961-MPA (del 3 de febrero de 2016), con la zonificación restituida por la Ordenanza N.° 975-MPA. Fuente: Municipalidad Provincial de Arequipa e IMPLA.
- **Norma E.030 y límites distritales.** Ver `public/js/config.js` y `docs/METODOLOGIA.md`.
- **Rutas de transporte.** Rutas y paradas: SmartBus (smartbus.app), usadas con autorización verbal; confirmación escrita pendiente. Atribución en la aplicación: «Rutas: SmartBus (smartbus.app)». Hasta tener la confirmación escrita, no se redistribuye el archivo como dato abierto.
- **Quebradas y ríos.** ANA (Autoridad Nacional del Agua, red hidrográfica de 2018; licencia no localizada, se atribuye a la ANA), IGP (Instituto Geofísico del Perú, servicio `monitoreocenvul/ArequipaMisti`, capas Quebrada y RiosArequipa; sin licencia ni fecha en el servicio, se atribuye al IGP) y © colaboradores de OpenStreetMap ([ODbL](https://opendatacommons.org/licenses/odbl/)) para los cauces con nombre y los ríos.
- **Riesgo del distrito ante El Niño.** CENEPRED (SIGRID), capas «Riesgos a inundación» y «Riesgos a movimientos en masa» del servicio `FEN/ER_NINO2027_BD`, congeladas el 2026-11-03. Metodología: CENEPRED (2026). «Estudio de escenarios de riesgo por inundaciones y movimientos en masa ante lluvias intensas asociadas al Fenómeno El Niño», mayo de 2026 (Subdirección de Gestión de la Información, Dirección de Gestión de Procesos). https://sigrid.cenepred.gob.pe/sigridv3/storage/biblioteca//22033_estudio-de-escenarios-de-riesgo-por-inundaciones-y-movimientos-en-masa-ante-lluvias-intensas-asociadas-al-fenomeno-el-nino.pdf La capa dice estar actualizada con el Informe Técnico N.° 69-2026/SENAMHI-DMA-SPC; no se encontró ese informe, así que las definiciones salen del estudio de mayo. Es una estimación por distrito para lluvias como las de 1983, 1998, 2017 y 2023, no una predicción ni una evaluación de tu predio.
- **Peligro volcánico del Misti.** Instituto Geofísico del Perú (IGP, servicio `monitoreocenvul/Vulcanologia`, capas de lahares, flujos piroclásticos, lava, avalanchas y ceniza); sin licencia ni fecha de elaboración en el servicio. El mapa oficial de referencia es el de INGEMMET (Boletín Serie C n.° 100, «Geología y nuevos mapas de peligros del volcán Misti», 2025, que reemplaza al n.° 60 de 2016); no se pudo confirmar de qué edición salen las capas del IGP.
- **Precio de oferta por m² del distrito.** [Aptología](https://www.aptologia.com/datos-abiertos), estudio «Vivienda en Arequipa: precio por m², arriendo, habitaciones y rentabilidad (octubre 2026)» de Daniel Mauricio Pinzón Pineda, bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Atribución que pide la fuente: «Datos: Aptologia» con enlace a la página de origen; figura junto a cada cifra y en «Fuentes de datos». Los valores se redondearon a soles enteros y se filtraron a los distritos de Arequipa Metropolitana.
- **Búsqueda de direcciones.** Nominatim (OpenStreetMap), sujeta a su política de uso (máximo 1 solicitud por segundo).

El código no tiene licencia de código abierto: `package.json` declara `UNLICENSED`.

## Pruebas

```bash
pnpm test              # unitarias
pnpm test:e2e          # extremo a extremo (GET / y GET /api, sin servidor externo)
pnpm lint
pnpm build
pnpm datos:verificar
```
