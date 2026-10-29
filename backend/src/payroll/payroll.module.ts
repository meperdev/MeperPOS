import { Module } from '@nestjs/common';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { OrganizationStatusGuard } from '../common/guards/organization-status.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeShiftsService } from './employee-shifts.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    EmployeeShiftsService,
    OrganizationRequiredGuard,
    OrganizationStatusGuard,
  ],
})
export class PayrollModule {}
