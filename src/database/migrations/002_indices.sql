CREATE SPATIAL INDEX spx_zone_feature_geom ON zone_feature (geom);
CREATE INDEX ix_zone_feature_code ON zone_feature (zone_code);

CREATE SPATIAL INDEX spx_equipment_point_geom ON equipment_point (geom);
CREATE INDEX ix_equipment_category_level ON equipment_point (category, education_level);

CREATE SPATIAL INDEX spx_green_area_geom ON green_area (geom);

CREATE SPATIAL INDEX spx_district_geom ON district (geom);
CREATE INDEX ix_district_name ON district (name);

CREATE SPATIAL INDEX spx_geologic_hazard_geom ON geologic_hazard (geom);
CREATE INDEX ix_geologic_hazard_year ON geologic_hazard (event_year);

CREATE SPATIAL INDEX spx_grid_cell_geom ON grid_cell (geom);
CREATE SPATIAL INDEX spx_grid_cell_center ON grid_cell (center);
CREATE INDEX ix_grid_metrics_buildability ON grid_cell_metrics (buildability, zone_code);
