import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { AppService } from './app.service';
import { CARPETA_ESTATICA } from './estatica';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Pantalla de Inicio
  @Get()
  getHome(@Res() res: Response) {
    return res.sendFile(join(CARPETA_ESTATICA, 'index.html'));
  }

  // Api
  @Get('api')
  getApiData() {
    return {
      status: 'ok',
      proyecto: 'GeoVerificador',
      version: '1.0.0',
    };
  }
}