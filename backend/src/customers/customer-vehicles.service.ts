import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { BusinessModulesService } from '../business-modules/business-modules.service';

@Injectable()
export class CustomerVehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: BusinessModulesService,
  ) {}

  private async requireCustomer(organizationId: string, customerId: string) {
    if (!organizationId)
      throw new BadRequestException('Organization ID is required');
    if (!(await this.modules.isEnabled(organizationId, 'vehicles'))) {
      throw new ForbiddenException('Vehicles module is disabled');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, active: true },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  async list(organizationId: string, customerId: string) {
    await this.requireCustomer(organizationId, customerId);
    return this.prisma.customerVehicle.findMany({
      where: { organizationId, customerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    organizationId: string,
    customerId: string,
    vehicleId: string,
    data: { plate?: string; model?: string },
  ) {
    await this.requireCustomer(organizationId, customerId);
    const where = { id: vehicleId, customerId, organizationId };
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.customerVehicle.findFirst({ where });
        if (!existing) throw new NotFoundException('Vehicle not found');
        if (existing.legacyCustomerId && data.plate !== undefined) {
          await tx.customer.updateMany({
            where: { id: customerId, organizationId },
            data: { placaMoto: data.plate },
          });
        }
        const result = await tx.customerVehicle.updateMany({ where, data });
        if (result.count === 0)
          throw new NotFoundException('Vehicle not found');
        return tx.customerVehicle.findFirst({ where });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async create(
    organizationId: string,
    customerId: string,
    data: { plate: string; model?: string },
  ) {
    await this.requireCustomer(organizationId, customerId);
    return this.prisma.customerVehicle.create({
      data: { organizationId, customerId, ...data },
    });
  }
}
