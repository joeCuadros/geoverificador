/** Los paquetes del repositorio se publican como TypeScript: Next los compila. PGlite y pg se cargan tal cual en el servidor. */
export default {
  // NEXT_DIST_DIR separa la compilación de las pruebas de extremo a extremo de la del servidor de desarrollo (no pisa su carpeta .next).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@geoverificador/agente', '@geoverificador/datos', '@geoverificador/dominio'],
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-postgis', 'pg'],
  poweredByHeader: false,
};
