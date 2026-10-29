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

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/session')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@Roles(OrgRole.ADMIN)
export class WhatsAppController {
  constructor(private readonly service: WhatsAppSessionService) {}
  @Post()
  @HttpCode(204)
  connect(@CurrentUser() user: RequestUser) {
    return this.service.connect(user.organizationId);
  }
  @Get()
  status(@CurrentUser() user: RequestUser) {
    return this.service.status(user.organizationId);
  }
  @Get('qr')
  @Header('Cache-Control', 'private, no-store')
  qr(@CurrentUser() user: RequestUser) {
    return this.service.qr(user.organizationId);
  }
}
