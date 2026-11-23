import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) serves the home page', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);
  });

  it('/api (GET) returns the API status', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect({ status: 'ok', proyecto: 'GeoVerificador', version: '1.0.0' });
  });

  describe('/api/chat without GEMINI_API_KEY', () => {
    const previous = process.env.GEMINI_API_KEY;
    beforeAll(() => {
      delete process.env.GEMINI_API_KEY;
    });
    afterAll(() => {
      if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
    });

    it('GET reports the model as unavailable', () => {
      return request(app.getHttpServer()).get('/api/chat').expect(200).expect({ disponible: false });
    });

    it('POST answers 503 so the page falls back to the rule-based parser', () => {
      return request(app.getHttpServer())
        .post('/api/chat')
        .send({ mode: 'interpretar', mensaje: 'hola' })
        .expect(503)
        .expect({ error: 'no_configurado' });
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
