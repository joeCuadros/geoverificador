export function loadMysqlConfig(options?: {
  withDatabase?: boolean;
}): import('mysql2/promise').PoolOptions;
