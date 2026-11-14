import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BusinessModulesService } from './business-modules.service';
import type { BusinessModuleId } from './module-catalog';

describe('BusinessModulesService', () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    organizationModule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
  let service: BusinessModulesService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.organizationModule.findMany.mockResolvedValue([]);
    service = new BusinessModulesService(prisma as never);
  });

  describe('isEnabled', () => {
    it('treats a module without a stored row as enabled', async () => {
      prisma.organizationModule.findUnique.mockResolvedValue(null);
      await expect(service.isEnabled('org-1', 'vehicles')).resolves.toBe(true);
      expect(prisma.organizationModule.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_module: {
            organizationId: 'org-1',
            module: 'vehicles',
          },
        },
      });
    });

    it('isolates a disabled module to its organization', async () => {
      prisma.organizationModule.findUnique
        .mockResolvedValueOnce({ enabled: false })
        .mockResolvedValueOnce({ enabled: true });
      await expect(service.isEnabled('org-1', 'vehicles')).resolves.toBe(false);
      await expect(service.isEnabled('org-2', 'vehicles')).resolves.toBe(true);
    });

    it('rejects absent organization scope', async () => {
      await expect(service.isEnabled('', 'vehicles')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.organizationModule.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a module outside the catalog instead of assuming it is enabled', async () => {
      await expect(
        service.isEnabled('org-1', 'payroll' as BusinessModuleId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.organizationModule.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('listForOrganization', () => {
    it('returns the whole catalog with the stored state', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.organizationModule.findMany.mockResolvedValue([
        { module: 'vehicles', enabled: false },
      ]);

      const modules = await service.listForOrganization('org-1');

      expect(modules).toEqual([
        {
          id: 'vehicles',
          name: 'Vehículos',
          description: expect.any(String) as string,
          enabled: false,
        },
      ]);
      expect(prisma.organizationModule.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
    });

    it('reports a module with no stored row as enabled', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      const modules = await service.listForOrganization('org-1');
      expect(modules.every((module) => module.enabled)).toBe(true);
    });

    it('rejects reads for organizations that do not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.listForOrganization('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setEnabled', () => {
    it('updates only the specified organization and module without deleting data', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.organizationModule.upsert.mockResolvedValue({
        organizationId: 'org-1',
        module: 'vehicles',
        enabled: false,
      });

      await expect(
        service.setEnabled('org-1', 'vehicles', false),
      ).resolves.toEqual({
        id: 'vehicles',
        name: 'Vehículos',
        description: expect.any(String) as string,
        enabled: false,
      });
      expect(prisma.organizationModule.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_module: {
            organizationId: 'org-1',
            module: 'vehicles',
          },
        },
        create: { organizationId: 'org-1', module: 'vehicles', enabled: false },
        update: { enabled: false },
      });
    });

    it('rejects a module outside the catalog without writing', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      await expect(
        service.setEnabled('org-1', 'payroll', true),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.organizationModule.upsert).not.toHaveBeenCalled();
    });

    it('rejects missing organizations without writing', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.setEnabled('missing', 'vehicles', true),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.organizationModule.upsert).not.toHaveBeenCalled();
    });
  });

  describe('enabledModulesByOrganization', () => {
    it('answers every organization in one query, ignoring modules outside the catalog', async () => {
      prisma.organizationModule.findMany.mockResolvedValue([
        { organizationId: 'org-1', module: 'vehicles', enabled: false },
        { organizationId: 'org-1', module: 'retired-module', enabled: true },
        { organizationId: 'org-2', module: 'vehicles', enabled: true },
      ]);

      const enabled = await service.enabledModulesByOrganization([
        'org-1',
        'org-2',
      ]);

      expect(enabled.get('org-1')).toEqual([]);
      expect(enabled.get('org-2')).toEqual(['vehicles']);
      expect(prisma.organizationModule.findMany).toHaveBeenCalledTimes(1);
    });

    it('does not query when there is nothing to annotate', async () => {
      await expect(service.enabledModulesByOrganization([])).resolves.toEqual(
        new Map(),
      );
      expect(prisma.organizationModule.findMany).not.toHaveBeenCalled();
    });
  });
});
