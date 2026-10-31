import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ZonasService } from './../src/zonas/zonas.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    }).overrideProvider(ZonasService).useValue({
      buscar: jest.fn().mockResolvedValue({
        type: 'FeatureCollection',
        features: [],
        metadata: { cantidadCeldasEvaluadas: 0 },
      }),
    });
    const moduleFixture: TestingModule = await moduleBuilder.compile();

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

  it('/api/v1/zonas/buscar (POST) returns a GeoJSON FeatureCollection', () => {
    return request(app.getHttpServer())
      .post('/api/v1/zonas/buscar')
      .send({ estrellas: { salud: 5, colegio_primaria: 5, area_verde: 3, paradero: 2 } })
      .expect(200)
      .expect((response) => {
        expect(response.body.type).toBe('FeatureCollection');
        expect(response.body.metadata.cantidadCeldasEvaluadas).toBe(0);
      });
  });

  it('/api/v1/zonas/buscar rejects requests with all criteria disabled', () => {
    return request(app.getHttpServer())
      .post('/api/v1/zonas/buscar')
      .send({ estrellas: {} })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toContain('Asigna al menos una estrella');
      });
  });

  it('/api/v1/zonas/buscar limits repeated requests from the same IP', async () => {
    let response;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      response = await request(app.getHttpServer())
        .post('/api/v1/zonas/buscar')
        .send({ estrellas: { salud: 1 } });
    }

    expect(response?.status).toBe(429);
    expect(response?.body.message).toContain('límite de búsquedas');
    expect(response?.headers['retry-after']).toBeDefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
