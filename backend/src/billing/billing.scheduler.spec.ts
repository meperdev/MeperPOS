import { BillingScheduler } from './billing.scheduler';
import { OrgStatus } from '@prisma/client';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { TIMEZONE } from '../common/constants/locale.constants';

describe('BillingScheduler', () => {
  let scheduler: BillingScheduler;

  const prismaMock = {
    organization: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    organizationUser: {
      findMany: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    user: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new BillingScheduler(prismaMock as never);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  it('is wired for midnight in America/Bogota, not 19:00 local', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      BillingScheduler.prototype.handleBillingTransitions,
    ) as { cronTime: string; timeZone: string };

    expect(options).toEqual({ cronTime: '0 0 * * *', timeZone: TIMEZONE });
    expect(TIMEZONE).toBe('America/Bogota');
  });

  describe('handleBillingTransitions', () => {
    it('does not update organizations when trials have expired', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      prismaMock.organization.findMany.mockResolvedValueOnce([
        {
          id: 'org-trial-1',
          status: OrgStatus.TRIAL,
          trialEndsAt: yesterday,
        },
      ]);

      await scheduler.handleBillingTransitions();

      expect(prismaMock.organization.update).not.toHaveBeenCalled();
      expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('does not update organizations when past-due period has exceeded 15 days', async () => {
      const sixteenDaysAgo = new Date();
      sixteenDaysAgo.setDate(sixteenDaysAgo.getDate() - 16);

      prismaMock.organization.findMany.mockResolvedValueOnce([
        {
          id: 'org-pastdue-1',
          status: OrgStatus.PAST_DUE,
          pastDueAt: sixteenDaysAgo,
        },
      ]);

      await scheduler.handleBillingTransitions();

      expect(prismaMock.organization.update).not.toHaveBeenCalled();
      expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    });

    it('does not query organizations when scheduler runs', async () => {
      await scheduler.handleBillingTransitions();

      expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
    });

    it('keeps expired trial organizations in TRIAL status', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      prismaMock.organization.findMany.mockResolvedValueOnce([
        {
          id: 'org-trial-1',
          status: OrgStatus.TRIAL,
          trialEndsAt: yesterday,
        },
      ]);

      await scheduler.handleBillingTransitions();

      expect(prismaMock.organization.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-trial-1' },
          data: expect.objectContaining({ status: OrgStatus.PAST_DUE }),
        }),
      );
    });

    it('keeps overdue organizations in PAST_DUE status', async () => {
      const sixteenDaysAgo = new Date();
      sixteenDaysAgo.setDate(sixteenDaysAgo.getDate() - 16);

      prismaMock.organization.findMany.mockResolvedValueOnce([
        {
          id: 'org-pastdue-1',
          status: OrgStatus.PAST_DUE,
          pastDueAt: sixteenDaysAgo,
        },
      ]);

      await scheduler.handleBillingTransitions();

      expect(prismaMock.organization.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-pastdue-1' },
          data: { status: OrgStatus.SUSPENDED },
        }),
      );
    });
  });
});
