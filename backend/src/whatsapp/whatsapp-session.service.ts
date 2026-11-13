import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WAHA_WEBHOOK_KEY } from './whatsapp-webhook.controller';
import {
  commercialSessionName,
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
  type WhatsAppSessionStatus,
} from './whatsapp-provider';
import { deriveWebhookKey } from './waha-signature';

/**
 * Which persisted channel an administrative call addresses. A caller names a
 * channel, never a session: the session name is always derived here, so a
 * request cannot address another organization's session by name.
 */
export type WhatsAppChannelScope =
  | { channel: 'COMMERCIAL'; organizationId: string | undefined }
  | { channel: 'INTELLIGENCE' };

interface ResolvedChannel {
  connectionId: string;
  sessionName: string;
  webhookKey: string;
}

/** The commercial channel always belongs to one organization, never to none. */
function requireOrganization(organizationId: string | undefined): string {
  if (!organizationId) throw new ForbiddenException();
  return organizationId;
}

/**
 * Shared channel service for both WAHA sessions: it resolves the persisted
 * connection, derives that session's webhook key, drives the provider and
 * mirrors the reported status back onto the row the webhook resolves from.
 * Controllers only decide who may address which channel.
 */
@Injectable()
export class WhatsAppSessionService {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly connections: WhatsAppConnectionsService,
    @Inject(WAHA_WEBHOOK_KEY) private readonly masterKey: string | undefined,
  ) {}

  /** Create the session when missing, start it, and persist the observed state. */
  async connect(
    scope: WhatsAppChannelScope,
  ): Promise<{ status: WhatsAppSessionStatus }> {
    const channel = await this.resolve(scope);
    await this.provider.ensureStarted(channel.sessionName, channel.webhookKey);
    return this.mirror(channel);
  }

  async status(
    scope: WhatsAppChannelScope,
  ): Promise<{ status: WhatsAppSessionStatus }> {
    return this.mirror(await this.resolve(scope));
  }

  async qr(scope: WhatsAppChannelScope): Promise<{ data: string }> {
    const { sessionName } = await this.resolve(scope);
    return this.provider.qr(sessionName);
  }

  /**
   * The console's read model: provider truth first, then the row the webhook
   * resolves from. A screen must never show a status the session already left,
   * and must be able to name the linked number and when it was last observed.
   */
  async describe(scope: WhatsAppChannelScope): Promise<{
    status: WhatsAppSessionStatus;
    accountId: string | null;
    sessionName: string;
    lastObservedAt: Date | null;
  }> {
    const channel = await this.resolve(scope);
    const { status } = await this.mirror(channel);
    const row = await this.connections.findById(channel.connectionId);
    if (!row) throw new NotFoundException();
    return {
      status,
      accountId: row.accountId,
      sessionName: row.sessionName,
      lastObservedAt: row.statusUpdatedAt,
    };
  }

  async stop(scope: WhatsAppChannelScope): Promise<void> {
    const channel = await this.resolve(scope);
    await this.provider.stop(channel.sessionName);
    await this.mirror(channel);
  }

  async restart(scope: WhatsAppChannelScope): Promise<void> {
    const channel = await this.resolve(scope);
    await this.provider.restart(channel.sessionName);
    await this.mirror(channel);
  }

  /**
   * Unlink a number while keeping its session record. Only the central channel
   * may be logged out: unlinking the commercial number from a distant machine
   * would leave customers unanswered until someone reaches the phone.
   */
  async logout(): Promise<void> {
    const channel = await this.resolve({ channel: 'INTELLIGENCE' });
    await this.provider.logout(channel.sessionName);
    await this.mirror(channel);
  }

  /**
   * Unlink and start again as one operation. Chaining `logout` and `connect`
   * from a screen would let a failed second call leave the central number
   * unlinked with nobody watching, so the order and the failure are owned here:
   * when the unlink is refused, the session is never started again.
   */
  async relink(): Promise<{ status: WhatsAppSessionStatus }> {
    const channel = await this.resolve({ channel: 'INTELLIGENCE' });
    await this.provider.logout(channel.sessionName);
    await this.provider.ensureStarted(channel.sessionName, channel.webhookKey);
    return this.mirror(channel);
  }

  private async resolve(scope: WhatsAppChannelScope): Promise<ResolvedChannel> {
    const organizationId =
      scope.channel === 'COMMERCIAL'
        ? requireOrganization(scope.organizationId)
        : null;
    const sessionName = organizationId
      ? commercialSessionName(organizationId)
      : INTELLIGENCE_SESSION;
    // One master secret derives a distinct webhook key per session. Without it
    // no key can be derived, and a session started unsigned would accept
    // unverifiable events: fail closed before touching the registry.
    const webhookKey = deriveWebhookKey(this.masterKey, sessionName);
    if (!webhookKey) throw new ForbiddenException();
    const connection = organizationId
      ? await this.connections.getOrCreateCommercial(organizationId)
      : await this.connections.getOrCreateIntelligence();
    return { connectionId: connection.id, sessionName, webhookKey };
  }

  /**
   * Persist what the provider actually reports rather than assuming the state a
   * command implies. The row is the durable record the webhook resolves from,
   * so it must not drift from the session it describes.
   *
   * `accountId` is the linked identity, and losing it on a transient status would
   * make the row lie about a number that is still linked. It is therefore kept
   * (left untouched) across STARTING, SCAN_QR_CODE, PASSKEY_*, STOPPED and FAILED,
   * and cleared only when the provider explicitly reports no identity while the
   * session is otherwise healthy (`WORKING`). An unreadable identity preserves
   * the last known value instead of clearing it.
   */
  private async mirror(
    channel: ResolvedChannel,
  ): Promise<{ status: WhatsAppSessionStatus }> {
    const { status } = await this.provider.status(channel.sessionName);
    const accountId = await this.linkedAccount(status, channel.sessionName);
    await this.connections.recordStatus(
      channel.connectionId,
      status,
      accountId,
    );
    return { status };
  }

  /**
   * The linked WhatsApp account. `undefined` means "leave the stored value
   * alone": a transient status and an unreadable identity both preserve the last
   * known account, while a healthy session that reports no identity returns null
   * so the row is cleared. An unreadable identity must not fail an otherwise
   * successful operation.
   */
  private async linkedAccount(
    status: WhatsAppSessionStatus,
    sessionName: string,
  ): Promise<string | null | undefined> {
    if (status !== 'WORKING') return undefined;
    try {
      return (await this.provider.me(sessionName)).accountId;
    } catch {
      return undefined;
    }
  }
}
