import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { WhatsAppIdentityService } from './whatsapp-identity.service';

/**
 * Administrative identity linking: an organization ADMIN proves which MeperPOS
 * user a WhatsApp number belongs to before that number may ask the central
 * channel anything. The organization always comes from the authenticated token
 * and never from the request, so a caller cannot issue, list or revoke a link in
 * another tenant. OrganizationRequiredGuard still lets a SUPER_ADMIN through
 * without a scope, so the handlers fail closed on a missing organization.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/identity')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@Roles(OrgRole.ADMIN)
export class WhatsAppIdentityController {
  constructor(private readonly identities: WhatsAppIdentityService) {}

  /**
   * The code is shown once, in this response, and is worthless afterwards: only
   * its hash is stored. `no-store` keeps it out of every intermediate cache.
   */
  @Post('challenge')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  challenge(@CurrentUser() user: RequestUser) {
    return this.identities.issueChallenge(
      user.userId,
      requireOrganization(user),
    );
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.identities.list(user.userId, requireOrganization(user));
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.identities.revoke(user.userId, requireOrganization(user), id);
  }
}

/**
 * An administrative identity without an organization context has no tenant to
 * act in, so the request is refused rather than linked to a scope-less row.
 */
function requireOrganization(user: RequestUser): string {
  if (!user.organizationId) throw new ForbiddenException();
  return user.organizationId;
}
