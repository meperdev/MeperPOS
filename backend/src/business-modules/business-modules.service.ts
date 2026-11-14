import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BUSINESS_MODULE_CATALOG,
  BusinessModuleId,
  findModuleDefinition,
} from './module-catalog';

export interface OrganizationModuleState {
  id: BusinessModuleId;
  name: string;
  description: string;
  enabled: boolean;
}

interface ModuleRow {
  module: string;
  enabled: boolean;
}

@Injectable()
export class BusinessModulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A module with no stored row keeps its historical behavior: enabled. Only
   * an explicit SuperAdmin decision turns a capability off. An id outside the
   * catalog is a call-site defect, never an implicit enable.
   */
  async isEnabled(
    organizationId: string,
    moduleId: BusinessModuleId,
  ): Promise<boolean> {
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required');
    }
    this.requireModule(moduleId);
    const setting = await this.prisma.organizationModule.findUnique({
      where: { organizationId_module: { organizationId, module: moduleId } },
    });
    return setting?.enabled ?? true;
  }

  async listForOrganization(
    organizationId: string,
  ): Promise<OrganizationModuleState[]> {
    await this.requireOrganization(organizationId);
    const rows = await this.prisma.organizationModule.findMany({
      where: { organizationId },
    });
    return this.projectCatalog(rows);
  }

  async setEnabled(
    organizationId: string,
    moduleId: string,
    enabled: boolean,
  ): Promise<OrganizationModuleState> {
    const definition = this.requireModule(moduleId);
    await this.requireOrganization(organizationId);
    await this.prisma.organizationModule.upsert({
      where: { organizationId_module: { organizationId, module: moduleId } },
      create: { organizationId, module: moduleId, enabled },
      update: { enabled },
    });
    return { ...definition, enabled };
  }

  /**
   * Enabled module ids for several organizations in one query, so the admin
   * listing never issues a read per row.
   */
  async enabledModulesByOrganization(
    organizationIds: string[],
  ): Promise<Map<string, BusinessModuleId[]>> {
    const enabledByOrganization = new Map<string, BusinessModuleId[]>();
    for (const organizationId of organizationIds) {
      enabledByOrganization.set(
        organizationId,
        BUSINESS_MODULE_CATALOG.map((module) => module.id),
      );
    }
    if (organizationIds.length === 0) return enabledByOrganization;

    const rows = await this.prisma.organizationModule.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, module: true, enabled: true },
    });

    const disabledByOrganization = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.enabled) continue;
      const disabled =
        disabledByOrganization.get(row.organizationId) ?? new Set();
      disabled.add(row.module);
      disabledByOrganization.set(row.organizationId, disabled);
    }

    for (const [organizationId, disabled] of disabledByOrganization) {
      const enabled = enabledByOrganization.get(organizationId) ?? [];
      enabledByOrganization.set(
        organizationId,
        enabled.filter((moduleId) => !disabled.has(moduleId)),
      );
    }

    return enabledByOrganization;
  }

  private projectCatalog(rows: ModuleRow[]): OrganizationModuleState[] {
    const stored = new Map(rows.map((row) => [row.module, row.enabled]));
    return BUSINESS_MODULE_CATALOG.map((definition) => ({
      ...definition,
      enabled: stored.get(definition.id) ?? true,
    }));
  }

  private requireModule(moduleId: string) {
    const definition = findModuleDefinition(moduleId);
    if (!definition) {
      throw new BadRequestException(`Unknown module: ${moduleId}`);
    }
    return definition;
  }

  private async requireOrganization(organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required');
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
  }
}
