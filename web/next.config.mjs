/** Los paquetes del repositorio se publican como TypeScript: Next los compila. PGlite y pg se cargan tal cual en el servidor. */
export default {
  transpilePackages: ['@geoverificador/agente', '@geoverificador/datos', '@geoverificador/dominio'],
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-postgis', 'pg'],
  poweredByHeader: false,
  // La aplicación de mapa de siempre (public/index.html) sigue siendo la portada; el agente vive en /agente.
  async rewrites() {
    return { beforeFiles: [{ source: '/', destination: '/index.html' }], afterFiles: [], fallback: [] };
  },
};
