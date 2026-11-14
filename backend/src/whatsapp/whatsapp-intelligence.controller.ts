import {
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * The central administrative channel is owned by the platform, not by a tenant:
 * it is reachable only by a platform super-admin and has no organization scope,
 * so OrganizationRequiredGuard is deliberately absent. An organization ADMIN is
 * rejected by RolesGuard because its inherited roles never include SUPER_ADMIN.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/intelligence/session')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class WhatsAppIntelligenceController {
  constructor(private readonly sessions: WhatsAppSessionService) {}

  @Post()
  @HttpCode(200)
  connect() {
    return this.sessions.connect({ channel: 'INTELLIGENCE' });
  }

  @Get()
  status() {
    return this.sessions.status({ channel: 'INTELLIGENCE' });
  }

  @Get('qr')
  @Header('Cache-Control', 'private, no-store')
  qr() {
    return this.sessions.qr({ channel: 'INTELLIGENCE' });
  }

  @Post('stop')
  @HttpCode(204)
  stop() {
    return this.sessions.stop({ channel: 'INTELLIGENCE' });
  }

  @Post('restart')
  @HttpCode(204)
  restart() {
    return this.sessions.restart({ channel: 'INTELLIGENCE' });
  }

  @Post('logout')
  @HttpCode(204)
  logout() {
    return this.sessions.logout();
  }
}
