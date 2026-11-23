import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule, ObserveInstrument } from './app.module';
import { CARPETA_ESTATICA, RAIZ_DEL_REPOSITORIO } from './estatica';

// Local development: load the key from .env.local / .env (already-set variables win). Values are never printed.
// The app runs from apps/api, but the variables live in the repository root (see .env.example): both places are tried.
for (const archivo of ['.env.local', '.env', join(RAIZ_DEL_REPOSITORIO, '.env.local'), join(RAIZ_DEL_REPOSITORIO, '.env')]) {
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
  app.useStaticAssets(CARPETA_ESTATICA); //habilitar uso de archivos estaticos
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
