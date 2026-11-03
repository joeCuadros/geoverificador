/**
 * Wiring of the Nest controller (src/auth.controller.ts) over HTTP with supertest. The logic itself is covered by
 * test/auth-handler.spec.ts; here we only check that the routes exist at the same paths as on Vercel and that the
 * shared core answers through Express (status, JSON, redirect, cookies). No call to Google is made.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthController } from '../src/auth.controller';

const VARIABLES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_SESSION_SECRET', 'AUTH_BASE_URL'] as const;

describe('AuthController (HTTP)', () => {
  let app: INestApplication;
  const guardadas: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ controllers: [AuthController] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const v of VARIABLES) {
      guardadas[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARIABLES) {
      if (guardadas[v] === undefined) delete process.env[v];
      else process.env[v] = guardadas[v];
    }
  });

  const configurar = () => {
    process.env.GOOGLE_CLIENT_ID = 'cliente-123.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'secreto-falso';
    process.env.AUTH_SESSION_SECRET = 's'.repeat(40);
    process.env.AUTH_BASE_URL = 'http://localhost:3000';
  };

  it('without configuration every endpoint answers 503 JSON', async () => {
    for (const ruta of ['/api/auth/google', '/api/auth/callback', '/api/auth/me']) {
      const r = await request(app.getHttpServer()).get(ruta).expect(503);
      expect(r.body).toEqual(expect.objectContaining({ error: 'no_configurado' }));
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await request(app.getHttpServer()).post('/api/auth/logout').expect(503);
  });

  it('GET /api/auth/google redirects to Google and sets the HttpOnly flow cookie', async () => {
    configurar();
    const r = await request(app.getHttpServer()).get('/api/auth/google').expect(302);
    expect(r.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    const cookies = r.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toMatch(/^gv_flujo=.+; Path=\/; HttpOnly; SameSite=Lax/);
  });

  it('GET /api/auth/me is anonymous without a cookie', async () => {
    configurar();
    const r = await request(app.getHttpServer()).get('/api/auth/me').expect(200);
    expect(r.body).toEqual({ autenticado: false });
  });

  it('POST /api/auth/logout needs a same-origin request; GET is not allowed', async () => {
    configurar();
    await request(app.getHttpServer()).post('/api/auth/logout').expect(403);
    await request(app.getHttpServer()).post('/api/auth/logout').set('Sec-Fetch-Site', 'cross-site').expect(403);
    const ok = await request(app.getHttpServer()).post('/api/auth/logout').set('Sec-Fetch-Site', 'same-origin').expect(200);
    expect(ok.body).toEqual({ autenticado: false });
    await request(app.getHttpServer()).get('/api/auth/logout').expect(405);
  });
});
