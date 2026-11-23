-- 0001 · Esquema base (tarea 2.2 del plan).
-- Todas las geometrías van en WGS84 (EPSG:4326), como los archivos de apps/estatica/public/data. Las distancias se piden con ::geography (metros).
CREATE EXTENSION IF NOT EXISTS postgis;

-- De dónde sale cada dato: fuente, licencia, fecha y URL. `limite` es la frase que el agente cita al usar el dato.
CREATE TABLE fuente (
  id                  text PRIMARY KEY,
  nombre              text NOT NULL,
  licencia            text,
  licencia_verificada boolean NOT NULL DEFAULT false,
  url                 text,
  fecha               date,
  atribucion          text,
  permite_publicar    boolean NOT NULL DEFAULT true,
  limite              text,
  metadatos           jsonb NOT NULL DEFAULT '{}'
);

-- Un registro por archivo de apps/estatica/public/data cargado. Con esto `datos:verificar --base` compara la base contra los archivos (tarea 2.5).
CREATE TABLE archivo_dato (
  ruta       text PRIMARY KEY,
  fuente_id  text NOT NULL REFERENCES fuente (id),
  tabla      text NOT NULL,
  sha256     text NOT NULL,
  bytes      integer NOT NULL,
  registros  integer NOT NULL,
  metadatos  jsonb NOT NULL DEFAULT '{}',
  cargado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE distrito (
  id      bigserial PRIMARY KEY,
  archivo text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden   integer NOT NULL,
  ubigeo  text NOT NULL UNIQUE,
  nombre  text NOT NULL,
  props   jsonb NOT NULL,
  geom    geometry(Geometry, 4326) NOT NULL
);

-- Equipamiento y comercio: colegios, salud, paraderos, parques, malls, mercados, universidades, puntos de acopio…
-- `punto` es el punto del elemento (o un punto dentro de su polígono); `forma` es su geometría original cuando no es un punto.
-- `grupos` son los subgrupos por los que se busca «el más cercano de cada uno»: niveles de un colegio, tipo de comercio.
CREATE TABLE lugar (
  id        bigserial PRIMARY KEY,
  archivo   text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden     integer NOT NULL,
  categoria text NOT NULL,
  nombre    text,
  nombre_norm text,               -- nombre en minúsculas y sin tildes, para buscar por nombre («unsa», «mall aventura»)
  grupos    text[] NOT NULL DEFAULT '{}',
  props     jsonb NOT NULL,
  punto     geometry(Point, 4326) NOT NULL,
  forma     geometry(Geometry, 4326),
  area_m2   double precision
);

CREATE TABLE zona (
  id      bigserial PRIMARY KEY,
  archivo text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden   integer NOT NULL,
  codigo  text NOT NULL,
  props   jsonb NOT NULL,
  geom    geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE manzana_censo (
  id        bigserial PRIMARY KEY,
  archivo   text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden     integer NOT NULL,
  ubigeo    text NOT NULL,
  codigo    text NOT NULL,
  con_datos boolean NOT NULL,
  props     jsonb NOT NULL,
  geom      geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE ruta (
  id      bigserial PRIMARY KEY,
  archivo text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden   integer NOT NULL,
  linea   text,
  ramal   text,
  nombre  text,
  props   jsonb NOT NULL,
  geom    geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE paradero (
  id      bigserial PRIMARY KEY,
  archivo text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden   integer NOT NULL,
  nombre  text,
  props   jsonb NOT NULL,
  punto   geometry(Point, 4326) NOT NULL
);

-- clase: geologico (INGEMMET) | cauce (ANA, IGP, OSM) | volcanico (IGP) | sismo (IGP) | denuncia (MININTER)
CREATE TABLE peligro (
  id      bigserial PRIMARY KEY,
  archivo text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden   integer NOT NULL,
  clase   text NOT NULL,
  tipo    text,
  nivel   text,
  nombre  text,
  props   jsonb NOT NULL,
  geom    geometry(Geometry, 4326) NOT NULL
);

-- clase: electrica (MINEM) | minera (INGEMMET)
CREATE TABLE concesion (
  id      bigserial PRIMARY KEY,
  archivo text NOT NULL REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  orden   integer NOT NULL,
  clase   text NOT NULL,
  nombre  text,
  props   jsonb NOT NULL,
  geom    geometry(Geometry, 4326) NOT NULL
);

-- Archivos JSON sin geometría (reglas de zonas, precios por distrito, zonas sísmicas, CENEPRED, registro del SIT, interrupciones, índice del censo).
CREATE TABLE documento (
  archivo   text PRIMARY KEY REFERENCES archivo_dato (ruta) ON DELETE CASCADE,
  contenido jsonb NOT NULL
);
