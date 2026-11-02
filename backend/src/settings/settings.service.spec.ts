import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SettingsService, applySystemKeys } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;

  const prismaMock = {
    organization: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    organizationSequence: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const cloudinaryMock = {
    uploadImage: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SettingsService(prismaMock as never, cloudinaryMock as never);
  });

  describe('find', () => {
    it('hydrates a full SettingsView from Organization + SALE sequence', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        logoUrl: 'https://cdn/acme.png',
        taxId: '900123456-7',
        phone: '+57 300 123 4567',
        address: 'Calle 1 # 2-3',
        settings: {
          printHeader: 'Acme - Comprobante',
          printFooter: 'Gracias por su compra',
          downgradeFlags: { usersOverLimit: true },
          custom: { theme: 'dark' },
          legacyKey: 'preserved',
        },
        settingsVersion: 2,
      });
      prismaMock.organizationSequence.findFirst.mockResolvedValue({
        prefix: 'ACME',
      });

      const result = await service.find('org-1');

      expect(prismaMock.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        select: {
          name: true,
          logoUrl: true,
          taxId: true,
          phone: true,
          address: true,
          settings: true,
          settingsVersion: true,
        },
      });
      expect(prismaMock.organizationSequence.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', type: 'SALE' },
        orderBy: { year: 'desc' },
        select: { prefix: true },
      });
      expect(result).toEqual({
        organization: {
          name: 'Acme Corp',
          logoUrl: 'https://cdn/acme.png',
          taxId: '900123456-7',
          phone: '+57 300 123 4567',
          address: 'Calle 1 # 2-3',
        },
        invoicing: {
          printHeader: 'Acme - Comprobante',
          printFooter: 'Gracias por su compra',
        },
        receipt: { prefix: 'ACME' },
        locale: {
          currency: 'COP',
          locale: 'es-CO',
          timezone: 'America/Bogota',
        },
        custom: { theme: 'dark', legacyKey: 'preserved' },
      });
    });

    it('falls back to defaults for invalid persisted values (no throw)', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        logoUrl: null,
        settings: { printHeader: 123, printFooter: null },
        settingsVersion: 0,
      });
      prismaMock.organizationSequence.findFirst.mockResolvedValue(null);

      const result = await service.find('org-1');

      expect(result.invoicing).toEqual({ printHeader: '', printFooter: '' });
      expect(result.receipt.prefix).toBeNull();
    });

    it('returns a default view when the organization is not found', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      const result = await service.find('org-1');

      expect(result).toEqual({
        organization: {
          name: '',
          logoUrl: null,
          taxId: null,
          phone: null,
          address: null,
        },
        invoicing: { printHeader: '', printFooter: '' },
        receipt: { prefix: null },
        locale: {
          currency: 'COP',
          locale: 'es-CO',
          timezone: 'America/Bogota',
        },
        custom: {},
      });
    });

    it('returns a default view without an organizationId and skips the query', async () => {
      const result = await service.find(undefined);

      expect(result.organization.name).toBe('');
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('merges typed params into existing settings without full-replace', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        logoUrl: null,
        settings: {
          printHeader: 'Old Header',
          downgradeFlags: { usersOverLimit: false },
          custom: { theme: 'light' },
          legacyKey: 'keep-me',
        },
        settingsVersion: 4,
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.organizationSequence.findFirst.mockResolvedValue({
        prefix: 'ACME',
      });

      const result = await service.update('org-1', {
        printFooter: 'New Footer',
      } as never);

      expect(prismaMock.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-1', settingsVersion: 4 },
        data: {
          settings: {
            printHeader: 'Old Header',
            downgradeFlags: { usersOverLimit: false },
            printFooter: 'New Footer',
            custom: { theme: 'light', legacyKey: 'keep-me' },
          },
          settingsVersion: { increment: 1 },
        },
      });
      expect(result.invoicing.printFooter).toBe('New Footer');
      expect(result.receipt.prefix).toBe('ACME');
    });

    it('overlays custom without dropping existing custom keys', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        logoUrl: null,
        settings: { custom: { theme: 'light' } },
        settingsVersion: 1,
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.organizationSequence.findFirst.mockResolvedValue(null);

      await service.update('org-1', { custom: { lang: 'es' } } as never);

      expect(prismaMock.organization.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            settings: expect.objectContaining({
              custom: { theme: 'light', lang: 'es' },
            }),
          }),
        }),
      );
    });

    it('rejects writes to the downgradeFlags system key', async () => {
      await expect(
        service.update('org-1', {
          downgradeFlags: { usersOverLimit: true },
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the optimistic lock detects a concurrent write', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        name: 'Acme Corp',
        logoUrl: null,
        settings: {},
        settingsVersion: 2,
      });
      prismaMock.organization.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('org-1', { printHeader: 'X' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when the organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.update('org-1', { printHeader: 'X' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException without an organizationId', async () => {
      await expect(
        service.update(undefined, {} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('uploadLogo', () => {
    it('writes the URL to Organization.logoUrl (top-level)', async () => {
      const file = { originalname: 'logo.png' } as Express.Multer.File;
      cloudinaryMock.uploadImage.mockResolvedValue('https://cdn/logo.png');
      prismaMock.organization.update.mockResolvedValue({
        id: 'org-1',
        logoUrl: 'https://cdn/logo.png',
      });

      const result = await service.uploadLogo('org-1', file);

      expect(cloudinaryMock.uploadImage).toHaveBeenCalledWith(file, 'logos');
      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { logoUrl: 'https://cdn/logo.png' },
      });
      expect(result).toEqual({ logoUrl: 'https://cdn/logo.png' });
    });

    it('throws BadRequestException when no file is provided', async () => {
      await expect(
        service.uploadLogo('org-1', undefined as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException without an organizationId', async () => {
      await expect(
        service.uploadLogo(undefined, {} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateOrganizationName', () => {
    it('trims and persists the name, returning the refreshed view', async () => {
      prismaMock.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1' })
        .mockResolvedValue({
          name: 'Acme Corp',
          logoUrl: null,
          settings: {},
          settingsVersion: 0,
        });
      prismaMock.organization.update.mockResolvedValue({ id: 'org-1' });
      prismaMock.organizationSequence.findFirst.mockResolvedValue(null);

      const result = await service.updateOrganizationName(
        'org-1',
        '  Acme Corp  ',
      );

      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'Acme Corp' },
      });
      expect(result.organization.name).toBe('Acme Corp');
    });

    it('throws BadRequestException for an empty or whitespace-only name', async () => {
      await expect(
        service.updateOrganizationName('org-1', '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.organization.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException without an organizationId', async () => {
      await expect(
        service.updateOrganizationName(undefined, 'Acme'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOrganizationName('missing', 'Acme'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSalePrefix', () => {
    it('updates the prefix of the latest SALE sequence (mirrors readSalePrefix)', async () => {
      prismaMock.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1' })
        .mockResolvedValue({
          name: 'Acme',
          logoUrl: null,
          settings: {},
          settingsVersion: 0,
        });
      prismaMock.organizationSequence.findFirst
        .mockResolvedValueOnce({ id: 'seq-1' })
        .mockResolvedValue({ prefix: 'REC-' });
      prismaMock.organizationSequence.update.mockResolvedValue({
        id: 'seq-1',
        prefix: 'REC-',
      });

      const result = await service.updateSalePrefix('org-1', ' REC- ');

      expect(prismaMock.organizationSequence.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', type: 'SALE' },
        orderBy: { year: 'desc' },
      });
      expect(prismaMock.organizationSequence.update).toHaveBeenCalledWith({
        where: { id: 'seq-1' },
        data: { prefix: 'REC-' },
      });
      expect(result.receipt.prefix).toBe('REC-');
    });

    it('clears the prefix to null when the value is empty or whitespace', async () => {
      prismaMock.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1' })
        .mockResolvedValue({
          name: 'Acme',
          logoUrl: null,
          settings: {},
          settingsVersion: 0,
        });
      prismaMock.organizationSequence.findFirst
        .mockResolvedValueOnce({ id: 'seq-1' })
        .mockResolvedValue({ prefix: null });
      prismaMock.organizationSequence.update.mockResolvedValue({
        id: 'seq-1',
        prefix: null,
      });

      await service.updateSalePrefix('org-1', '   ');

      expect(prismaMock.organizationSequence.update).toHaveBeenCalledWith({
        where: { id: 'seq-1' },
        data: { prefix: null },
      });
    });

    it('creates a current-year SALE sequence when none exists yet', async () => {
      prismaMock.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-1' })
        .mockResolvedValue({
          name: 'Acme',
          logoUrl: null,
          settings: {},
          settingsVersion: 0,
        });
      prismaMock.organizationSequence.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ prefix: 'REC-' });
      prismaMock.organizationSequence.create.mockResolvedValue({ id: 'seq-2' });

      await service.updateSalePrefix('org-1', 'REC-');

      expect(prismaMock.organizationSequence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          type: 'SALE',
          currentNumber: 0,
          prefix: 'REC-',
        }),
      });
    });

    it('throws BadRequestException without an organizationId', async () => {
      await expect(
        service.updateSalePrefix(undefined, 'REC-'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the organization does not exist', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSalePrefix('missing', 'REC-'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getDefaultSettings', () => {
    it('returns the defaults registry as a SettingsView', () => {
      expect(service.getDefaultSettings()).toEqual({
        organization: {
          name: '',
          logoUrl: null,
          taxId: null,
          phone: null,
          address: null,
        },
        invoicing: { printHeader: '', printFooter: '' },
        receipt: { prefix: null },
        locale: {
          currency: 'COP',
          locale: 'es-CO',
          timezone: 'America/Bogota',
        },
        custom: {},
      });
    });
  });
});

describe('applySystemKeys', () => {
  it('preserves user-owned keys and overlays system keys', () => {
    const existing = {
      printHeader: 'Mi Negocio',
      printFooter: 'Gracias',
      custom: { loyalty: 'true' },
    };

    const result = applySystemKeys(existing, { downgradeFlags: { users: 2 } });

    expect(result).toEqual({
      printHeader: 'Mi Negocio',
      printFooter: 'Gracias',
      custom: { loyalty: 'true' },
      downgradeFlags: { users: 2 },
    });
  });

  it('does not mutate the existing object', () => {
    const existing = { printHeader: 'A' };
    applySystemKeys(existing, { downgradeFlags: {} });

    expect(existing).toEqual({ printHeader: 'A' });
    expect(existing).not.toHaveProperty('downgradeFlags');
  });
});
