import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { join } from 'path';
import { AppModule, ObserveInstrument } from './app.module';
import { ZonasService } from './zonas/zonas.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  const trustProxyHops = process.env.TRUST_PROXY_HOPS;
  if (trustProxyHops !== undefined) {
    const hops = Number(trustProxyHops);
    if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
      throw new Error('TRUST_PROXY_HOPS debe ser un entero entre 1 y 5.');
    }
    app.getHttpAdapter().getInstance().set('trust proxy', hops);
  }
  app.useStaticAssets(join(__dirname, '..', 'public')); //habilitar uso de archivos estaticos
  const logger = new Logger('ZonasCache');
  try {
    await app.get(ZonasService).warmCache();
  } catch {
    logger.warn('No se pudo precargar la cuadrícula; la API verificará la base de datos en la primera búsqueda.');
  }
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
