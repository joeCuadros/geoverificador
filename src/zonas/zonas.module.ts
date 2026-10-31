import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ZonasController } from './zonas.controller';
import { ZonasRateLimitMiddleware } from './zonas-rate-limit.middleware';
import { ZonasService } from './zonas.service';

@Module({
  controllers: [ZonasController],
  providers: [ZonasRateLimitMiddleware, ZonasService],
})
export class ZonasModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ZonasRateLimitMiddleware)
      .forRoutes({ path: 'api/v1/zonas/buscar', method: RequestMethod.POST });
  }
}
