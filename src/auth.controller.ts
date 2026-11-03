import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

type Accion = 'google' | 'callback' | 'me' | 'logout';

// The core is plain CommonJS shared with the Vercel functions (api/auth/*.js). It reads GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, AUTH_SESSION_SECRET and AUTH_BASE_URL from the environment and answers 503 when any is missing.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nucleo = require('../api/_lib/auth.js') as {
  atenderNode: (accion: Accion, req: Request, res: Response) => Promise<void>;
};

// Optional sign-in. Every route accepts any HTTP method here and lets the shared core answer 405, exactly as on Vercel.
@Controller('api/auth')
export class AuthController {
  @All('google')
  google(@Req() req: Request, @Res() res: Response) {
    return nucleo.atenderNode('google', req, res);
  }

  @All('callback')
  callback(@Req() req: Request, @Res() res: Response) {
    return nucleo.atenderNode('callback', req, res);
  }

  @All('me')
  me(@Req() req: Request, @Res() res: Response) {
    return nucleo.atenderNode('me', req, res);
  }

  @All('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    return nucleo.atenderNode('logout', req, res);
  }
}
