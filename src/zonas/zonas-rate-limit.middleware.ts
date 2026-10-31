import type { NextFunction, Request, Response } from 'express';
import { Injectable, type NestMiddleware } from '@nestjs/common';

interface RateLimitEntry {
  windowStartedAt: number;
  requestCount: number;
}

@Injectable()
export class ZonasRateLimitMiddleware implements NestMiddleware {
  private readonly entries = new Map<string, RateLimitEntry>();
  private requestCount = 0;
  private readonly windowMs = 60_000;
  private readonly maximumRequests = 30;
  private readonly maximumTrackedAddresses = 10_000;

  use(request: Request, response: Response, next: NextFunction): void {
    const now = Date.now();
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    let entry = this.entries.get(address);

    if (!entry && this.entries.size >= this.maximumTrackedAddresses) {
      this.removeExpiredEntries(now);
      if (this.entries.size >= this.maximumTrackedAddresses) {
        response.setHeader('Retry-After', String(Math.ceil(this.windowMs / 1000)));
        response.status(429).json({
          statusCode: 429,
          message: 'El servicio está ocupado. Inténtalo nuevamente en un minuto.',
        });
        return;
      }
    }

    if (!entry || now - entry.windowStartedAt >= this.windowMs) {
      entry = { windowStartedAt: now, requestCount: 0 };
      this.entries.set(address, entry);
    }
    entry.requestCount += 1;
    this.requestCount += 1;

    if (this.requestCount % 256 === 0) {
      this.removeExpiredEntries(now);
    }
    if (entry.requestCount > this.maximumRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStartedAt + this.windowMs - now) / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));
      response.status(429).json({
        statusCode: 429,
        message: 'Has alcanzado el límite de búsquedas. Inténtalo nuevamente en un minuto.',
      });
      return;
    }
    next();
  }

  private removeExpiredEntries(now: number): void {
    for (const [address, entry] of this.entries) {
      if (now - entry.windowStartedAt >= this.windowMs) this.entries.delete(address);
    }
  }
}
