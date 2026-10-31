CREATE TABLE IF NOT EXISTS zone_rule (
  zone_code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  group_name VARCHAR(64) NOT NULL,
  buildability ENUM('si', 'condicionado', 'no') NOT NULL,
  floors_base SMALLINT UNSIGNED NULL,
  floors_max SMALLINT UNSIGNED NULL,
  coefficient_base DECIMAL(8,3) NULL,
  coefficient_max DECIMAL(8,3) NULL,
  open_space_pct VARCHAR(32) NULL,
  min_lot_m2 DECIMAL(12,2) NULL,
  min_front_m DECIMAL(8,2) NULL,
  note TEXT NULL,
  PRIMARY KEY (zone_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS zone_feature (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  feature_number INT UNSIGNED NOT NULL,
  zone_code VARCHAR(32) NOT NULL,
  color CHAR(7) NOT NULL,
  geom MULTIPOLYGON NOT NULL SRID 4326,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zone_feature_number (feature_number),
  CONSTRAINT fk_zone_feature_rule
    FOREIGN KEY (zone_code) REFERENCES zone_rule (zone_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS equipment_point (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id VARCHAR(64) NOT NULL,
  category ENUM('health', 'education', 'transport') NOT NULL,
  class_tag VARCHAR(64) NOT NULL,
  education_level ENUM('initial', 'primary', 'secondary') NULL,
  level_key VARCHAR(16) GENERATED ALWAYS AS (COALESCE(education_level, 'none')) STORED,
  name VARCHAR(512) NULL,
  tags JSON NOT NULL,
  geom POINT NOT NULL SRID 4326,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipment_source_category_level (source_id, category, level_key),
  CONSTRAINT chk_equipment_education_level
    CHECK (category = 'education' OR education_level IS NULL),
  CONSTRAINT chk_equipment_education_level_required
    CHECK (category <> 'education' OR education_level IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS green_area (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id VARCHAR(64) NOT NULL,
  name VARCHAR(512) NULL,
  area_m2 DECIMAL(16,2) NOT NULL,
  geom MULTIPOLYGON NOT NULL SRID 4326,
  PRIMARY KEY (id),
  UNIQUE KEY uq_green_area_source (source_id),
  CONSTRAINT chk_green_area_nonnegative CHECK (area_m2 >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS district (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ubigeo VARCHAR(6) NOT NULL,
  name VARCHAR(128) NOT NULL,
  province VARCHAR(128) NOT NULL,
  department VARCHAR(128) NOT NULL,
  boundary_source VARCHAR(255) NULL,
  boundary_date VARCHAR(32) NULL,
  geom MULTIPOLYGON NOT NULL SRID 4326,
  PRIMARY KEY (id),
  UNIQUE KEY uq_district_ubigeo (ubigeo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS geologic_hazard (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id VARCHAR(64) NOT NULL,
  kind VARCHAR(255) NULL,
  subtype VARCHAR(255) NULL,
  district_name VARCHAR(128) NULL,
  sector VARCHAR(255) NULL,
  event_year SMALLINT UNSIGNED NULL,
  source_name VARCHAR(255) NULL,
  geom POINT NOT NULL SRID 4326,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hazard_source (source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS grid_cell (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cell_key VARCHAR(64) NOT NULL,
  geom POLYGON NOT NULL SRID 4326,
  center POINT NOT NULL SRID 4326,
  area_m2 DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grid_cell_key (cell_key),
  CONSTRAINT chk_grid_cell_area CHECK (area_m2 > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS grid_cell_metrics (
  cell_id BIGINT UNSIGNED NOT NULL,
  health_distance_m DECIMAL(12,2) NULL,
  school_initial_distance_m DECIMAL(12,2) NULL,
  school_primary_distance_m DECIMAL(12,2) NULL,
  school_secondary_distance_m DECIMAL(12,2) NULL,
  transit_distance_m DECIMAL(12,2) NULL,
  green_5000_distance_m DECIMAL(12,2) NULL,
  green_10000_distance_m DECIMAL(12,2) NULL,
  zone_code VARCHAR(32) NULL,
  buildability ENUM('si', 'condicionado', 'no') NULL,
  hazard_count_500m INT UNSIGNED NULL,
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cell_id),
  CONSTRAINT fk_grid_metrics_cell
    FOREIGN KEY (cell_id) REFERENCES grid_cell (id) ON DELETE CASCADE,
  CONSTRAINT fk_grid_metrics_zone
    FOREIGN KEY (zone_code) REFERENCES zone_rule (zone_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
