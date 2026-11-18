import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { CancelPurchaseOrderDto } from './dto/cancel-purchase-order.dto';
import { QueryPurchaseOrdersDto } from './dto/query-purchase-orders.dto';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { OrgRole } from '@prisma/client';

@ApiTags('PurchaseOrders')
@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
@ApiBearerAuth()
export class PurchaseOrdersController {
  constructor(private purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Crear una orden de compra (borrador)' })
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchaseOrdersService.create(
      dto,
      user.userId,
      user.organizationId,
    );
  }

  @Get()
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Listar órdenes de compra' })
  findAll(
    @Query() query: QueryPurchaseOrdersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchaseOrdersService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Obtener una orden de compra por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.purchaseOrdersService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Editar una orden de compra (solo en borrador)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchaseOrdersService.update(id, dto, user.organizationId);
  }

  @Post(':id/confirm')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Confirmar una orden de compra (DRAFT → PENDING)' })
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchaseOrdersService.confirm(id, user.organizationId, dto);
  }

  @Post(':id/receive')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Recibir ítems de una orden de compra' })
  receive(
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchaseOrdersService.receive(
      id,
      dto,
      user.userId,
      user.organizationId,
    );
  }

  @Post(':id/cancel')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER)
  @ApiOperation({ summary: 'Cancelar una orden de compra' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelPurchaseOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.purchaseOrdersService.cancel(id, dto, user.organizationId);
  }
}
