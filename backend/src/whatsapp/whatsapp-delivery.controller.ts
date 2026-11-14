import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  OrgRole,
  type WhatsAppDeliveryKind,
  type WhatsAppDeliveryStatus,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  WhatsAppDeliveryService,
  type WhatsAppDeliveryOutcome,
} from './whatsapp-delivery.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';

/**
 * How many delivery rows the history shows. The screen is a supervision aid, not
 * an archive: a bounded window keeps one organization's page from growing without
 * limit and keeps the query index-backed.
 */
export const DELIVERY_HISTORY_LIMIT = 30;

/** Who may receive the daily report; the same closed list the delivery uses. */
const ADMINISTRATIVE_ROLES: readonly OrgRole[] = ['OWNER', 'ADMIN'];

/**
 * What the screen may know about an attempt. Deliberately narrower than the row:
 * the connection, the provider message id and the timestamps of the claim never
 * travel, so one organization cannot read another's provider identity out of this
 * endpoint.
 */
export interface WhatsAppDeliveryView {
  id: string;
  kind: WhatsAppDeliveryKind;
  reportDate: Date;
  status: WhatsAppDeliveryStatus;
  failureReason: string | null;
  sentAt: Date | null;
  attempts: number;
}

/**
 * Delivery supervision for one organization.
 *
 * Two rules hold here:
 *
 *  - **The tenant comes from the token.** The organization is read from the
 *    authenticated user and never from the request, so no caller can name another
 *    organization's history or ask for a report to be sent to somebody else's
 *    phone.
 *  - **A send is never synthesized.** The on-demand path delegates to
 *    `WhatsAppDeliveryService`, which decides the recipient and records the
 *    attempt, and its outcome is returned as-is. A caller with no verified
 *    identity is answered with a 4xx that says so; nothing here can answer "sent"
 *    without the service having sent.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/deliveries')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@Roles(OrgRole.ADMIN)
export class WhatsAppDeliveryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identities: WhatsAppIdentityService,
    private readonly deliveries: WhatsAppDeliveryService,
  ) {}

  /** Recent attempts for the caller's organization, newest first. */
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
  ): Promise<WhatsAppDeliveryView[]> {
    const organizationId = requireOrganization(user);
    const connectionIds = await this.visibleConnectionIds(organizationId);
    if (connectionIds.length === 0) return [];

    return this.prisma.whatsAppDelivery.findMany({
      where: { connectionId: { in: connectionIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: DELIVERY_HISTORY_LIMIT,
      select: {
        id: true,
        kind: true,
        reportDate: true,
        status: true,
        failureReason: true,
        sentAt: true,
        attempts: true,
      },
    });
  }

  /**
   * Send the daily report now, to the caller's own verified WhatsApp number.
   *
   * The recipient is the phone this administrator linked to their own user, so the
   * figures travel to the person asking for them and to nobody else. `sent`,
   * `failed` with a fixed reason and `already_attempted` are returned as the
   * service produced them; the missing-identity outcome is turned into a 409 so
   * the caller sees an actionable answer instead of a silent 200.
   */
  @Post('report')
  @HttpCode(200)
  async sendReport(
    @CurrentUser() user: RequestUser,
  ): Promise<WhatsAppDeliveryOutcome> {
    const organizationId = requireOrganization(user);
    const phone = await this.verifiedRecipient(user.userId, organizationId);
    if (!phone) throw noVerifiedIdentity();

    const outcome = await this.deliveries.onDemand({ organizationId, phone });
    if (outcome.status === 'no_identity') throw noVerifiedIdentity();
    return outcome;
  }

  /**
   * The phone the authenticated user verified inside their own organization.
   * `list` is already scoped by user and organization; only a VERIFIED row is a
   * recipient, and the oldest verification wins when a user linked several
   * numbers, so repeated calls do not alternate between two inboxes.
   */
  private async verifiedRecipient(
    userId: string,
    organizationId: string,
  ): Promise<string | null> {
    const identities = await this.identities.list(userId, organizationId);
    const verified = identities
      .filter((identity) => identity.status === 'VERIFIED')
      .sort(
        (left, right) =>
          (left.verifiedAt?.getTime() ?? 0) -
            (right.verifiedAt?.getTime() ?? 0) ||
          left.id.localeCompare(right.id),
      );
    return verified[0]?.phone ?? null;
  }

  /**
   * Which connections' deliveries this organization may read.
   *
   * A delivery row carries no organization of its own: the tenant signal is the
   * connection the attempt ran on. A connection owned by the organization is that
   * organization's alone. The central INTELLIGENCE connection has no owner, so its
   * rows are shown only when that connection speaks for exactly this organization
   * — the same resolution `WhatsAppDeliveryService.scheduledTarget` uses before it
   * sends. When two organizations have administrative identities, the central
   * rows belong to neither and are omitted rather than guessed: a short list is a
   * smaller problem than another tenant's send history.
   */
  private async visibleConnectionIds(
    organizationId: string,
  ): Promise<string[]> {
    const owned = await this.prisma.whatsAppConnection.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const connectionIds = owned.map((row) => row.id);

    const central = await this.prisma.whatsAppConnection.findFirst({
      where: { channel: 'INTELLIGENCE' },
      select: { id: true },
    });
    if (!central) return connectionIds;

    const audiences = await this.administrativeOrganizations();
    if (audiences.size === 1 && audiences.has(organizationId)) {
      connectionIds.push(central.id);
    }
    return connectionIds;
  }

  /**
   * The organizations the central connection would be speaking for: those with a
   * verified identity whose user holds OWNER or ADMIN there. Read from the
   * database per identity, so a person who administers another organization
   * contributes nothing to this one.
   */
  private async administrativeOrganizations(): Promise<Set<string>> {
    const identities = await this.prisma.whatsAppIdentity.findMany({
      where: { status: 'VERIFIED', organizationId: { not: null } },
      select: { userId: true, organizationId: true },
    });
    if (identities.length === 0) return new Set();

    const memberships = await this.prisma.organizationUser.findMany({
      where: {
        userId: { in: [...new Set(identities.map((row) => row.userId))] },
        role: { in: [...ADMINISTRATIVE_ROLES] },
      },
      select: { userId: true, organizationId: true },
    });
    const administrative = new Set(
      memberships.map((row) => `${row.organizationId}:${row.userId}`),
    );

    const organizations = new Set<string>();
    for (const row of identities) {
      if (!row.organizationId) continue;
      if (administrative.has(`${row.organizationId}:${row.userId}`)) {
        organizations.add(row.organizationId);
      }
    }
    return organizations;
  }
}

/**
 * A caller without an organization has no delivery history and no recipient, so
 * the request is refused instead of answered with an empty list or a send.
 */
function requireOrganization(user: RequestUser): string {
  if (!user.organizationId) throw new ForbiddenException();
  return user.organizationId;
}

/**
 * The fixed answer for "there is no verified number to send this to". The body
 * reuses the delivery vocabulary (`no_identity` / `no_recipient`) so the screen
 * renders one message for the same state whether it arrives from a send attempt
 * or from the history.
 */
function noVerifiedIdentity(): ConflictException {
  return new ConflictException({
    status: 'no_identity',
    reason: 'no_recipient',
  });
}
