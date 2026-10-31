ALTER TABLE grid_cell
  MODIFY COLUMN geom MULTIPOLYGON NOT NULL SRID 4326;

ALTER TABLE grid_cell_metrics
  MODIFY COLUMN health_distance_m DECIMAL(14,6) NULL,
  MODIFY COLUMN school_initial_distance_m DECIMAL(14,6) NULL,
  MODIFY COLUMN school_primary_distance_m DECIMAL(14,6) NULL,
  MODIFY COLUMN school_secondary_distance_m DECIMAL(14,6) NULL,
  MODIFY COLUMN transit_distance_m DECIMAL(14,6) NULL,
  MODIFY COLUMN green_5000_distance_m DECIMAL(14,6) NULL,
  MODIFY COLUMN green_10000_distance_m DECIMAL(14,6) NULL;

CREATE INDEX ix_grid_metrics_health_distance ON grid_cell_metrics (health_distance_m);
CREATE INDEX ix_grid_metrics_initial_distance ON grid_cell_metrics (school_initial_distance_m);
CREATE INDEX ix_grid_metrics_primary_distance ON grid_cell_metrics (school_primary_distance_m);
CREATE INDEX ix_grid_metrics_secondary_distance ON grid_cell_metrics (school_secondary_distance_m);
CREATE INDEX ix_grid_metrics_transit_distance ON grid_cell_metrics (transit_distance_m);
CREATE INDEX ix_grid_metrics_green_distance ON grid_cell_metrics (green_5000_distance_m);
