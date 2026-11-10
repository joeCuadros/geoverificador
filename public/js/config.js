/**
 * config.js — Configuración única de la aplicación.
 *
 * Alcance: 5 variables (zonificación vigente, zonificación proyectada, salud, educación, transporte y área verde).
 * Los umbrales, el estado del PDM y los módulos visibles están en este archivo; las etiquetas de OpenStreetMap que
 * entran en cada variable están en Calculos.FILTROS (calculos.js), que sirve a la vez para extraer los datos
 * (scripts/extraer-equipamiento.mjs), clasificarlos y documentarlos en pantalla.
 */
const CONFIG = {
  center: [-16.39883, -71.53697], // Plaza de Armas de Arequipa (Nominatim, way 23811932)
  zoom: 14,

  overpassEndpoints: [
    { label: 'overpass-api.de (principal)', url: 'https://overpass-api.de/api/interpreter' },
    { label: 'maps.mail.ru (alternativo)', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
    { label: 'overpass.kumi.systems (respaldo)', url: 'https://overpass.kumi.systems/api/interpreter' },
  ],
  overpassMaxAttempts: 4,       // intentos totales rotando servidores ante saturación (HTTP 5xx, timeout, red)
  overpassRetryDelayMs: 1500,   // espera creciente entre intentos: 1.5 s, 3 s, 4.5 s…
  overpassTimeoutSec: 25,     // timeout del servidor dentro de la consulta
  // Memoria que la consulta reserva en Overpass. El valor por defecto (512 MB) hace que un servidor
  // saturado la rechace con HTTP 504 (Dispatcher_Client). 5 km de radio ocupan pocos MB, así que 64 MB sobra.
  overpassMaxSizeBytes: 64 * 1024 * 1024,
  clientTimeoutMs: 35000,     // timeout del navegador

  nominatimUrl: 'https://nominatim.openstreetmap.org/search',
  nominatimMinIntervalMs: 1100, // política de Nominatim: máximo 1 solicitud por segundo
  nominatimEmail: '',           // opcional: tu correo, recomendado por Nominatim para identificar la app
  // Caja aproximada de Arequipa metropolitana: oeste, norte, este, sur
  viewbox: '-71.75,-16.20,-71.35,-16.60',

  // Zonificación urbana: archivos locales en public/data (no se consulta ningún servicio externo).
  zonificacion: {
    geojsonUrl: 'data/zonas_aqp.geojson', // polígonos con los campos `codigo` y `color`
    reglasUrl: 'data/reglas_zonas.json',  // reglas por código: pisos, coeficiente, área libre, lote mínimo…
    fuente: 'Plano de Zonificación del PDM Arequipa 2016-2025 (PDM aprobado por la Ordenanza 961-MPA; zonificación restituida por la Ordenanza 975-MPA)',
  },

  // Quebradas y cauces: ANA, IGP y OpenStreetMap unidos y congelados con scripts/descargar-quebradas.mjs (cada tramo dice su
  // fuente). NO hay umbral normativo para la distancia a una quebrada: la variable es INFORMATIVA salvo que la persona fije el
  // suyo en «Mis umbrales». `citadas`: quebradas que nombran los informes de INGEMMET sobre Arequipa (docs/INVESTIGACION-VARIABLES.md);
  // «Qué no cubre» las compara con los nombres del archivo, junto con las que nombra el inventario de peligros.
  quebradas: {
    geojsonUrl: 'data/quebradas_aqp.geojson',
    fuente: 'Cauces de la ANA, el IGP y OpenStreetMap',
    citadas: ['Chullo', 'Los Incas', 'Añashuayco', 'San Lázaro', 'El Pato'],
  },

  // Peligro volcánico del Misti: zonas del IGP (alto, moderado y bajo por lahares, flujos piroclásticos, lava, avalanchas y ceniza),
  // congeladas con scripts/descargar-peligro-volcanico.mjs. Es INFORMATIVO: nunca cumple / no cumple ni puntaje.
  volcan: {
    geojsonUrl: 'data/peligro_volcanico_misti.geojson',
    fuente: 'Zonas de peligro volcánico del Misti, Instituto Geofísico del Perú (IGP)',
  },

  // Sismos reportados por el IGP, congelados con scripts/descargar-sismos.mjs. `radioM` es el radio de CONTEXTO para contar
  // sismos (convención del proyecto, no un umbral de peligro).
  sismos: {
    geojsonUrl: 'data/sismos_igp.geojson',
    radioM: 100000,
    fuente: 'Sismos reportados, Instituto Geofísico del Perú (IGP)',
  },

  // Distritos (límites del INEI vía GEOCATMIN) y zona sísmica de la Norma E.030: archivos locales.
  distritos: {
    geojsonUrl: 'data/distritos_aqp.geojson', // generado con scripts/descargar-distritos.mjs
    e030Url: 'data/zonas_sismicas_e030.json', // Anexo II y Tabla N.° 1 de la E.030 2026, transcritos
    fuente: 'Norma E.030 Diseño Sismorresistente 2026 (MVCS), Anexo II; límites distritales del INEI vía GEOCATMIN',
  },

  // Precio de OFERTA por m² del distrito (Aptología, CC BY 4.0): archivo congelado con scripts/descargar-precios.mjs.
  // Es INFORMATIVO: nunca cumple / no cumple ni entra en un puntaje. La fuente, la licencia y el periodo viajan en el propio archivo.
  precios: {
    jsonUrl: 'data/precios_m2_distrito.json',
  },

  // Escenario de riesgo del CENEPRED ante El Niño 2026-2027 (inundaciones y movimientos en masa) por distrito: archivo congelado con
  // scripts/descargar-riesgo-cenepred.mjs. Es INFORMATIVO: nunca cumple / no cumple ni puntaje, y es una estimación por distrito, no del predio.
  cenepred: {
    jsonUrl: 'data/riesgo_cenepred_fen2027.json',
    fuente: 'Escenario de riesgo ante El Niño 2026-2027, CENEPRED (SIGRID)',
    visorUrl: 'https://sigrid.cenepred.gob.pe/sigridv3/',
  },

  // Peligros geológicos registrados: archivo local generado con scripts/descargar-peligros.mjs.
  peligros: {
    geojsonUrl: 'data/peligros_aqp.geojson',
    radio: 500, // metros alrededor del punto
    fuente: 'Inventario de peligros geológicos, GEOCATMIN (INGEMMET)',
  },

  // Denuncias de robo y hurto: archivo local generado con scripts/descargar-delitos.mjs.
  delitos: {
    geojsonUrl: 'data/delitos_aqp.geojson',
    radio: 500,      // metros alrededor del punto
    coberturaMinima: 0.8, // un mes entra en el periodo si ≥ 80 % de sus denuncias trae coordenada real
    maxMeses: 12,         // tope del periodo
    celda: 100,      // tamaño de celda del mapa de calor, en metros
    suavizado: 200,  // σ del núcleo gaussiano del mapa de calor, en metros
    fuente: 'Mapa del Delito Georreferenciado (MININTER), datos SIDPOL de la PNP',
  },

  // ---------------------------------------------------------------- Alcance de 5 variables

  // Umbrales de cada variable (metros, salvo que se indique). `fuentesUmbral` dice de dónde sale cada uno:
  // «Convención del proyecto» significa que no hay una norma que lo fije y que se eligió como criterio de la herramienta.
  umbrales: {
    bordeZona: 20, // V1a: aviso si otra zona queda a esta distancia o menos del punto (convención del proyecto)
    salud: 1000, // V2 (convención del proyecto): se evalúa SOLO con establecimientos de salud, no con consultorios
    // Consultorio médico: categoría aparte de la salud. NO hay umbral: la distancia de referencia es una decisión PENDIENTE de la persona
    // responsable del proyecto (ninguna norma la fija). Con null la variable es INFORMATIVA: se muestra el más cercano y su distancia,
    // sin cumple / no cumple, sin efecto en el puntaje ni en la búsqueda de zonas del asistente. No inventar un valor aquí.
    consultorio: null,
    // Mercado de abastos, supermercado y mall (centro comercial): categorías INFORMATIVAS, sin umbral. El valor es una decisión de la persona
    // responsable del proyecto. Referencia propuesta: ninguna en metros con fuente verificada (docs/METODOLOGIA.md §6.4: el Sistema Nacional de
    // Estándares de Urbanismo, MVCS 2011, es una propuesta preliminar que fija población por equipamiento, no un radio de influencia en metros).
    // Con null se muestra el más cercano y su distancia, sin cumple / no cumple, sin efecto en el puntaje ni en la búsqueda de zonas. No inventar un valor aquí.
    mercado: null,       // pendiente de decisión del usuario; referencia propuesta: ninguna verificada
    supermercado: null,  // pendiente de decisión del usuario; referencia propuesta: ninguna verificada
    mall: null,          // pendiente de decisión del usuario; referencia propuesta: ninguna verificada
    educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, // V3
    transporte: 400, // V4 (convención del proyecto)
    areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, // V5: ≥ 0,5 ha a ≤ 300 m; sensibilidad: ≥ 1 ha
  },
  fuentesUmbral: {
    bordeZona: 'Convención del proyecto',
    salud: 'Convención del proyecto',
    consultorio: 'Sin umbral: pendiente de una decisión del proyecto; se muestra solo como dato informativo',
    mercado: 'Sin umbral: pendiente de decisión del usuario; referencia propuesta: ninguna con fuente verificada en metros; se muestra solo como dato informativo',
    supermercado: 'Sin umbral: pendiente de decisión del usuario; referencia propuesta: ninguna con fuente verificada en metros; se muestra solo como dato informativo',
    mall: 'Sin umbral: pendiente de decisión del usuario; referencia propuesta: ninguna con fuente verificada en metros; se muestra solo como dato informativo',
    educacion: 'MINEDU, numeral 7.1, Cuadro N.° 1, distancias referenciales: inicial 500 m (RVM 104-2019-MINEDU), primaria 1500 m y secundaria 3000 m (RVM 208-2019-MINEDU)',
    transporte: 'Convención del proyecto',
    areaVerde: 'Indicador básico de la OMS Europa (2016), «Urban green spaces and health», p. 39: un espacio verde de al menos 0,5 ha a 300 m en línea recta; es un indicador de monitoreo, no una norma peruana',
  },

  // V1b Zonificación proyectada: solo un aviso de texto. Se muestra ÚNICAMENTE si hay fuente y fecha; con null no se
  // dibuja nada. No hay mapa de la zonificación proyectada.
  estadoPDM: {
    texto: 'El nuevo PDM no está aprobado; la zonificación puede cambiar.',
    fuente: 'Diario Correo',
    fecha: '2026-10-24',
    url: 'https://diariocorreo.pe/edicion/arequipa/alcaldesa-de-arequipa-ruccy-oscco-desconoce-la-situacion-del-pdm-noticia/',
  },

  // Módulos fuera de alcance: su código sigue en el proyecto, pero no se muestran. `?modulos=todos` en la URL los
  // vuelve a mostrar (ver Calculos.modulosEfectivos).
  modulos: {
    seguridad: false, // denuncias de robo y hurto, mapa de calor
    desastre: false,  // peligros geológicos y aviso de zona de riesgo
    riesgos: false,   // registro de riesgos y su CSV
    sismica: false,   // zona sísmica de la Norma E.030
  },

  // Asistente de chat (public/js/asistente.js). Busca zonas sobre una cuadrícula de las zonas construibles del plano y agrupa
  // por distrito. `umbralesZona` son convenciones del proyecto (ninguna norma los fija): campiña, zona comercial y centro
  // histórico se miden como la distancia al polígono más cercano de esas zonas del plano.
  asistente: {
    pasoCeldaM: 250,        // lado de las celdas de la búsqueda
    minCeldasArea: 8,       // un distrito con menos celdas no se lista: la cifra sería engañosa
    maxPuntos: 5,           // mejores puntos separados entre sí que calcula la búsqueda
    separacionPuntosM: 600, // distancia mínima entre esos puntos
    radioAreaM: 3000,       // radio de la búsqueda con «cerca de mi punto» cuando no se dice cuánto
    umbralesZona: { campina: 500, comercial: 600, historico: 800 },
  },

  // Equipamiento de OpenStreetMap: archivos congelados con scripts/extraer-equipamiento.mjs (pnpm datos:extraer).
  // Solo si falta un archivo se consulta Overpass en vivo, alrededor del punto y en este radio.
  equipamiento: {
    archivos: {
      salud: 'data/equipamiento/salud.geojson',
      consultorios: 'data/equipamiento/consultorios.geojson', // consultorios médicos: informativos, aparte de la salud
      mercados: 'data/equipamiento/mercados.geojson', // mercados de abastos: informativos (scripts/descargar-comercio.mjs)
      supermercados: 'data/equipamiento/supermercados.geojson', // supermercados: informativos, aparte de los mercados
      malls: 'data/equipamiento/malls.geojson', // malls (centros comerciales): informativos; polígonos donde OSM los tiene
      educacion: 'data/equipamiento/educacion.geojson',
      transporte: 'data/equipamiento/transporte.geojson',
      areasVerdes: 'data/equipamiento/areas_verdes.geojson',
    },
    fuente: 'OpenStreetMap (ODbL)',
    respaldoRadioM: 5000,
  },

  // Líneas de transporte público (recorridos y paradas de SmartBus), congeladas con scripts/descargar-rutas-smartbus.mjs. Se usan con
  // autorización verbal de SmartBus; la confirmación escrita está pendiente. La distancia para decir que una línea «pasa cerca» es
  // la misma de `umbrales.transporte` (convención del proyecto, no una norma).
  rutas: {
    geojsonUrl: 'data/rutas_smartbus.geojson',
    fuente: 'SmartBus (smartbus.app)',
    atribucion: 'Rutas: SmartBus (smartbus.app)',
    permiso: 'autorización verbal de SmartBus; confirmación escrita pendiente',
  },
};
