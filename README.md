# GeoVerificador

Ficha de un predio en Arequipa metropolitana, con datos públicos. Se elige un punto en el mapa y la aplicación evalúa **5 variables**, cada una por separado y con su fuente:

| Variable | Qué muestra | Umbral | Fuente |
|---|---|---|---|
| V1a Zonificación vigente | Zona, nombre, parámetros (pisos, coeficiente, área libre, lote), m² construibles según el lote y alerta si otra zona queda a 20 m o menos | 20 m (convención del proyecto) | Plano y Reglamento del PDM Arequipa 2016-2025 |
| V1b Zonificación proyectada | Solo un aviso de texto sobre el estado del PDM nuevo; aparece únicamente si `CONFIG.estadoPDM` tiene fuente y fecha. No hay mapa | — | Diario Correo (nota de prensa) |
| V2 Salud | Establecimiento de salud más cercano | 1000 m (convención del proyecto) | OpenStreetMap |
| V3 Educación | Colegio más cercano por nivel: inicial, primaria y secundaria | 500 / 1500 / 3000 m (MINEDU, Cuadro N.° 1 del Instructivo FTE; RVM 104-2019 y 208-2019-MINEDU) | OpenStreetMap |
| V4 Transporte | Paradero más cercano | 400 m (convención del proyecto) | OpenStreetMap |
| V5 Área verde | Área verde de al menos 5000 m² a 300 m o menos (y, como sensibilidad, de al menos 1 ha) | 300 m / 5000 m² (OMS Europa, 2016) | OpenStreetMap |
| N1 Quebradas y cauces | Cauce más cercano de la red hidrográfica y su distancia. **Estado `INFORMATIVO`**: no hay umbral normativo, así que no dice cumple ni no cumple, salvo con el umbral que fije la persona en «Mis umbrales» («según tu umbral») | Ninguno (parámetro del usuario) | ANA (red de 2018, escala nacional; no incluye todas las quebradas urbanas) |
| Contexto de riesgo | Peligros geológicos registrados a 500 m y sismos reportados a 100 km. **Siempre `INFORMATIVO`**: contexto, no una evaluación de peligro | — | INGEMMET (inventario) e IGP (sismos reportados desde el 2026-01-01) |
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
- **Buscar zonas:** «busco cerca de un colegio y un parque, lo más importante es el parque, en un radio de 1 km». Revisa una cuadrícula de 250 m sobre las zonas construibles del plano y las agrupa por distrito. Informa el **porcentaje del suelo habitable** que cumple lo pedido (no una probabilidad). Se ajusta con «agrega transporte», «quita el parque», «prioriza el colegio» o «incluye zonas condicionales». Cada distrito trae botones para verlo en el mapa y consultar su mejor punto con la ficha completa.
- **Sin escribir:** «Armar una búsqueda sin escribir» abre menús desplegables: qué quieres tener cerca (servicios y tipo de zona, con selección múltiple), nivel educativo, lo más importante, distancia máxima y «Incluir zonas condicionales», más búsquedas rápidas con un toque. Los menús generan la misma consulta que el chat saca de una frase (`Asistente.construirConsulta`), así que hay un solo motor de decisión. Cada distrito del resultado se abre y cierra, y cada respuesta trae un apartado «Por qué, fuente y límites».
- **Quebradas, sismos y peligros:** «¿hay una quebrada cerca de mi punto?», «¿cuántos sismos hubo?», «¿hay peligros geológicos cerca?» se responden sobre el punto con su fuente y sus límites, como contexto informativo. También se puede pedir «lejos de quebradas a más de 200 m» (o elegirlo en el menú «Lejos de quebradas y ríos»): la distancia la fija la persona, porque no existe una oficial; si falta, el asistente la pide.
- **Qué entiende:** salud, colegio (inicial, primaria o secundaria), transporte, área verde, campiña (zona agrícola), zona residencial, tranquilo, comercial y centro histórico. «Tranquilo», «mall» y «barrio tradicional» son aproximaciones con la zonificación y el chat lo avisa.
- **Precio por m² del distrito:** «¿cuánto cuesta el m² en Cayma?», «precio por metro cuadrado en Yanahuara» o «¿qué distrito es el más caro?» se responden con el precio de oferta de Aptología (con avisos, periodo y atribución). Si el distrito no tiene cifra, lo dice y no la estima. Sin distrito en la frase usa el del punto.
- **Qué no sabe:** seguridad y ruido, ni el precio de una casa, un terreno o un alquiler en particular, ni buscar zonas por precio. Solo conoce el promedio de oferta por m² de algunos distritos, y lo dice en vez de responder a medias.

Las reglas y sus límites están en [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md), §11.

## Ayudas para decidir

- **Recorrido guiado.** La primera visita abre un recorrido de 6 pasos (qué hace y qué no hace la herramienta, cómo elegir un punto, cómo leer una tarjeta, el asistente, comparar puntos y las verificaciones antes de comprar). Se puede omitir y se vuelve a abrir con «¿Cómo funciona?». Con `?tour=no` en la URL no se abre solo. Contenido en `public/js/tour.js`.
- **Tarjetas desplegables.** Cada servicio muestra su estado y su distancia frente al umbral; al abrirla trae el método, la fuente, la fecha y lo que el dato no cubre.
- **Comparar puntos.** En el reporte, «Guardar para comparar» guarda hasta 3 puntos; «Comparar» (barra superior) los muestra lado a lado con las 5 variables (estado, distancia en línea recta y umbral). **No hay puntaje global.** La persona marca qué variables son su prioridad (se guardan solo en su navegador) y la tabla resalta qué punto las cumple y qué pares de puntos se dominan; nunca declara un ganador. Lógica pura en `public/js/comparar.js`.
- **Verificaciones recomendadas antes de comprar.** Panel plegable del reporte que separa lo que la herramienta calculó de lo que la persona debe comprobar (certificados municipales, SUNARP, saneamiento, licencias, servicios básicos, peligros). Es contenido estático en `public/js/verificaciones.js`: para agregar una verificación se suma un objeto a `ITEMS`. Solo lleva enlaces comprobados.

## Límites

- **Distancia en línea recta**, no recorrido real. Un colegio o paradero a 400 m en línea recta puede estar mucho más lejos por la red vial.
- **Referencial.** No reemplaza el Certificado de Zonificación y Vías ni el Certificado de Parámetros Urbanísticos y Edificatorios, que son los documentos con valor legal (los emite el IMPLA o la municipalidad distrital).
- **Vigencia del PDM incierta.** El PDM 2016-2025 llegó al fin de su vigencia de diez años, hay un PDM nuevo en trámite y hay una suspensión judicial de ciertos actos de ejecución. La zona mostrada puede no ser la que aplica hoy. Ver [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md), §3.
- **Equipamiento de OpenStreetMap.** Los datos dependen de lo mapeado por los colaboradores; pueden faltar o estar desactualizados establecimientos, colegios y paraderos.

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

El frontend es JavaScript sin dependencias de compilación (Leaflet se carga desde CDN). Las cinco variables se resuelven con archivos locales de `public/data`: la zonificación y el equipamiento de OpenStreetMap ya congelado en `public/data/equipamiento`. Solo la búsqueda de direcciones (Nominatim) consulta un servicio externo, al pulsar «Buscar». Si falta un archivo de equipamiento, la aplicación consulta Overpass en vivo como respaldo, con reintentos entre los servidores de `CONFIG.overpassEndpoints`.

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
| `pnpm datos:extraer` | Descarga el equipamiento de OpenStreetMap a `public/data/equipamiento` | Sí (Overpass) |
| `pnpm datos:validar-osm` | Contrasta la zonificación con lugares de OpenStreetMap (usa la referencia guardada en `docs/validacion/`) | No |
| `pnpm datos:validar-plano` | Contrasta la zonificación con el PDF oficial del plano (la ruta del PDF se pasa como argumento) | No |
| `node --use-system-ca scripts/descargar-peligros.mjs` | Regenera `public/data/peligros_aqp.geojson` desde el servicio público de INGEMMET (solo trae los movimientos en masa: no sobrescribe el archivo congelado, que tiene más registros, sin `--forzar`) | Sí |
| `node scripts/descargar-quebradas.mjs` | Genera `public/data/quebradas_aqp.geojson` (red hidrográfica de la ANA) | Sí |
| `node scripts/descargar-sismos.mjs` | Genera `public/data/sismos_igp.geojson` (sismos reportados por el IGP; cubre desde 2026-01-01, no es el catálogo histórico) | Sí |
| `node scripts/descargar-precios.mjs` | Genera `public/data/precios_m2_distrito.json` (precio de oferta por m² por distrito, Aptología CC BY 4.0). Solo escribe si la ficha del conjunto declara CC BY 4.0; si falla, conserva el archivo existente | Sí |
| `node scripts/descargar-delitos.mjs` | Genera `public/data/delitos_aqp.geojson` | Sí |
| `node scripts/descargar-distritos.mjs` | Genera `public/data/distritos_aqp.geojson` (zona sísmica E.030) | Sí |

Los datos ya descargados están en el repositorio: solo es necesario regenerarlos si cambia la fuente.

## Integración continua y despliegue

- `.github/workflows/ci.yml` se ejecuta en cada `push` y `pull_request`: instala con `pnpm install --frozen-lockfile`, y corre `lint`, `test`, `build` y `datos:verificar`. No usa red para las pruebas.
- El sitio se despliega en Vercel como sitio estático (`vercel.json` publica `public/` sin instalación ni build). La versión desplegada no incluye `GET /api` ni el servidor de Nest.

## Datos y licencias

- **OpenStreetMap.** Salud, educación, transporte, áreas verdes y mapa base: © colaboradores de OpenStreetMap, bajo [ODbL](https://opendatacommons.org/licenses/odbl/). La atribución figura en la aplicación.
- **Zonificación.** Plano de Zonificación y Reglamento del Plan de Desarrollo Metropolitano de Arequipa 2016-2025, aprobado por la Ordenanza Municipal N.° 961-MPA (del 3 de febrero de 2016), con la zonificación restituida por la Ordenanza N.° 975-MPA. Fuente: Municipalidad Provincial de Arequipa e IMPLA.
- **Norma E.030 y límites distritales.** Ver `public/js/config.js` y `docs/METODOLOGIA.md`.
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
