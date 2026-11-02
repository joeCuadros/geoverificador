import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule, ObserveInstrument } from './app.module';

// Local development: load the key from .env.local / .env (already-set variables win). Values are never printed.
for (const archivo of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(archivo);
  } catch {
    // The file is optional.
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  app.useStaticAssets(join(__dirname, '..', 'public')); //habilitar uso de archivos estaticos
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
