-- 0003 · Avisos de venta y su historial (fase 3 del plan). Solo campos del inmueble: no hay vendedor, teléfono, correo, fotos ni descripción.

-- Tipo de cambio fechado (tarea 3.4). Nunca se inventa: si no hay cotización para la fecha, el precio en soles queda en null.
CREATE TABLE tipo_cambio (
  fecha   date PRIMARY KEY,
  venta   numeric(8, 4) NOT NULL CHECK (venta > 0),   -- soles por dólar
  fuente  text NOT NULL,
  url     text
);

-- Una corrida del recolector con su reporte (tarea 3.8).
CREATE TABLE corrida_avisos (
  id            bigserial PRIMARY KEY,
  iniciada_en   timestamptz NOT NULL,
  terminada_en  timestamptz,
  fuentes       text[] NOT NULL,
  recibidos     integer NOT NULL DEFAULT 0,
  aceptados     integer NOT NULL DEFAULT 0,
  descartados   integer NOT NULL DEFAULT 0,
  nuevos        integer NOT NULL DEFAULT 0,
  actualizados  integer NOT NULL DEFAULT 0,
  caidos        integer NOT NULL DEFAULT 0,
  sin_coordenadas integer NOT NULL DEFAULT 0,
  sin_distrito  integer NOT NULL DEFAULT 0,
  sin_precio_pen integer NOT NULL DEFAULT 0,
  duplicados_entre_portales integer NOT NULL DEFAULT 0,
  gasto_usd     numeric(10, 4) NOT NULL DEFAULT 0,
  tope_usd      numeric(10, 4),
  reporte       jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE aviso (
  id                  bigserial PRIMARY KEY,
  fuente_id           text NOT NULL REFERENCES fuente (id),
  id_fuente           text NOT NULL,
  url                 text NOT NULL,
  titulo              text,
  tipo_inmueble       text,          -- departamento | casa | terreno | local | oficina | null
  tipo_inferido       boolean NOT NULL DEFAULT false,   -- true si el tipo salió del título (proyectos, tarea 3.3)
  tipo_portal         text,
  es_proyecto         boolean NOT NULL DEFAULT false,
  precio              numeric(14, 2),
  precio_max          numeric(14, 2),
  moneda              text CHECK (moneda IN ('PEN', 'USD')),
  precio_pen          numeric(14, 2),                   -- equivalente en soles (tarea 3.4)
  tipo_cambio         numeric(8, 4),
  tipo_cambio_fecha   date,
  area_total_m2       double precision,
  area_construida_m2  double precision,
  dormitorios         integer,
  dormitorios_max     integer,
  banos               integer,
  estacionamientos    integer,
  distrito            text,
  zona                text,                             -- «Heresi, Cayma» tal como lo publica el portal (tarea 3.3)
  direccion           text,
  punto               geometry(Point, 4326),
  origen_coordenada   text CHECK (origen_coordenada IN ('portal', 'geocodificada')),
  precision_m         integer,                          -- radio de incertidumbre de la coordenada geocodificada
  fecha_publicacion   date,
  primera_vez_visto   timestamptz NOT NULL,             -- ciclo de vida (tarea 3.6)
  ultima_vez_visto    timestamptz NOT NULL,
  estado              text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'caido')),
  caido_en            timestamptz,
  grupo_id            bigint,                           -- mismo inmueble en varios portales (tarea 3.5)
  corrida_id          bigint REFERENCES corrida_avisos (id),
  UNIQUE (fuente_id, id_fuente)
);

CREATE INDEX aviso_punto_geog ON aviso USING gist ((punto::geography));
CREATE INDEX aviso_busqueda   ON aviso (estado, tipo_inmueble, precio_pen);
CREATE INDEX aviso_distrito   ON aviso (distrito);
CREATE INDEX aviso_grupo      ON aviso (grupo_id);

-- Historial de precios: una fila cada vez que el precio cambia.
CREATE TABLE aviso_precio (
  id          bigserial PRIMARY KEY,
  aviso_id    bigint NOT NULL REFERENCES aviso (id) ON DELETE CASCADE,
  visto_en    timestamptz NOT NULL,
  precio      numeric(14, 2) NOT NULL,
  moneda      text NOT NULL,
  precio_pen  numeric(14, 2),
  tipo_cambio numeric(8, 4)
);
CREATE INDEX aviso_precio_aviso ON aviso_precio (aviso_id, visto_en);

-- Ficha de entorno precalculada por aviso (tarea 3.7). `criterios` guarda, por criterio, el valor medido, el dato y su fecha.
CREATE TABLE aviso_entorno (
  aviso_id      bigint PRIMARY KEY REFERENCES aviso (id) ON DELETE CASCADE,
  calculado_en  timestamptz NOT NULL,
  colegio_m     double precision,
  universidad_m double precision,
  mall_m        double precision,
  salud_m       double precision,
  paradero_m    double precision,
  mercado_m     double precision,
  zona_codigo   text,
  agua_pct      double precision,
  luz_pct       double precision,
  desague_pct   double precision,
  en_concesion_electrica boolean,
  peligro_volcanico text,
  cauce_m       double precision,
  criterios     jsonb NOT NULL
);
