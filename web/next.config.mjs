/** Los paquetes del repositorio se publican como TypeScript: Next los compila. PGlite y pg se cargan tal cual en el servidor. */
export default {
  transpilePackages: ['@geoverificador/agente', '@geoverificador/datos', '@geoverificador/dominio'],
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-postgis', 'pg'],
  poweredByHeader: false,
  // La aplicación anterior (public/index.html) queda en /clasico mientras se verifica la paridad.
  async rewrites() {
    return { beforeFiles: [{ source: '/clasico', destination: '/index.html' }], afterFiles: [], fallback: [] };
  },
};
