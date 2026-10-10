/**
 * config.js — Configuración única de la prueba técnica.
 *
 * Las etiquetas de OpenStreetMap de CATEGORIES se usan para DOS cosas:
 *   1) construir la consulta Overpass (services.js)
 *   2) clasificar los resultados devueltos (app.js)
 * Así lo que se consulta y lo que se documenta en pantalla nunca se desincroniza.
 * Para agregar un tipo (p. ej. supermercados) basta con añadir una línea a `values`.
 */
const CONFIG = {
  center: [-16.409, -71.5375], // Plaza de Armas de Arequipa (aprox.)
  zoom: 14,

  radii: [500, 1000, 1500],
  defaultRadius: 1000,

  overpassEndpoints: [
    { label: 'overpass-api.de (principal)', url: 'https://overpass-api.de/api/interpreter' },
    { label: 'overpass.kumi.systems (alternativo)', url: 'https://overpass.kumi.systems/api/interpreter' },
  ],
  overpassTimeoutSec: 25,     // timeout del servidor dentro de la consulta
  clientTimeoutMs: 35000,     // timeout del navegador
  analyzeCooldownMs: 3000,    // mínimo entre consultas reales a Overpass
  cacheTtlMs: 2 * 60 * 1000,  // misma consulta (punto+radio+endpoint) no se repite durante 2 min

  nominatimUrl: 'https://nominatim.openstreetmap.org/search',
  nominatimMinIntervalMs: 1100, // política de Nominatim: máximo 1 solicitud por segundo
  nominatimEmail: '',           // opcional: tu correo, recomendado por Nominatim para identificar la app
  // Caja aproximada de Arequipa metropolitana: oeste, norte, este, sur
  viewbox: '-71.75,-16.20,-71.35,-16.60',
};

const CATEGORIES = [
  {
    id: 'servicios',
    label: 'Servicios',
    color: '#c2410c',
    icon: '🏥',
    filters: [
      {
        key: 'amenity',
        values: {
          hospital: 'Hospital',
          clinic: 'Clínica / centro de salud',
          doctors: 'Consultorio médico',
          school: 'Colegio',
          kindergarten: 'Inicial / jardín',
          marketplace: 'Mercado',
        },
      },
      {
        key: 'healthcare',
        values: {
          hospital: 'Hospital',
          centre: 'Centro de salud',
          clinic: 'Clínica / centro de salud',
        },
      },
    ],
  },
  {
    id: 'transporte',
    label: 'Transporte',
    color: '#1d4ed8',
    icon: '🚌',
    filters: [
      { key: 'highway', values: { bus_stop: 'Paradero de bus' } },
      {
        key: 'public_transport',
        values: { platform: 'Plataforma de transporte público', station: 'Estación de transporte público' },
      },
      { key: 'amenity', values: { bus_station: 'Terminal de buses', taxi: 'Parada de taxi' } },
      { key: 'railway', values: { station: 'Estación de tren', halt: 'Apeadero de tren', tram_stop: 'Parada de tranvía' } },
    ],
  },
  {
    id: 'verdes',
    label: 'Áreas verdes',
    color: '#15803d',
    icon: '🌳',
    filters: [
      {
        key: 'leisure',
        values: {
          park: 'Parque',
          garden: 'Jardín',
          playground: 'Juegos infantiles',
          pitch: 'Cancha deportiva',
          sports_centre: 'Centro deportivo',
        },
      },
      { key: 'landuse', values: { recreation_ground: 'Área recreativa' } },
    ],
  },
];
