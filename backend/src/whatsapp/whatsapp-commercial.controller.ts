import {
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * The commercial channel belongs to exactly one organization and is driven only
 * by that organization's ADMIN (OWNER inherits). The organization comes from
 * the authenticated token and never from the request, so no caller can address
 * another tenant's session, and a platform super-admin without an organization
 * cannot select a tenant here.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/commercial/session')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@Roles(OrgRole.ADMIN)
export class WhatsAppCommercialController {
  constructor(private readonly sessions: WhatsAppSessionService) {}

  @Post()
  @HttpCode(200)
  connect(@CurrentUser() user: RequestUser) {
    return this.sessions.connect({
      channel: 'COMMERCIAL',
      organizationId: user.organizationId,
    });
  }

  @Get()
  status(@CurrentUser() user: RequestUser) {
    return this.sessions.status({
      channel: 'COMMERCIAL',
      organizationId: user.organizationId,
    });
  }

  @Get('qr')
  @Header('Cache-Control', 'private, no-store')
  qr(@CurrentUser() user: RequestUser) {
    return this.sessions.qr({
      channel: 'COMMERCIAL',
      organizationId: user.organizationId,
    });
  }

  @Post('stop')
  @HttpCode(204)
  stop(@CurrentUser() user: RequestUser) {
    return this.sessions.stop({
      channel: 'COMMERCIAL',
      organizationId: user.organizationId,
    });
  }

  @Post('restart')
  @HttpCode(204)
  restart(@CurrentUser() user: RequestUser) {
    return this.sessions.restart({
      channel: 'COMMERCIAL',
      organizationId: user.organizationId,
    });
  }
}
