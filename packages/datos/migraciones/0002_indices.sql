-- 0002 · Índices espaciales (tarea 2.4). Los índices sobre ::geography sirven a ST_DWithin y al operador <-> en metros.
CREATE INDEX lugar_punto_geog   ON lugar USING gist ((punto::geography));
CREATE INDEX lugar_forma_gist   ON lugar USING gist (forma);
CREATE INDEX lugar_categoria    ON lugar (categoria);
CREATE INDEX lugar_archivo      ON lugar (archivo);
CREATE INDEX lugar_grupos       ON lugar USING gin (grupos);
CREATE INDEX lugar_nombre_norm  ON lugar (nombre_norm);

CREATE INDEX distrito_geom      ON distrito USING gist (geom);
CREATE INDEX zona_geom          ON zona USING gist (geom);
CREATE INDEX zona_codigo        ON zona (codigo);
CREATE INDEX manzana_geom       ON manzana_censo USING gist (geom);
CREATE INDEX manzana_archivo    ON manzana_censo (archivo);
CREATE INDEX ruta_geom          ON ruta USING gist (geom);
CREATE INDEX paradero_punto     ON paradero USING gist ((punto::geography));
CREATE INDEX peligro_geom       ON peligro USING gist (geom);
CREATE INDEX peligro_clase      ON peligro (clase);
CREATE INDEX concesion_geom     ON concesion USING gist (geom);
CREATE INDEX concesion_clase    ON concesion (clase);
