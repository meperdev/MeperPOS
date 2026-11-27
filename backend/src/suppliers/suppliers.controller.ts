import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { OrgRole } from '@prisma/client';

@ApiTags('Suppliers')
@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
@ApiBearerAuth()
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Post()
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Crear un proveedor' })
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: RequestUser) {
    return this.suppliersService.create(dto, user.organizationId);
  }

  @Get()
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Listar proveedores' })
  findAll(@Query() query: QuerySuppliersDto, @CurrentUser() user: RequestUser) {
    return this.suppliersService.findAll(query, user.organizationId);
  }

  @Get(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Obtener un proveedor por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.suppliersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Actualizar un proveedor' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliersService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Desactivar un proveedor' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.suppliersService.remove(id, user.organizationId);
  }

  @Post(':id/reactivate')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Reactivar un proveedor' })
  reactivate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.suppliersService.reactivate(id, user.organizationId);
  }
}
