import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

interface RespuestaChat {
  status: number;
  cuerpo: unknown;
}

// The core is plain CommonJS shared with the Vercel function (api/chat.js); the key is read from GEMINI_API_KEY on the server only.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nucleo = require('../api/_lib/gemini.js') as {
  manejarChat: (req: { metodo: string; cuerpo: unknown; ip: string }) => Promise<RespuestaChat>;
};

@Controller('api/chat')
export class ChatController {
  // Tells the page whether the model is configured, without spending a model call.
  @Get()
  async disponible(@Req() req: Request, @Res() res: Response) {
    const r = await nucleo.manejarChat({ metodo: 'GET', cuerpo: null, ip: req.ip ?? '' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(r.cuerpo);
  }

  @Post()
  @HttpCode(200)
  async chat(@Req() req: Request, @Body() cuerpo: unknown, @Res() res: Response) {
    const r = await nucleo.manejarChat({ metodo: 'POST', cuerpo, ip: req.ip ?? '' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(r.cuerpo);
  }
}
