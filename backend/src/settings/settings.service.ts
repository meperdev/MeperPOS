import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CORE_KEY_SET, SYSTEM_KEY_SET, type SettingsView } from './schema';
import { DEFAULT_INVOICING, DEFAULT_LOCALE } from './defaults';
import { validateInvoicing } from './validator';

/** Type guard for plain objects (Prisma `Json` values come back as objects). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Surfaces the free-form `custom` section plus any unknown ad-hoc keys that
 * still live at the root of the persisted blob.
 */
export function extractCustom(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const custom: Record<string, unknown> = isRecord(settings.custom)
    ? { ...settings.custom }
    : {};

  for (const [key, value] of Object.entries(settings)) {
    if (CORE_KEY_SET.has(key) || SYSTEM_KEY_SET.has(key) || key === 'custom') {
      continue;
    }
    custom[key] = value;
  }

  return custom;
}

/**
 * Merge-on-write helper. Never full-replaces:
 *
 * - system keys (`downgradeFlags`) are copied through untouched;
 * - typed core params (`printHeader`, `printFooter`) are overlaid from `incoming`;
 * - `custom` is merged key-by-key;
 * - unknown persisted root keys are normalized into `custom` (no data loss).
 */
export function mergeSettingsJson(
  existing: Record<string, unknown>,
  incoming: UpdateSettingsDto,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(existing)) {
    if (SYSTEM_KEY_SET.has(key)) {
      next[key] = value;
    } else if (CORE_KEY_SET.has(key)) {
      next[key] = value;
    } else if (key === 'custom') {
      if (isRecord(value)) Object.assign(custom, value);
    } else {
      custom[key] = value;
    }
  }

  if (incoming.printHeader !== undefined)
    next.printHeader = incoming.printHeader;
  if (incoming.printFooter !== undefined)
    next.printFooter = incoming.printFooter;
  if (incoming.custom !== undefined && isRecord(incoming.custom)) {
    Object.assign(custom, incoming.custom);
  }

  if (Object.keys(custom).length > 0) next.custom = custom;

  return next;
}

/**
 * Applies a system-key overlay (e.g. `downgradeFlags`) onto existing settings
 * for write paths outside the user-facing settings PUT (e.g. `admin.updatePlan`).
 * Preserves every user-owned key; only the given system keys are overlaid.
 */
export function applySystemKeys(
  existing: Record<string, unknown>,
  systemKeys: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...systemKeys };
}

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Single read path for organization settings.
   * Hydrates `Organization` (name/logoUrl/settings/version) + the SALE
   * sequence prefix into a `SettingsView`, applying defaults on invalid values.
   */
  async find(organizationId?: string): Promise<SettingsView> {
    if (!organizationId) {
      return this.buildDefaultView();
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
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

    if (!org) {
      return this.buildDefaultView();
    }

    const prefix = await this.readSalePrefix(organizationId);

    return this.buildView(
      org,
      isRecord(org.settings) ? org.settings : {},
      prefix,
    );
  }

  /**
   * Merge-on-write with optimistic locking.
   *
   * Reads the current `settingsVersion`, overlays typed params + `custom` onto
   * the existing blob (never full-replace), then writes via `updateMany`
   * guarded by that version. A concurrent write yields `count === 0` → 409.
   */
  async update(
    organizationId: string | undefined,
    dto: UpdateSettingsDto,
  ): Promise<SettingsView> {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }

    this.assertNoSystemKeyWrites(dto);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
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

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const existing = isRecord(org.settings) ? org.settings : {};
    const merged = mergeSettingsJson(existing, dto);

    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, settingsVersion: org.settingsVersion },
      data: {
        settings: merged as Prisma.InputJsonValue,
        settingsVersion: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'Settings were modified concurrently. Please reload and try again.',
      );
    }

    const prefix = await this.readSalePrefix(organizationId);

    return this.buildView(org, merged, prefix);
  }

  async updateOrganizationName(
    organizationId: string | undefined,
    name: string,
  ): Promise<SettingsView> {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }

    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      throw new BadRequestException('Organization name cannot be empty');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name: trimmed },
    });

    return this.find(organizationId);
  }

  async updateSalePrefix(
    organizationId: string | undefined,
    prefix: string | undefined,
  ): Promise<SettingsView> {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }

    const trimmed = typeof prefix === 'string' ? prefix.trim() : '';
    const value = trimmed.length > 0 ? trimmed : null;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const sequence = await this.prisma.organizationSequence.findFirst({
      where: { organizationId, type: 'SALE' },
      orderBy: { year: 'desc' },
    });

    if (sequence) {
      await this.prisma.organizationSequence.update({
        where: { id: sequence.id },
        data: { prefix: value },
      });
    } else {
      await this.prisma.organizationSequence.create({
        data: {
          organizationId,
          type: 'SALE',
          currentNumber: 0,
          year: new Date().getFullYear(),
          prefix: value,
        },
      });
    }

    return this.find(organizationId);
  }

  getDefaultSettings(): SettingsView {
    return this.buildDefaultView();
  }

  async uploadLogo(
    organizationId: string | undefined,
    file: Express.Multer.File,
  ): Promise<{ logoUrl: string }> {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const logoUrl = await this.cloudinaryService.uploadImage(file, 'logos');

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { logoUrl },
    });

    return { logoUrl };
  }

  private async readSalePrefix(organizationId: string): Promise<string | null> {
    const sequence = await this.prisma.organizationSequence.findFirst({
      where: { organizationId, type: 'SALE' },
      orderBy: { year: 'desc' },
      select: { prefix: true },
    });
    return sequence?.prefix ?? null;
  }

  private assertNoSystemKeyWrites(dto: UpdateSettingsDto): void {
    const payload = dto as Record<string, unknown>;
    for (const key of SYSTEM_KEY_SET) {
      if (key in payload && payload[key] !== undefined) {
        throw new BadRequestException(
          `Setting '${key}' is system-managed and cannot be updated`,
        );
      }
    }
  }

  private buildView(
    organization: {
      name: string;
      logoUrl: string | null;
      taxId: string | null;
      phone: string | null;
      address: string | null;
    },
    settings: Record<string, unknown>,
    prefix: string | null,
  ): SettingsView {
    return {
      organization: {
        name: organization.name,
        logoUrl: organization.logoUrl,
        taxId: organization.taxId ?? null,
        phone: organization.phone ?? null,
        address: organization.address ?? null,
      },
      invoicing: validateInvoicing(settings),
      receipt: { prefix },
      locale: { ...DEFAULT_LOCALE },
      custom: extractCustom(settings),
    };
  }

  private buildDefaultView(): SettingsView {
    return {
      organization: {
        name: '',
        logoUrl: null,
        taxId: null,
        phone: null,
        address: null,
      },
      invoicing: { ...DEFAULT_INVOICING },
      receipt: { prefix: null },
      locale: { ...DEFAULT_LOCALE },
      custom: {},
    };
  }
}
