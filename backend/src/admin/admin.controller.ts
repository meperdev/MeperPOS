import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationStatusDto } from './dto/update-organization-status.dto';
import { UpdateOrganizationPlanDto } from './dto/update-organization-plan.dto';
import { TransferPrimaryOwnerDto } from './dto/transfer-primary-owner.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { DeleteOrganizationDto } from './dto/delete-organization.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateElectronicInvoicingDto } from './dto/update-electronic-invoicing.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('organizations')
  createOrganization(@Body() dto: CreateOrganizationDto) {
    return this.adminService.createOrganization(dto);
  }

  @Get('organizations')
  findAllOrganizations() {
    return this.adminService.findAllOrganizations();
  }

  @Get('organizations/:id')
  findOrganizationById(@Param('id') id: string) {
    return this.adminService.findOrganizationById(id);
  }

  @Patch('organizations/:id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationStatusDto,
  ) {
    return this.adminService.updateStatus(id, dto);
  }

  @Patch('organizations/:id/plan')
  updatePlan(@Param('id') id: string, @Body() dto: UpdateOrganizationPlanDto) {
    return this.adminService.updatePlan(id, dto);
  }

  @Post('organizations/:id/transfer-owner')
  transferPrimaryOwner(
    @Param('id') organizationId: string,
    @Body() dto: TransferPrimaryOwnerDto,
  ) {
    return this.adminService.transferPrimaryOwner(
      organizationId,
      dto.currentOwnerId,
      dto.newOwnerId,
    );
  }

  @Get('metrics')
  getMetrics() {
    return this.adminService.getMetrics();
  }

  @Patch('organizations/:id')
  updateOrganization(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.adminService.updateOrganization(id, dto);
  }

  @Patch('organizations/:id/electronic-invoicing')
  updateElectronicInvoicing(
    @Param('id') id: string,
    @Body() dto: UpdateElectronicInvoicingDto,
  ) {
    return this.adminService.updateElectronicInvoicing(id, dto);
  }

  @Post('organizations/:id/members')
  addOrganizationMember(
    @Param('id') organizationId: string,
    @Body() dto: AddOrganizationMemberDto,
  ) {
    return this.adminService.addOrganizationMember(organizationId, dto);
  }

  @Patch('organizations/:id/members/:userId/role')
  updateMemberRole(
    @Param('id') organizationId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.adminService.updateMemberRole(organizationId, userId, dto.role);
  }

  @Delete('organizations/:id/members/:userId')
  removeOrganizationMember(
    @Param('id') organizationId: string,
    @Param('userId') userId: string,
  ) {
    return this.adminService.removeOrganizationMember(organizationId, userId);
  }

  @Delete('organizations/:id')
  deleteOrganization(
    @Param('id') id: string,
    @Body() dto: DeleteOrganizationDto,
  ) {
    return this.adminService.deleteOrganization(id, dto);
  }
}
