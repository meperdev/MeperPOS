import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const BUSINESS_MODULES = ['vehicles'] as const;
export type BusinessModule = (typeof BUSINESS_MODULES)[number];

@Injectable()
export class BusinessModulesService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(
    organizationId: string,
    module: BusinessModule,
  ): Promise<boolean> {
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required');
    }
    const setting = await this.prisma.organizationModule.findUnique({
      where: { organizationId_module: { organizationId, module } },
    });
    // Preserve the existing plate functionality until explicitly disabled.
    return setting?.enabled ?? true;
  }

  async getForOrganization(organizationId: string, module: BusinessModule) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return { enabled: await this.isEnabled(organizationId, module) };
  }

  async setEnabled(
    organizationId: string,
    module: BusinessModule,
    enabled: boolean,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return this.prisma.organizationModule.upsert({
      where: { organizationId_module: { organizationId, module } },
      create: { organizationId, module, enabled },
      update: { enabled },
    });
  }
}
