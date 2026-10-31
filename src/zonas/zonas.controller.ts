import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { parseSearchParameters, type SearchParameters, type ZoneSearchResult } from './zonas-buscar.logic';
import { ZonasService } from './zonas.service';

@Controller('api/v1/zonas')
export class ZonasController {
  constructor(private readonly zonasService: ZonasService) {}

  @Post('buscar')
  @HttpCode(HttpStatus.OK)
  buscar(@Body() body: unknown): Promise<ZoneSearchResult> {
    let parameters: SearchParameters;
    try {
      parameters = parseSearchParameters(body);
    } catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw new BadRequestException('La solicitud no tiene un formato válido.');
    }
    return this.zonasService.buscar(parameters);
  }
}
