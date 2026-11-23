import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('api', () => {
    it('should return the API status payload', () => {
      expect(appController.getApiData()).toEqual({
        status: 'ok',
        proyecto: 'GeoVerificador',
        version: '1.0.0',
      });
    });
  });
});
