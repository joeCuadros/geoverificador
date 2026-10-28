/**
 * config.js — Configuración única de la aplicación.
 *
 * Alcance: 5 variables (zonificación vigente, zonificación proyectada, salud, educación, transporte y área verde).
 * Los umbrales, el estado del PDM y los módulos visibles están en este archivo; las etiquetas de OpenStreetMap que
 * entran en cada variable están en Calculos.FILTROS (calculos.js), que sirve a la vez para extraer los datos
 * (scripts/extraer-equipamiento.mjs), clasificarlos y documentarlos en pantalla.
 */
const CONFIG = {
  center: [-16.409, -71.5375], // Plaza de Armas de Arequipa (aprox.)
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

  // Distritos (límites del INEI vía GEOCATMIN) y zona sísmica de la Norma E.030: archivos locales.
  distritos: {
    geojsonUrl: 'data/distritos_aqp.geojson', // generado con scripts/descargar-distritos.mjs
    e030Url: 'data/zonas_sismicas_e030.json', // Anexo II y Tabla N.° 1 de la E.030 2026, transcritos
    fuente: 'Norma E.030 Diseño Sismorresistente 2026 (MVCS), Anexo II; límites distritales del INEI vía GEOCATMIN',
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
    salud: 1000, // V2 (convención del proyecto)
    educacion: { inicial: 500, primaria: 1500, secundaria: 3000 }, // V3
    transporte: 400, // V4 (convención del proyecto)
    areaVerde: { distanciaM: 300, areaMinM2: 5000, areaGrandeM2: 10000 }, // V5: ≥ 0,5 ha a ≤ 300 m; sensibilidad: ≥ 1 ha
  },
  fuentesUmbral: {
    bordeZona: 'Convención del proyecto',
    salud: 'Convención del proyecto',
    educacion: 'MEF/MINEDU, Instructivo FTE, Cuadro N.° 1 (RVM 104-2019-MINEDU y 208-2019-MINEDU)',
    transporte: 'Convención del proyecto',
    areaVerde: 'Indicador básico de la OMS Europa (2016): un espacio verde de al menos 0,5 ha a 300 m en línea recta',
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

  // Equipamiento de OpenStreetMap: archivos congelados con scripts/extraer-equipamiento.mjs (pnpm datos:extraer).
  // Solo si falta un archivo se consulta Overpass en vivo, alrededor del punto y en este radio.
  equipamiento: {
    archivos: {
      salud: 'data/equipamiento/salud.geojson',
      educacion: 'data/equipamiento/educacion.geojson',
      transporte: 'data/equipamiento/transporte.geojson',
      areasVerdes: 'data/equipamiento/areas_verdes.geojson',
    },
    fuente: 'OpenStreetMap (ODbL)',
    respaldoRadioM: 5000,
  },
};
