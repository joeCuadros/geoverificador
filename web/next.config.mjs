/** Los paquetes del repositorio se publican como TypeScript: Next los compila. PGlite y pg se cargan tal cual en el servidor. */
export default {
  transpilePackages: ['@geoverificador/agente', '@geoverificador/datos', '@geoverificador/dominio'],
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-postgis', 'pg'],
  poweredByHeader: false,
  async rewrites() {
    return { beforeFiles: [{ source: '/login.html', destination: '/acceso' }], afterFiles: [], fallback: [] };
  },
};
