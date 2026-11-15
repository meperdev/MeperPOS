import { BadRequestException } from '@nestjs/common';
import { BusinessModulesController } from './business-modules.controller';

describe('BusinessModulesController', () => {
  const modules = { listForOrganization: jest.fn() };
  const controller = new BusinessModulesController(modules as never);

  it('lists the catalog for the authenticated organization', async () => {
    const catalog = [
      { id: 'vehicles', name: 'Vehículos', description: '...', enabled: true },
    ];
    modules.listForOrganization.mockResolvedValue(catalog);

    await expect(
      controller.findAll({ organizationId: 'org-1' } as never),
    ).resolves.toEqual(catalog);
    expect(modules.listForOrganization).toHaveBeenCalledWith('org-1');
  });

  it('rejects missing organization context without reading module state', async () => {
    modules.listForOrganization.mockClear();
    await expect(controller.findAll({} as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(modules.listForOrganization).not.toHaveBeenCalled();
  });
});
