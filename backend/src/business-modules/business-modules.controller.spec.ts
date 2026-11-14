import { BadRequestException } from '@nestjs/common';
import { BusinessModulesController } from './business-modules.controller';

describe('BusinessModulesController', () => {
  const modules = { getForOrganization: jest.fn() };
  const controller = new BusinessModulesController(modules as never);

  it('reads module state for the authenticated organization', async () => {
    modules.getForOrganization.mockResolvedValue({ enabled: true });
    await expect(
      controller.find({ organizationId: 'org-1' } as never),
    ).resolves.toEqual({ enabled: true });
    expect(modules.getForOrganization).toHaveBeenCalledWith(
      'org-1',
      'vehicles',
    );
  });

  it('rejects missing organization context without reading module state', async () => {
    modules.getForOrganization.mockClear();
    await expect(controller.find({} as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(modules.getForOrganization).not.toHaveBeenCalled();
  });
});
