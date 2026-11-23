/**
 * catalogo.ts — Qué es cada archivo de apps/estatica/public/data: a qué tabla va, con qué categoría y de qué fuente sale.
 *
 * La licencia y la fecha de cada fuente se leen de los metadatos del propio archivo al cargarlo; aquí solo va lo que el archivo no dice.
 * `licenciaVerificada` es true únicamente donde el archivo declara una licencia abierta conocida (ODbL, ODC-By, CC BY). El resto queda en false
 * hasta que una persona la confirme o consiga autorización por escrito (tarea 4.5): ver docs/LICENCIAS.md.
 * `limite` es la frase que el agente cita cuando usa el dato (fase 4: «cada criterio tiene su límite escrito en una frase»).
 */

export type Tabla = 'distrito' | 'lugar' | 'zona' | 'manzana_censo' | 'ruta_y_paradero' | 'peligro' | 'concesion' | 'documento';

export interface DefFuente {
  id: string;
  nombre: string;
  url?: string;
  licencia?: string;
  licenciaVerificada?: boolean;
  atribucion?: string;
  permitePublicar?: boolean;
  limite?: string;
}

export interface DefArchivo {
  /** Expresión que reconoce la ruta relativa a apps/estatica/public/data (con «/»). */
  patron: RegExp;
  tabla: Tabla;
  fuente: string;
  /** Categoría del lugar, o clase del peligro o de la concesión. */
  clase?: string;
}

export const FUENTES: DefFuente[] = [
  { id: 'osm', nombre: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', licencia: 'ODbL', licenciaVerificada: true, atribucion: '© colaboradores de OpenStreetMap', limite: 'OpenStreetMap es colaborativo: puede faltar un lugar que existe o figurar uno que ya cerró.' },
  { id: 'escale', nombre: 'Padrón de instituciones educativas de ESCALE (MINEDU), con OpenStreetMap como respaldo', url: 'https://escale.minedu.gob.pe/', limite: 'La distancia al colegio es en línea recta; no dice si hay vacantes ni la calidad del colegio.' },
  { id: 'renipress', nombre: 'RENIPRESS (SUSALUD), con OpenStreetMap como respaldo', url: 'http://datos.susalud.gob.pe/', limite: 'La distancia al establecimiento de salud es en línea recta; no dice el horario ni las especialidades que atiende.' },
  { id: 'sunedu_osm', nombre: 'Universidades e institutos: OpenStreetMap, contrastado con la lista de universidades licenciadas de SUNEDU', url: 'https://www.sunedu.gob.pe/lista-de-universidades-licenciadas/', licencia: 'ODbL (geometrías de OpenStreetMap)', licenciaVerificada: true, atribucion: '© colaboradores de OpenStreetMap', limite: 'Las sedes salen de OpenStreetMap: una sede o filial que nadie ha mapeado no aparece.' },
  { id: 'inei_censo_2017', nombre: 'INEI, Censos Nacionales 2017 (REDATAM), por manzana', url: 'https://censos2017.inei.gob.pe/redatam/', atribucion: 'Instituto Nacional de Estadística e Informática (INEI), Censos Nacionales 2017', limite: 'Agua, luz y desagüe son la cobertura de la manzana en el censo de 2017, no del predio ni de hoy; solo 11 250 de 31 277 manzanas tienen cifras.' },
  { id: 'minem_dge', nombre: 'MINEM (Dirección General de Electricidad), Concesiones de Distribución Eléctrica', url: 'https://www.datosabiertos.gob.pe/dataset/concesiones-de-distribuci%C3%B3n-el%C3%A9ctrica', licencia: 'Open Data Commons Attribution License (ODC-By)', licenciaVerificada: true, limite: 'Estar dentro de un área de concesión eléctrica no es tener una conexión: son 5 polígonos de concesión, no la red de SEAL.' },
  { id: 'ingemmet_catastro', nombre: 'INGEMMET, Catastro Minero (GEOCATMIN)', url: 'https://geocatmin.ingemmet.gob.pe/geocatmin/', limite: 'Una concesión minera es un derecho sobre los minerales, no minería en el predio; el catastro es referencial y cambia a diario.' },
  { id: 'ingemmet_peligros', nombre: 'INGEMMET, Inventario de peligros geológicos (GEOCATMIN)', url: 'https://geocatmin.ingemmet.gob.pe/geocatmin/', limite: 'El inventario registra eventos entre 2003 y 2023 donde hubo trabajo de campo: que no haya un registro no significa que no haya peligro.' },
  { id: 'ingemmet_limites', nombre: 'Límites distritales, GEOCATMIN (INGEMMET) con límites del INEI', url: 'https://geocatmin.ingemmet.gob.pe/geocatmin/', limite: 'Los límites distritales son referenciales.' },
  { id: 'igp_volcan', nombre: 'IGP (CENVUL), zonas de peligro volcánico del Misti', url: 'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocenvul/Vulcanologia/MapServer', limite: 'El mapa de peligro volcánico no trae fecha de elaboración en el servicio del IGP.' },
  { id: 'igp_sismos', nombre: 'IGP, sismos reportados', url: 'https://www.igp.gob.pe/', limite: 'Son los sismos reportados en el periodo descargado, no el peligro sísmico del terreno.' },
  { id: 'cauces', nombre: 'Cauces y quebradas: ANA, IGP y OpenStreetMap', limite: 'Es la distancia a la línea del cauce en el mapa, no al cauce real ni a su faja marginal.' },
  { id: 'mininter_delitos', nombre: 'Mapa del Delito Georreferenciado (MININTER), SIDPOL de la PNP', limite: 'Solo el 49 % de las denuncias tiene coordenada real y muchas se concentran en puntos de referencia.' },
  { id: 'sedapar_acopio', nombre: 'SEDAPAR, Directorio de Puntos de Acopio de Agua Potable', url: 'https://www.gob.pe/institucion/sedapar/informes-publicaciones/5198948-directorio-de-puntos-de-acopio-de-agua-potable-arequipa', limite: 'El directorio se publicó en 2024 con fichas de 2017.' },
  { id: 'sunass', nombre: 'SUNASS, registro de interrupciones del servicio de agua', url: 'https://www.datosabiertos.gob.pe/', licencia: 'Open Data Commons Attribution License (ODC-By)', licenciaVerificada: true, limite: 'Las interrupciones son por distrito y llegan hasta abril de 2024.' },
  { id: 'cenepred', nombre: 'CENEPRED (SIGRID), escenario de riesgo ante El Niño', url: 'https://sigrid.cenepred.gob.pe/sigridv3/', limite: 'Es una estimación por distrito para un escenario de lluvias, no una predicción ni un dato del predio.' },
  { id: 'aptologia', nombre: 'Aptología, precio por m² por distrito', url: 'https://www.aptologia.com/datos-abiertos', licencia: 'CC BY 4.0', licenciaVerificada: true, atribucion: 'Datos: Aptologia', limite: 'El precio por m² es un promedio de avisos por distrito y hoy cubre 3 de 25 distritos.' },
  { id: 'mpa_sit', nombre: 'Municipalidad Provincial de Arequipa, registro del Sistema Integrado de Transporte', url: 'https://www.muniarequipa.gob.pe/sistema_transporte/', limite: 'El registro es de las bases de licitación de 2017.' },
  { id: 'pdm_2016_2025', nombre: 'Plano de zonificación del Plan de Desarrollo Metropolitano de Arequipa 2016-2025', limite: 'La vigencia del plan 2016-2025 está cumplida: la zona es referencial y debe confirmarse con un Certificado de Zonificación y Vías.' },
  { id: 'e030', nombre: 'Norma Técnica E.030 Diseño Sismorresistente', url: 'https://cdn.www.gob.pe/uploads/document/file/9902957/8081915-nt-e-030-diseno-sismorresistente-2026.pdf', limite: 'La zona sísmica de la norma es por distrito.' },
  // Portales de avisos (ADR 0002): no se publican hasta que haya respaldo legal.
  { id: 'nexo', nombre: 'Nexo Inmobiliario', url: 'https://nexoinmobiliario.pe/', permitePublicar: false, limite: 'El aviso es de un tercero: precio y datos pueden haber cambiado desde la fecha en que se vio.' },
  { id: 'urbania', nombre: 'Urbania', url: 'https://urbania.pe/', permitePublicar: false, limite: 'El aviso es de un tercero: precio y datos pueden haber cambiado desde la fecha en que se vio.' },
  { id: 'adondevivir', nombre: 'Adondevivir', url: 'https://www.adondevivir.com/', permitePublicar: false, limite: 'El aviso es de un tercero: precio y datos pueden haber cambiado desde la fecha en que se vio.' },
  { id: 'marketplace', nombre: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace/', permitePublicar: false, limite: 'Fuera de la primera versión (ADR 0004).' },
];

export const ARCHIVOS: DefArchivo[] = [
  { patron: /^distritos_aqp\.geojson$/, tabla: 'distrito', fuente: 'ingemmet_limites' },
  { patron: /^zonas_aqp\.geojson$/, tabla: 'zona', fuente: 'pdm_2016_2025' },
  { patron: /^reglas_zonas\.json$/, tabla: 'documento', fuente: 'pdm_2016_2025' },
  { patron: /^censo\/index\.json$/, tabla: 'documento', fuente: 'inei_censo_2017' },
  { patron: /^censo\/manzanas\/\d{6}\.json$/, tabla: 'manzana_censo', fuente: 'inei_censo_2017' },
  { patron: /^rutas_osm\.geojson$/, tabla: 'ruta_y_paradero', fuente: 'osm' },
  { patron: /^sit_registro_oficial\.json$/, tabla: 'documento', fuente: 'mpa_sit' },
  { patron: /^peligros_aqp\.geojson$/, tabla: 'peligro', fuente: 'ingemmet_peligros', clase: 'geologico' },
  { patron: /^quebradas_aqp\.geojson$/, tabla: 'peligro', fuente: 'cauces', clase: 'cauce' },
  { patron: /^peligro_volcanico_misti\.geojson$/, tabla: 'peligro', fuente: 'igp_volcan', clase: 'volcanico' },
  { patron: /^sismos_igp\.geojson$/, tabla: 'peligro', fuente: 'igp_sismos', clase: 'sismo' },
  { patron: /^delitos_aqp\.geojson$/, tabla: 'peligro', fuente: 'mininter_delitos', clase: 'denuncia' },
  { patron: /^zonas_sismicas_e030\.json$/, tabla: 'documento', fuente: 'e030' },
  { patron: /^riesgo_cenepred_fen2027\.json$/, tabla: 'documento', fuente: 'cenepred' },
  { patron: /^precios_m2_distrito\.json$/, tabla: 'documento', fuente: 'aptologia' },
  { patron: /^agua\/interrupciones_sedapar\.json$/, tabla: 'documento', fuente: 'sunass' },
  { patron: /^agua\/puntos_acopio\.geojson$/, tabla: 'lugar', fuente: 'sedapar_acopio', clase: 'acopio' },
  { patron: /^electricidad\/concesiones_distribucion\.geojson$/, tabla: 'concesion', fuente: 'minem_dge', clase: 'electrica' },
  { patron: /^mineria\/concesiones_mineras\.geojson$/, tabla: 'concesion', fuente: 'ingemmet_catastro', clase: 'minera' },
  { patron: /^equipamiento\/salud\.geojson$/, tabla: 'lugar', fuente: 'renipress', clase: 'salud' },
  { patron: /^equipamiento\/consultorios\.geojson$/, tabla: 'lugar', fuente: 'renipress', clase: 'consultorios' },
  { patron: /^equipamiento\/educacion\.geojson$/, tabla: 'lugar', fuente: 'escale', clase: 'educacion' },
  { patron: /^equipamiento\/educacion_superior\.geojson$/, tabla: 'lugar', fuente: 'sunedu_osm', clase: 'educacion_superior' },
  { patron: /^equipamiento\/transporte\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'transporte' },
  { patron: /^equipamiento\/areas_verdes\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'areasVerdes' },
  { patron: /^equipamiento\/malls\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'malls' },
  { patron: /^equipamiento\/mercados\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'mercados' },
  { patron: /^equipamiento\/supermercados\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'supermercados' },
  { patron: /^equipamiento\/finanzas\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'finanzas' },
  { patron: /^equipamiento\/comida_fuera\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'comida_fuera' },
  { patron: /^equipamiento\/recreacion\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'recreacion' },
  { patron: /^equipamiento\/osm\/salud\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'salud_osm' },
  { patron: /^equipamiento\/osm\/educacion\.geojson$/, tabla: 'lugar', fuente: 'osm', clase: 'educacion_osm' },
];

export function definicionDe(ruta: string): DefArchivo | null {
  return ARCHIVOS.find((a) => a.patron.test(ruta)) ?? null;
}
