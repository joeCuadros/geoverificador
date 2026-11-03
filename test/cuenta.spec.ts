/**
 * Pruebas de la lógica pura de la cuenta opcional (public/js/cuenta.js): cómo se interpreta /api/auth/me, qué mensaje se
 * muestra por cada código de error, qué texto lleva la entrada de la barra y cómo se arma el enlace de inicio con una
 * ruta de regreso segura. Sin DOM ni red real.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Cuenta = require('../public/js/cuenta.js');

const respuesta = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });

describe('Cuenta', () => {
  describe('interpretarMe', () => {
    it('sesión iniciada con nombre', () => {
      expect(Cuenta.interpretarMe(200, { autenticado: true, nombre: 'Ana Pérez' })).toEqual({ tipo: 'sesion', nombre: 'Ana Pérez' });
    });
    it('anónimo: sin sesión o con una forma inesperada', () => {
      expect(Cuenta.interpretarMe(200, { autenticado: false })).toEqual({ tipo: 'anonimo' });
      expect(Cuenta.interpretarMe(200, {})).toEqual({ tipo: 'anonimo' });
      expect(Cuenta.interpretarMe(200, null)).toEqual({ tipo: 'anonimo' });
      expect(Cuenta.interpretarMe(200, { autenticado: true })).toEqual({ tipo: 'anonimo' });
      expect(Cuenta.interpretarMe(200, { autenticado: true, nombre: '   ' })).toEqual({ tipo: 'anonimo' });
      expect(Cuenta.interpretarMe(200, { autenticado: 'true', nombre: 'Ana' })).toEqual({ tipo: 'anonimo' });
    });
    it('recorta nombres larguísimos y quita caracteres de control', () => {
      const r = Cuenta.interpretarMe(200, { autenticado: true, nombre: `Ana\u0000\n${'x'.repeat(300)}` });
      expect(r.tipo).toBe('sesion');
      expect(r.nombre.length).toBeLessThanOrEqual(80);
      // eslint-disable-next-line no-control-regex
      expect(r.nombre).not.toMatch(/[\u0000-\u001f]/);
    });
    it('503 y 404 significan que el inicio de sesión no está disponible aquí', () => {
      expect(Cuenta.interpretarMe(503, { error: 'no_configurado' })).toEqual({ tipo: 'no_configurado' });
      expect(Cuenta.interpretarMe(404, null)).toEqual({ tipo: 'no_configurado' });
    });
    it('otros estados son un error transitorio', () => {
      expect(Cuenta.interpretarMe(500, { error: 'interno' })).toEqual({ tipo: 'error' });
      expect(Cuenta.interpretarMe(502, null)).toEqual({ tipo: 'error' });
    });
  });

  describe('consultarMe', () => {
    it('pide /api/auth/me con las cookies del mismo sitio y sin caché', async () => {
      const fetchFn = jest.fn(async () => respuesta(200, { autenticado: true, nombre: 'Ana' }));
      expect(await Cuenta.consultarMe(fetchFn)).toEqual({ tipo: 'sesion', nombre: 'Ana' });
      expect(fetchFn).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    });
    it('un cuerpo que no es JSON no rompe: se trata según el estado', async () => {
      const rota = { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } };
      expect(await Cuenta.consultarMe(async () => rota)).toEqual({ tipo: 'anonimo' });
      expect(await Cuenta.consultarMe(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('x'); } }))).toEqual({ tipo: 'no_configurado' });
    });
    it('sin red devuelve error en silencio (no lanza)', async () => {
      expect(await Cuenta.consultarMe(async () => { throw new TypeError('Failed to fetch'); })).toEqual({ tipo: 'error' });
    });
    it('sin fetch disponible devuelve error', async () => {
      expect(await Cuenta.consultarMe(undefined)).toEqual({ tipo: 'error' });
    });
  });

  describe('cerrarSesion', () => {
    it('hace POST a /api/auth/logout con las cookies del mismo sitio y devuelve true si responde bien', async () => {
      const fetchFn = jest.fn(async () => respuesta(200, { autenticado: false }));
      expect(await Cuenta.cerrarSesion(fetchFn)).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    });
    it('devuelve false si el servidor rechaza o falla la red', async () => {
      expect(await Cuenta.cerrarSesion(async () => respuesta(403, { error: 'origen_no_permitido' }))).toBe(false);
      expect(await Cuenta.cerrarSesion(async () => { throw new TypeError('x'); })).toBe(false);
      expect(await Cuenta.cerrarSesion(undefined)).toBe(false);
    });
  });

  describe('mensajeDeError', () => {
    it.each(['acceso_denegado', 'estado_invalido', 'sesion_expirada', 'intercambio_fallido', 'token_invalido', 'google_error', 'no_configurado'])(
      '%s tiene un mensaje claro en español', (codigo) => {
        const m = Cuenta.mensajeDeError(codigo);
        expect(typeof m).toBe('string');
        expect(m.length).toBeGreaterThan(20);
      });
    it('el de «no configurado» usa el texto acordado', () => {
      expect(Cuenta.mensajeDeError('no_configurado')).toMatch(/^El inicio de sesión no está configurado todavía/);
    });
    it('un código desconocido o malicioso da un mensaje genérico y nunca se refleja', () => {
      const m = Cuenta.mensajeDeError('<img src=x onerror=alert(1)>');
      expect(m).not.toContain('<');
      expect(m).toBe(Cuenta.mensajeDeError(undefined));
    });
    it('solo «acceso_denegado» y los errores del intercambio permiten reintentar; «no_configurado» no', () => {
      expect(Cuenta.permiteReintentar('acceso_denegado')).toBe(true);
      expect(Cuenta.permiteReintentar('estado_invalido')).toBe(true);
      expect(Cuenta.permiteReintentar('desconocido')).toBe(true);
      expect(Cuenta.permiteReintentar('no_configurado')).toBe(false);
    });
  });

  describe('leerParametros', () => {
    it('extrae error y ruta de regreso de la cadena de consulta', () => {
      expect(Cuenta.leerParametros('?error=acceso_denegado&volver=%2F%3Ftour%3Dno')).toEqual({ error: 'acceso_denegado', volver: '/?tour=no' });
      expect(Cuenta.leerParametros('')).toEqual({ error: null, volver: null });
    });
    it('descarta una ruta de regreso insegura', () => {
      for (const mala of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/api/auth/logout', 'login.html']) {
        expect([mala, Cuenta.leerParametros(`?volver=${encodeURIComponent(mala)}`).volver]).toEqual([mala, null]);
      }
    });
    it('solo acepta códigos de error con forma de código', () => {
      expect(Cuenta.leerParametros('?error=%3Cscript%3E').error).toBeNull();
      expect(Cuenta.leerParametros(`?error=${'a'.repeat(100)}`).error).toBeNull();
    });
  });

  describe('hrefInicio', () => {
    it('sin ruta de regreso apunta al inicio del flujo', () => {
      expect(Cuenta.hrefInicio(null)).toBe('/api/auth/google');
    });
    it('con ruta segura la codifica; con una insegura la ignora', () => {
      expect(Cuenta.hrefInicio('/?tour=no')).toBe('/api/auth/google?volver=%2F%3Ftour%3Dno');
      expect(Cuenta.hrefInicio('//evil.example')).toBe('/api/auth/google');
    });
  });

  describe('entradaDeBarra', () => {
    it('anónimo: «Iniciar sesión», visible', () => {
      expect(Cuenta.entradaDeBarra({ tipo: 'anonimo' })).toEqual({ visible: true, texto: 'Iniciar sesión' });
    });
    it('con sesión: «Hola, X»', () => {
      expect(Cuenta.entradaDeBarra({ tipo: 'sesion', nombre: 'Ana Pérez' })).toEqual({ visible: true, texto: 'Hola, Ana Pérez' });
    });
    it('no configurado o con error: la entrada se oculta y la app sigue igual', () => {
      expect(Cuenta.entradaDeBarra({ tipo: 'no_configurado' })).toEqual({ visible: false, texto: '' });
      expect(Cuenta.entradaDeBarra({ tipo: 'error' })).toEqual({ visible: false, texto: '' });
      expect(Cuenta.entradaDeBarra(null)).toEqual({ visible: false, texto: '' });
    });
  });
});
