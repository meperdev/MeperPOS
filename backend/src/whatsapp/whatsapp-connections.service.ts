import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { WhatsAppSessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The single central administrative channel; never derived from an organization. */
export const INTELLIGENCE_SESSION = 'meper-intelligence';

/**
 * One commercial session per organization. Derived, never caller-supplied, so a
 * request cannot address another tenant's session by name.
 */
export function commercialSessionName(organizationId: string): string {
  return `meper-commercial-${createHash('sha256')
    .update(organizationId)
    .digest('hex')
    .slice(0, 32)}`;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'P2002';

@Injectable()
export class WhatsAppConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the persisted channel for a provider event. Never trusted before verification. */
  findBySessionName(sessionName: string) {
    return this.prisma.whatsAppConnection.findUnique({
      where: { sessionName },
    });
  }

  getOrCreateCommercial(organizationId: string) {
    const sessionName = commercialSessionName(organizationId);
    return this.prisma.whatsAppConnection.upsert({
      where: { sessionName },
      create: { sessionName, channel: 'COMMERCIAL', organizationId },
      update: {},
    });
  }

  /**
   * The central channel is unique across the whole deployment. A concurrent
   * create loses on the partial unique index and adopts the winner.
   */
  async getOrCreateIntelligence() {
    const existing = await this.prisma.whatsAppConnection.findFirst({
      where: { channel: 'INTELLIGENCE' },
    });
    if (existing) return existing;
    try {
      return await this.prisma.whatsAppConnection.create({
        data: {
          sessionName: INTELLIGENCE_SESSION,
          channel: 'INTELLIGENCE',
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.whatsAppConnection.findFirst({
        where: { channel: 'INTELLIGENCE' },
      });
      if (!winner) throw error;
      return winner;
    }
  }

  recordStatus(
    connectionId: string,
    status: WhatsAppSessionStatus,
    accountId?: string | null,
  ) {
    return this.prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: {
        status,
        statusUpdatedAt: new Date(),
        ...(accountId === undefined ? {} : { accountId }),
      },
    });
  }
}
