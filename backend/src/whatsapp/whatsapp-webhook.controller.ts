import {
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { verifyWahaSignature } from './waha-signature';

export const WAHA_WEBHOOK_KEY = Symbol('WAHA_WEBHOOK_KEY');

@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(
    @Inject(WAHA_WEBHOOK_KEY) private readonly key: string | undefined,
  ) {}

  @Post()
  @HttpCode(204)
  receive(@Req() request: RawBodyRequest<Request>): void {
    if (
      request.path !== '/api/whatsapp/webhook' ||
      !verifyWahaSignature(
        request.rawBody,
        this.key,
        request.headers['x-webhook-hmac'],
        request.headers['x-webhook-hmac-algorithm'],
      )
    ) {
      throw new UnauthorizedException();
    }
    // No event is routed or acted upon. A repeated delivery has no side effects.
  }
}
