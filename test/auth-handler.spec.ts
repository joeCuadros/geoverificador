/**
 * Pruebas del servidor de /api/auth/* (api/_lib/auth.js) con un `fetch` falso: no hay red, ni Google, ni secretos reales.
 * Comprueban el inicio del flujo (state, PKCE, cookie firmada), el callback (state, intercambio del código, reclamos del
 * ID token), la cookie de sesión (firma, vencimiento, manipulación), /me, el cierre de sesión (CSRF) y la falta de
 * configuración. No prueban un inicio de sesión real con Google.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { createHash, createHmac } from 'node:crypto';

const { manejarAuth, atenderNode, firmar, verificar, rutaSegura, leerConfig, nombresCookie } = require('../api/_lib/auth.js');

const CLIENTE = 'cliente-123.apps.googleusercontent.com';
const SECRETO_GOOGLE = 'secreto-de-google-falso';
const SECRETO = 's'.repeat(40);
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const SEG = 1000;
const SIETE_DIAS_S = 7 * 24 * 60 * 60;

const envLocal = { GOOGLE_CLIENT_ID: CLIENTE, GOOGLE_CLIENT_SECRET: SECRETO_GOOGLE, AUTH_SESSION_SECRET: SECRETO, AUTH_BASE_URL: 'http://localhost:3000' };
const envHttps = { ...envLocal, AUTH_BASE_URL: 'https://geoverificador-nine.vercel.app' };

const ahora = (desplazamientoMs = 0) => () => T0 + desplazamientoMs;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (reclamos: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(reclamos)}.firma-no-verificada`;
const reclamosOk = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENTE, sub: '109876543210', name: 'Ana Pérez', nonce,
  iat: T0 / SEG, exp: T0 / SEG + 3600, ...extra,
});
const respuestaToken = (token: string) => ({ ok: true, status: 200, json: async () => ({ id_token: token, access_token: 'no-se-usa' }) });

const valorCookie = (cookies: string[] | undefined, nombre: string): string | undefined => {
  const c = (cookies ?? []).find((x) => x.startsWith(`${nombre}=`));
  return c ? c.slice(nombre.length + 1).split(';')[0] : undefined;
};
const cookieCompleta = (cookies: string[], nombre: string) => cookies.find((x) => x.startsWith(`${nombre}=`)) ?? '';

async function iniciar(env: Record<string, string> = envLocal, consulta: Record<string, string> = {}, desplazamientoMs = 0) {
  const r = await manejarAuth({ accion: 'google', metodo: 'GET', consulta, cabeceras: {} }, { env, ahora: ahora(desplazamientoMs) });
  const url = new URL(r.ubicacion);
  const nombres = nombresCookie(env.AUTH_BASE_URL.startsWith('https:'));
  return {
    r, url, nombres,
    flujo: valorCookie(r.cookies, nombres.flujo) as string,
    state: url.searchParams.get('state') as string,
    nonce: url.searchParams.get('nonce') as string,
  };
}

const reqCallback = (consulta: Record<string, string>, flujo?: string, nombreCookie = 'gv_flujo') => ({
  accion: 'callback', metodo: 'GET', consulta, cabeceras: flujo ? { cookie: `otra=1; ${nombreCookie}=${flujo}` } : {},
});

describe('auth (api/_lib/auth.js)', () => {
  let errores: jest.SpyInstance;
  let avisos: jest.SpyInstance;
  let registros: jest.SpyInstance;
  beforeEach(() => {
    errores = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    registros = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { errores.mockRestore(); avisos.mockRestore(); registros.mockRestore(); });

  describe('configuración', () => {
    const acciones = [['google', 'GET'], ['callback', 'GET'], ['me', 'GET'], ['logout', 'POST']];

    it.each(acciones)('%s responde 503 si falta cualquiera de las cuatro variables, y no llama a Google', async (accion, metodo) => {
      for (const variable of Object.keys(envLocal)) {
        const env: Record<string, string> = { ...envLocal };
        delete env[variable];
        const fetchFn = jest.fn();
        const r = await manejarAuth({ accion, metodo, consulta: {}, cabeceras: {} }, { env, fetchFn, ahora: ahora() });
        expect([accion, variable, r.status]).toEqual([accion, variable, 503]);
        expect(r.cuerpo).toEqual(expect.objectContaining({ error: 'no_configurado' }));
        expect(r.ubicacion).toBeUndefined();
        expect(fetchFn).not.toHaveBeenCalled();
      }
    });

    it('un valor en blanco cuenta como ausente', async () => {
      const r = await manejarAuth({ accion: 'me', metodo: 'GET', consulta: {}, cabeceras: {} }, { env: { ...envLocal, GOOGLE_CLIENT_ID: '   ' } });
      expect(r.status).toBe(503);
    });

    it('rechaza un secreto de sesión corto', () => {
      expect(leerConfig({ ...envLocal, AUTH_SESSION_SECRET: 'corto' })).toBeNull();
      expect(leerConfig(envLocal)).not.toBeNull();
    });

    it('AUTH_BASE_URL: acepta https y http solo en localhost, sin ruta; quita la barra final', () => {
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'https://geoverificador-nine.vercel.app/' }).redirectUri).toBe('https://geoverificador-nine.vercel.app/api/auth/callback');
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'http://localhost:3000' }).redirectUri).toBe('http://localhost:3000/api/auth/callback');
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'http://127.0.0.1:3000' })).not.toBeNull();
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'http://ejemplo.com' })).toBeNull();
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'https://ejemplo.com/app' })).toBeNull();
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'ejemplo.com' })).toBeNull();
      expect(leerConfig({ ...envLocal, AUTH_BASE_URL: 'javascript:alert(1)' })).toBeNull();
    });

    it('rechaza métodos no permitidos', async () => {
      const dep = { env: envLocal, ahora: ahora() };
      expect((await manejarAuth({ accion: 'google', metodo: 'POST', consulta: {}, cabeceras: {} }, dep)).status).toBe(405);
      expect((await manejarAuth({ accion: 'callback', metodo: 'POST', consulta: {}, cabeceras: {} }, dep)).status).toBe(405);
      expect((await manejarAuth({ accion: 'me', metodo: 'POST', consulta: {}, cabeceras: {} }, dep)).status).toBe(405);
      expect((await manejarAuth({ accion: 'logout', metodo: 'GET', consulta: {}, cabeceras: {} }, dep)).status).toBe(405);
      expect((await manejarAuth({ accion: 'otra', metodo: 'GET', consulta: {}, cabeceras: {} }, dep)).status).toBe(404);
    });
  });

  describe('GET /api/auth/google (inicio del flujo)', () => {
    it('redirige a Google con state, nonce y PKCE S256, pidiendo solo openid y profile', async () => {
      const { r, url, flujo } = await iniciar();
      expect(r.status).toBe(302);
      expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      const p = url.searchParams;
      expect(p.get('client_id')).toBe(CLIENTE);
      expect(p.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
      expect(p.get('response_type')).toBe('code');
      expect(p.get('scope')).toBe('openid profile');
      expect(p.get('scope')).not.toMatch(/email/);
      expect(p.get('code_challenge_method')).toBe('S256');
      expect((p.get('state') ?? '').length).toBeGreaterThanOrEqual(32);
      expect((p.get('nonce') ?? '').length).toBeGreaterThanOrEqual(16);
      expect(flujo).toBeTruthy();
    });

    it('el code_challenge es el SHA-256 del verificador guardado en la cookie firmada', async () => {
      const { url, flujo, state, nonce } = await iniciar();
      const datos = verificar('flujo', flujo, SECRETO, T0);
      expect(datos.verificador.length).toBeGreaterThanOrEqual(43);
      expect(datos.verificador.length).toBeLessThanOrEqual(128);
      expect(datos.verificador).toMatch(/^[A-Za-z0-9\-._~]+$/);
      expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(datos.verificador).digest('base64url'));
      expect(datos.state).toBe(state);
      expect(datos.nonce).toBe(nonce);
    });

    it('cada inicio genera state, nonce y verificador distintos', async () => {
      const a = await iniciar();
      const b = await iniciar();
      expect(a.state).not.toBe(b.state);
      expect(a.nonce).not.toBe(b.nonce);
      expect(verificar('flujo', a.flujo, SECRETO, T0).verificador).not.toBe(verificar('flujo', b.flujo, SECRETO, T0).verificador);
    });

    it('la cookie del flujo es HttpOnly, SameSite=Lax, de vida corta y sin Secure en http', async () => {
      const { r, nombres } = await iniciar(envLocal);
      expect(nombres.flujo).toBe('gv_flujo');
      const c = cookieCompleta(r.cookies, nombres.flujo);
      expect(c).toMatch(/; HttpOnly/);
      expect(c).toMatch(/; SameSite=Lax/);
      expect(c).toMatch(/; Path=\//);
      expect(c).toMatch(/; Max-Age=600\b/);
      expect(c).not.toMatch(/Secure/);
    });

    it('con una base https la cookie es Secure y usa el prefijo __Host-', async () => {
      const { r, nombres, url } = await iniciar(envHttps);
      expect(nombres.flujo).toBe('__Host-gv_flujo');
      const c = cookieCompleta(r.cookies, nombres.flujo);
      expect(c).toMatch(/; Secure/);
      expect(c).toMatch(/; HttpOnly/);
      expect(c).not.toMatch(/Domain=/i);
      expect(url.searchParams.get('redirect_uri')).toBe('https://geoverificador-nine.vercel.app/api/auth/callback');
    });

    it('guarda la ruta de regreso solo si es una ruta relativa del mismo sitio', async () => {
      const buena = await iniciar(envLocal, { volver: '/?x=1' });
      expect(verificar('flujo', buena.flujo, SECRETO, T0).volver).toBe('/?x=1');
      for (const mala of ['https://malo.example/', '//malo.example', '/\\malo.example', 'javascript:alert(1)', '/api/auth/logout']) {
        const { flujo } = await iniciar(envLocal, { volver: mala });
        expect([mala, verificar('flujo', flujo, SECRETO, T0).volver]).toEqual([mala, '/']);
      }
    });

    it('no escribe secretos ni tokens en los registros', async () => {
      await iniciar();
      const todo = JSON.stringify([...errores.mock.calls, ...avisos.mock.calls, ...registros.mock.calls]);
      expect(todo).not.toContain(SECRETO);
      expect(todo).not.toContain(SECRETO_GOOGLE);
    });
  });

  describe('rutaSegura', () => {
    it.each([
      ['/', '/'], ['/login.html', '/login.html'], ['/?tour=no', '/?tour=no'], ['/mapa#reporte', '/mapa'],
      [undefined, '/'], ['', '/'], ['login.html', '/'], ['//evil.example', '/'], ['///evil.example', '/'],
      ['/\\evil.example', '/'], ['\\\\evil.example', '/'], ['https://evil.example', '/'], ['http://evil.example/x', '/'],
      ['javascript:alert(1)', '/'], ['/%0d%0aSet-Cookie:x=1', '/'], ['/a\r\nb', '/'], ['/api/auth/google', '/'],
      ['/' + 'a'.repeat(300), '/'],
    ])('%j -> %j', (entrada, esperada) => {
      expect(rutaSegura(entrada)).toBe(esperada);
    });
  });

  describe('cookie firmada (firmar / verificar)', () => {
    const datos = { sub: 'abc', nombre: 'Ana', exp: T0 / SEG + 60 };

    it('ida y vuelta con el mismo secreto', () => {
      expect(verificar('sesion', firmar('sesion', datos, SECRETO), SECRETO, T0)).toEqual(datos);
    });

    it('rechaza un payload manipulado aunque se conserve la firma', () => {
      const [cuerpo, firma] = firmar('sesion', datos, SECRETO).split('.');
      const otro = Buffer.from(JSON.stringify({ ...datos, sub: 'otra-persona' })).toString('base64url');
      expect(verificar('sesion', `${otro}.${firma}`, SECRETO, T0)).toBeNull();
      expect(verificar('sesion', `${cuerpo}.${firma}`, SECRETO, T0)).not.toBeNull();
    });

    it('rechaza una firma alterada, truncada o vacía', () => {
      const [cuerpo, firma] = firmar('sesion', datos, SECRETO).split('.');
      const cambiada = (firma[0] === 'A' ? 'B' : 'A') + firma.slice(1);
      expect(verificar('sesion', `${cuerpo}.${cambiada}`, SECRETO, T0)).toBeNull();
      expect(verificar('sesion', `${cuerpo}.${firma.slice(0, -2)}`, SECRETO, T0)).toBeNull();
      expect(verificar('sesion', `${cuerpo}.`, SECRETO, T0)).toBeNull();
    });

    it('rechaza otro secreto y un token ajeno al tipo (una cookie de flujo no sirve como sesión)', () => {
      const t = firmar('sesion', datos, SECRETO);
      expect(verificar('sesion', t, 'x'.repeat(40), T0)).toBeNull();
      expect(verificar('flujo', t, SECRETO, T0)).toBeNull();
    });

    it('rechaza lo vencido y lo que no tiene vencimiento', () => {
      const t = firmar('sesion', datos, SECRETO);
      expect(verificar('sesion', t, SECRETO, (datos.exp - 1) * SEG)).not.toBeNull();
      expect(verificar('sesion', t, SECRETO, (datos.exp + 1) * SEG)).toBeNull();
      expect(verificar('sesion', firmar('sesion', { sub: 'abc' }, SECRETO), SECRETO, T0)).toBeNull();
    });

    it.each([undefined, null, '', 'basura', 'a.b.c', '.', 42, {}])('rechaza entradas sin sentido: %j', (entrada) => {
      expect(verificar('sesion', entrada, SECRETO, T0)).toBeNull();
    });

    it('rechaza una firma válida sobre un cuerpo que no es JSON', () => {
      const cuerpo = Buffer.from('no es json').toString('base64url');
      const firma = createHmac('sha256', SECRETO).update(`sesion.${cuerpo}`).digest('base64url');
      expect(verificar('sesion', `${cuerpo}.${firma}`, SECRETO, T0)).toBeNull();
    });
  });

  describe('GET /api/auth/callback', () => {
    it('camino feliz: valida el state, canjea el código con secreto y PKCE, y abre la sesión', async () => {
      const ini = await iniciar();
      const fetchFn = jest.fn(async () => respuestaToken(idToken(reclamosOk(ini.nonce))));
      const r = await manejarAuth(reqCallback({ code: 'codigo-abc', state: ini.state }, ini.flujo), { env: envLocal, fetchFn, ahora: ahora(5000) });

      expect(r.status).toBe(302);
      expect(r.ubicacion).toBe('/');

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [urlToken, opciones] = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string; headers: Record<string, string>; signal?: unknown }];
      expect(urlToken).toBe('https://oauth2.googleapis.com/token');
      expect(opciones.method).toBe('POST');
      expect(opciones.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(opciones.signal).toBeDefined();
      const cuerpo = new URLSearchParams(opciones.body);
      expect(cuerpo.get('code')).toBe('codigo-abc');
      expect(cuerpo.get('client_id')).toBe(CLIENTE);
      expect(cuerpo.get('client_secret')).toBe(SECRETO_GOOGLE);
      expect(cuerpo.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
      expect(cuerpo.get('grant_type')).toBe('authorization_code');
      const verificador = verificar('flujo', ini.flujo, SECRETO, T0).verificador;
      expect(cuerpo.get('code_verifier')).toBe(verificador);

      const sesion = valorCookie(r.cookies, 'gv_sesion') as string;
      expect(verificar('sesion', sesion, SECRETO, T0 + 5000)).toEqual({ sub: '109876543210', nombre: 'Ana Pérez', exp: (T0 + 5000) / SEG + SIETE_DIAS_S });
      const c = cookieCompleta(r.cookies, 'gv_sesion');
      expect(c).toMatch(/; HttpOnly/);
      expect(c).toMatch(/; SameSite=Lax/);
      expect(c).toMatch(/; Path=\//);
      expect(c).toMatch(new RegExp(`; Max-Age=${SIETE_DIAS_S}\\b`));
      expect(c).not.toMatch(/Secure/);

      // La cookie del flujo se borra: el state y el verificador sirven una sola vez.
      expect(cookieCompleta(r.cookies, 'gv_flujo')).toMatch(/Max-Age=0/);
    });

    it('con base https la sesión es Secure y usa __Host-', async () => {
      const ini = await iniciar(envHttps);
      const fetchFn = jest.fn(async () => respuestaToken(idToken(reclamosOk(ini.nonce))));
      const r = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, ini.flujo, '__Host-gv_flujo'), { env: envHttps, fetchFn, ahora: ahora() });
      expect(r.status).toBe(302);
      const c = cookieCompleta(r.cookies, '__Host-gv_sesion');
      expect(c).toMatch(/; Secure/);
      expect(c).toMatch(/; HttpOnly/);
    });

    it('vuelve a la ruta guardada si era segura', async () => {
      const ini = await iniciar(envLocal, { volver: '/login.html' });
      const fetchFn = jest.fn(async () => respuestaToken(idToken(reclamosOk(ini.nonce))));
      const r = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, ini.flujo), { env: envLocal, fetchFn, ahora: ahora() });
      expect(r.ubicacion).toBe('/login.html');
    });

    it('no guarda el correo ni el token en la sesión, aunque Google los envíe', async () => {
      const ini = await iniciar();
      const token = idToken(reclamosOk(ini.nonce, { email: 'ana@example.com', picture: 'https://foto' }));
      const r = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, ini.flujo), { env: envLocal, fetchFn: jest.fn(async () => respuestaToken(token)), ahora: ahora() });
      const valor = valorCookie(r.cookies, 'gv_sesion') as string;
      const texto = Buffer.from(valor.split('.')[0], 'base64url').toString();
      expect(Object.keys(JSON.parse(texto)).sort()).toEqual(['exp', 'nombre', 'sub']);
      expect(texto).not.toContain('ana@example.com');
      expect(valor).not.toContain(token);
    });

    it('limpia el nombre: sin caracteres de control, recortado, con respaldo si falta', async () => {
      const ini = await iniciar();
      const llamar = async (extra: Record<string, unknown>) => {
        const r = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, ini.flujo), { env: envLocal, fetchFn: jest.fn(async () => respuestaToken(idToken(reclamosOk(ini.nonce, extra)))), ahora: ahora() });
        return verificar('sesion', valorCookie(r.cookies, 'gv_sesion') as string, SECRETO, T0)?.nombre;
      };
      expect(await llamar({ name: 'Ana\u0000 \n\tPérez' })).toBe('Ana Pérez');
      expect((await llamar({ name: 'x'.repeat(500) })).length).toBe(80);
      expect(await llamar({ name: undefined, given_name: 'Ana' })).toBe('Ana');
      expect(await llamar({ name: '   ', given_name: undefined })).toBe('Cuenta de Google');
    });

    it('sin cookie del flujo, con la cookie manipulada o vencida: sesion_expirada y sin llamar a Google', async () => {
      const ini = await iniciar();
      const fetchFn = jest.fn();
      const dep = { env: envLocal, fetchFn, ahora: ahora() };
      const sinCookie = await manejarAuth(reqCallback({ code: 'c', state: ini.state }), dep);
      expect(sinCookie.status).toBe(302);
      expect(sinCookie.ubicacion).toBe('/login.html?error=sesion_expirada');
      const [cuerpo, firma] = ini.flujo.split('.');
      const manipulada = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, `${cuerpo}x.${firma}`), dep);
      expect(manipulada.ubicacion).toBe('/login.html?error=sesion_expirada');
      const vencida = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, ini.flujo), { ...dep, ahora: ahora(601 * SEG) });
      expect(vencida.ubicacion).toBe('/login.html?error=sesion_expirada');
      expect(fetchFn).not.toHaveBeenCalled();
      expect(valorCookie(vencida.cookies, 'gv_sesion')).toBeUndefined();
    });

    it('state distinto, ausente o de otra longitud: estado_invalido y sin llamar a Google', async () => {
      const ini = await iniciar();
      const fetchFn = jest.fn();
      for (const state of [ini.state.slice(0, -1) + (ini.state.endsWith('A') ? 'B' : 'A'), ini.state + 'x', ini.state.slice(1), '', undefined]) {
        const consulta: Record<string, string> = { code: 'c' };
        if (state !== undefined) consulta.state = state;
        const r = await manejarAuth(reqCallback(consulta, ini.flujo), { env: envLocal, fetchFn, ahora: ahora() });
        expect([state, r.ubicacion]).toEqual([state, '/login.html?error=estado_invalido']);
        expect(valorCookie(r.cookies, 'gv_sesion')).toBeUndefined();
        expect(cookieCompleta(r.cookies, 'gv_flujo')).toMatch(/Max-Age=0/);
      }
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('el usuario niega el acceso: acceso_denegado; otro error de Google: google_error', async () => {
      const ini = await iniciar();
      const fetchFn = jest.fn();
      const dep = { env: envLocal, fetchFn, ahora: ahora() };
      const negado = await manejarAuth(reqCallback({ error: 'access_denied', state: ini.state }, ini.flujo), dep);
      expect(negado.ubicacion).toBe('/login.html?error=acceso_denegado');
      const otro = await manejarAuth(reqCallback({ error: 'server_error', state: ini.state }, ini.flujo), dep);
      expect(otro.ubicacion).toBe('/login.html?error=google_error');
      expect(fetchFn).not.toHaveBeenCalled();
      expect(valorCookie(negado.cookies, 'gv_sesion')).toBeUndefined();
    });

    it('un error de Google con state incorrecto sigue siendo estado_invalido', async () => {
      const ini = await iniciar();
      const r = await manejarAuth(reqCallback({ error: 'access_denied', state: 'otro' }, ini.flujo), { env: envLocal, fetchFn: jest.fn(), ahora: ahora() });
      expect(r.ubicacion).toBe('/login.html?error=estado_invalido');
    });

    it('sin code: google_error', async () => {
      const ini = await iniciar();
      const fetchFn = jest.fn();
      const r = await manejarAuth(reqCallback({ state: ini.state }, ini.flujo), { env: envLocal, fetchFn, ahora: ahora() });
      expect(r.ubicacion).toBe('/login.html?error=google_error');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('si el endpoint de tokens falla, tarda o no devuelve id_token: intercambio_fallido, sin sesión', async () => {
      const ini = await iniciar();
      const req = () => reqCallback({ code: 'c', state: ini.state }, ini.flujo);
      const casos: Array<[string, jest.Mock]> = [
        ['HTTP 400', jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }))],
        ['red', jest.fn(async () => { throw new Error('ECONNRESET'); })],
        ['sin id_token', jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))],
        ['JSON roto', jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }))],
      ];
      for (const [nombre, fetchFn] of casos) {
        const r = await manejarAuth(req(), { env: envLocal, fetchFn, ahora: ahora() });
        expect([nombre, r.ubicacion]).toEqual([nombre, '/login.html?error=intercambio_fallido']);
        expect(valorCookie(r.cookies, 'gv_sesion')).toBeUndefined();
      }
    });

    describe('reclamos del ID token', () => {
      const probar = async (cambios: Record<string, unknown> | ((nonce: string) => string)) => {
        const ini = await iniciar();
        const token = typeof cambios === 'function' ? cambios(ini.nonce) : idToken(reclamosOk(ini.nonce, cambios));
        const r = await manejarAuth(reqCallback({ code: 'c', state: ini.state }, ini.flujo), { env: envLocal, fetchFn: jest.fn(async () => respuestaToken(token)), ahora: ahora() });
        return r;
      };
      const rechazado = (r: { ubicacion: string; cookies: string[] }) => {
        expect(r.ubicacion).toBe('/login.html?error=token_invalido');
        expect(valorCookie(r.cookies, 'gv_sesion')).toBeUndefined();
      };

      it('acepta iss con y sin esquema, y aud como arreglo con azp', async () => {
        expect((await probar({ iss: 'accounts.google.com' })).ubicacion).toBe('/');
        expect((await probar({ aud: [CLIENTE, 'otro'], azp: CLIENTE })).ubicacion).toBe('/');
      });
      it('rechaza un emisor distinto', async () => { rechazado(await probar({ iss: 'https://evil.example' })); });
      it('rechaza una audiencia distinta', async () => { rechazado(await probar({ aud: 'otro-cliente' })); });
      it('rechaza una audiencia múltiple sin azp propio', async () => {
        rechazado(await probar({ aud: [CLIENTE, 'otro'] }));
        rechazado(await probar({ aud: [CLIENTE, 'otro'], azp: 'otro' }));
      });
      it('rechaza un token vencido', async () => { rechazado(await probar({ exp: T0 / SEG - 1 })); });
      it('rechaza un token sin exp', async () => { rechazado(await probar({ exp: undefined })); });
      it('rechaza un nonce distinto o ausente', async () => {
        rechazado(await probar({ nonce: 'otro' }));
        rechazado(await probar({ nonce: undefined }));
      });
      it('rechaza un token sin sub o con sub vacío', async () => {
        rechazado(await probar({ sub: undefined }));
        rechazado(await probar({ sub: '' }));
        rechazado(await probar({ sub: 12345 }));
      });
      it('rechaza un JWT mal formado', async () => {
        rechazado(await probar(() => 'no-es-un-jwt'));
        rechazado(await probar(() => 'a.b.c'));
        rechazado(await probar(() => `${b64({})}.${Buffer.from('[1]').toString('base64url')}.x`));
      });
    });

    it('no escribe el código, el id_token ni los secretos en los registros', async () => {
      const ini = await iniciar();
      const token = idToken(reclamosOk(ini.nonce, { iss: 'https://evil.example' }));
      const fetchFn = jest.fn(async () => respuestaToken(token));
      await manejarAuth(reqCallback({ code: 'codigo-secreto-xyz', state: ini.state }, ini.flujo), { env: envLocal, fetchFn, ahora: ahora() });
      await manejarAuth(reqCallback({ code: 'codigo-secreto-xyz', state: ini.state }, ini.flujo), { env: envLocal, fetchFn: jest.fn(async () => { throw new Error(`fallo con ${SECRETO_GOOGLE}`); }), ahora: ahora() });
      const todo = JSON.stringify([...errores.mock.calls, ...avisos.mock.calls, ...registros.mock.calls]);
      for (const secreto of ['codigo-secreto-xyz', token, SECRETO_GOOGLE, SECRETO, ini.flujo]) expect(todo).not.toContain(secreto);
    });
  });

  describe('GET /api/auth/me', () => {
    const sesion = (extra: Record<string, unknown> = {}, secreto = SECRETO) => firmar('sesion', { sub: '109876543210', nombre: 'Ana Pérez', exp: T0 / SEG + 3600, ...extra }, secreto);
    const consultar = (cookie: string | undefined, desplazamientoMs = 0) =>
      manejarAuth({ accion: 'me', metodo: 'GET', consulta: {}, cabeceras: cookie === undefined ? {} : { cookie } }, { env: envLocal, ahora: ahora(desplazamientoMs) });

    it('sin cookie: anónimo', async () => {
      const r = await consultar(undefined);
      expect(r).toEqual(expect.objectContaining({ status: 200, cuerpo: { autenticado: false } }));
    });

    it('con sesión válida: autenticado y solo el nombre, sin sub ni token', async () => {
      const r = await consultar(`gv_sesion=${sesion()}`);
      expect(r.status).toBe(200);
      expect(r.cuerpo).toEqual({ autenticado: true, nombre: 'Ana Pérez' });
      expect(JSON.stringify(r.cuerpo)).not.toContain('109876543210');
    });

    it('con la cookie manipulada, de otro secreto o vencida: anónimo', async () => {
      const t = sesion();
      const [cuerpo, firma] = t.split('.');
      const otro = Buffer.from(JSON.stringify({ sub: 'x', nombre: 'Intruso', exp: T0 / SEG + 3600 })).toString('base64url');
      for (const cookie of [`gv_sesion=${otro}.${firma}`, `gv_sesion=${cuerpo}.zzzz`, `gv_sesion=${sesion({}, 'x'.repeat(40))}`, 'gv_sesion=basura', 'gv_sesion=']) {
        expect([cookie, (await consultar(cookie)).cuerpo]).toEqual([cookie, { autenticado: false }]);
      }
      expect((await consultar(`gv_sesion=${t}`, 7200 * SEG)).cuerpo).toEqual({ autenticado: false });
    });

    it('una cookie de flujo no abre sesión', async () => {
      const ini = await iniciar();
      expect((await consultar(`gv_sesion=${ini.flujo}`)).cuerpo).toEqual({ autenticado: false });
    });

    it('con base https solo cuenta la cookie __Host-', async () => {
      const dep = { env: envHttps, ahora: ahora() };
      const t = sesion();
      const con = await manejarAuth({ accion: 'me', metodo: 'GET', consulta: {}, cabeceras: { cookie: `__Host-gv_sesion=${t}` } }, dep);
      const sin = await manejarAuth({ accion: 'me', metodo: 'GET', consulta: {}, cabeceras: { cookie: `gv_sesion=${t}` } }, dep);
      expect(con.cuerpo).toEqual({ autenticado: true, nombre: 'Ana Pérez' });
      expect(sin.cuerpo).toEqual({ autenticado: false });
    });

    it('tolera una cabecera de cookie rara', async () => {
      expect((await consultar('===; ;;a; gv_sesion; =x')).cuerpo).toEqual({ autenticado: false });
    });
  });

  describe('POST /api/auth/logout', () => {
    const salir = (cabeceras: Record<string, string>, env = envLocal, metodo = 'POST') =>
      manejarAuth({ accion: 'logout', metodo, consulta: {}, cabeceras }, { env, ahora: ahora() });

    it('con Sec-Fetch-Site same-origin borra las cookies de sesión y de flujo', async () => {
      const r = await salir({ 'sec-fetch-site': 'same-origin', cookie: 'gv_sesion=x' });
      expect(r.status).toBe(200);
      expect(r.cuerpo).toEqual({ autenticado: false });
      for (const nombre of ['gv_sesion', 'gv_flujo']) {
        const c = cookieCompleta(r.cookies, nombre);
        expect(c).toMatch(/^[a-z_]+=;/);
        expect(c).toMatch(/Max-Age=0/);
        expect(c).toMatch(/Path=\//);
        expect(c).toMatch(/HttpOnly/);
      }
    });

    it('con base https borra con los mismos atributos (__Host-, Secure)', async () => {
      const r = await salir({ 'sec-fetch-site': 'same-origin' }, envHttps);
      const c = cookieCompleta(r.cookies, '__Host-gv_sesion');
      expect(c).toMatch(/Max-Age=0/);
      expect(c).toMatch(/Secure/);
    });

    it('sin Sec-Fetch-Site acepta un Origin igual al de la aplicación', async () => {
      expect((await salir({ origin: 'http://localhost:3000' })).status).toBe(200);
      expect((await salir({ origin: 'https://geoverificador-nine.vercel.app' }, envHttps)).status).toBe(200);
    });

    it('rechaza (403) peticiones de otro sitio y no borra nada', async () => {
      const casos: Array<Record<string, string>> = [
        { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' },
        { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'http://localhost:3001' },
        { 'sec-fetch-site': 'cross-site', origin: 'http://localhost:3000' },
        {},
      ];
      for (const cab of casos) {
        const r = await salir(cab);
        expect([JSON.stringify(cab), r.status]).toEqual([JSON.stringify(cab), 403]);
        expect(r.cuerpo).toEqual(expect.objectContaining({ error: 'origen_no_permitido' }));
        expect(r.cookies ?? []).toEqual([]);
      }
    });

    it('GET no cierra sesión (405)', async () => {
      const r = await salir({ 'sec-fetch-site': 'same-origin' }, envLocal, 'GET');
      expect(r.status).toBe(405);
      expect(r.cookies ?? []).toEqual([]);
    });
  });

  describe('atenderNode (adaptador para Vercel y Nest)', () => {
    const resFalsa = () => {
      const cabeceras: Record<string, unknown> = {};
      const res: any = {
        statusCode: 0, cuerpo: '', cabeceras,
        setHeader: (k: string, v: unknown) => { cabeceras[k.toLowerCase()] = v; },
        end: (c?: string) => { res.cuerpo = c ?? ''; },
      };
      return res;
    };
    const reqFalsa = (url: string, method: string, headers: Record<string, string> = {}): any => ({ url, method, headers, socket: {} });

    it('responde JSON sin caché y reenvía las cookies como arreglo', async () => {
      const t = firmar('sesion', { sub: 's', nombre: 'Ana', exp: Date.now() / SEG + 3600 }, SECRETO);
      const res = resFalsa();
      await atenderNode('me', reqFalsa('/api/auth/me', 'GET', { cookie: `gv_sesion=${t}` }), res, { env: envLocal });
      expect(res.statusCode).toBe(200);
      expect(res.cabeceras['content-type']).toMatch(/application\/json/);
      expect(res.cabeceras['cache-control']).toBe('no-store');
      expect(JSON.parse(res.cuerpo)).toEqual({ autenticado: true, nombre: 'Ana' });
    });

    it('redirige con Location y Set-Cookie', async () => {
      const res = resFalsa();
      await atenderNode('google', reqFalsa('/api/auth/google?volver=%2Flogin.html', 'GET'), res, { env: envLocal });
      expect(res.statusCode).toBe(302);
      expect(String(res.cabeceras.location)).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect(Array.isArray(res.cabeceras['set-cookie'])).toBe(true);
      expect(res.cabeceras['cache-control']).toBe('no-store');
    });

    it('sin configuración responde 503 en JSON', async () => {
      const res = resFalsa();
      await atenderNode('me', reqFalsa('/api/auth/me', 'GET'), res, { env: {} });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.cuerpo).error).toBe('no_configurado');
    });

    it('lee la consulta de la URL y las cabeceras en minúsculas', async () => {
      const ini = await iniciar();
      const res = resFalsa();
      const fetchFn = jest.fn(async () => respuestaToken(idToken(reclamosOk(ini.nonce))));
      await atenderNode('callback', reqFalsa(`/api/auth/callback?code=abc&state=${encodeURIComponent(ini.state)}`, 'GET', { Cookie: `gv_flujo=${ini.flujo}` }), res, { env: envLocal, fetchFn, ahora: ahora() });
      expect(res.statusCode).toBe(302);
      expect(res.cabeceras.location).toBe('/');
    });

    it('un error inesperado devuelve 500 genérico', async () => {
      const res = resFalsa();
      await atenderNode('me', reqFalsa('/api/auth/me', 'GET'), res, { env: envLocal, ahora: () => { throw new Error('boom'); } });
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.cuerpo)).toEqual({ error: 'interno' });
    });
  });
});
