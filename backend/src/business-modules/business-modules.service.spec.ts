import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BusinessModulesService } from './business-modules.service';

describe('BusinessModulesService', () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    organizationModule: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  let service: BusinessModulesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new BusinessModulesService(prisma as never);
  });

  it('treats the existing vehicle capability as enabled until explicitly changed', async () => {
    prisma.organizationModule.findUnique.mockResolvedValue(null);
    await expect(service.isEnabled('org-1', 'vehicles')).resolves.toBe(true);
    expect(prisma.organizationModule.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_module: { organizationId: 'org-1', module: 'vehicles' },
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
      organizationId: 'org-1',
      module: 'vehicles',
      enabled: false,
    });
    expect(prisma.organizationModule.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_module: { organizationId: 'org-1', module: 'vehicles' },
      },
      create: { organizationId: 'org-1', module: 'vehicles', enabled: false },
      update: { enabled: false },
    });
  });

  it('rejects reads for organizations that do not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    await expect(
      service.getForOrganization('missing', 'vehicles'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects missing organizations without writing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    await expect(
      service.setEnabled('missing', 'vehicles', true),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.organizationModule.upsert).not.toHaveBeenCalled();
  });
});
