import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TIMEZONE } from '../common/constants/locale.constants';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(private prisma: PrismaService) {}

  // Midnight on the shop's calendar, not UTC midnight — without the zone the
  // job fired at 19:00 in Bogotá, five hours before its own day began.
  @Cron('0 0 * * *', { timeZone: TIMEZONE })
  async handleBillingTransitions() {
    // Automatic billing transitions are disabled by design.
    // Organization statuses must only change through manual admin action
    // (PATCH /admin/organizations/:id/status) or explicit payment recording.
    // The cron decorator is preserved so the job remains registered and
    // observable, and this guard can be removed to restore automatic transitions.
    this.logger.log('Billing transitions skipped: manual billing only');
  }
}
