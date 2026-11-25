import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CancelStockTransferDto } from './dto/cancel-stock-transfer.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { QueryStockTransfersDto } from './dto/query-stock-transfers.dto';
import { TransfersService } from './transfers.service';

/**
 * Transfers between sites. Dispatch and cancellation are administrative work, so
 * the class minimum is ADMIN/MEMBER. A cashier is the role that physically
 * receives the goods at its store, so the three routes it needs — the list, one
 * document and the receipt — carry their own broader role list. Which sites a
 * cashier reaches is decided afterwards, inside each transaction, by the
 * membership assignment: a cashier only receives at an assigned destination and
 * reads only documents touching its sites.
 */
@ApiTags('Transfers')
@ApiBearerAuth()
@Controller('transfers')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
@Roles(OrgRole.ADMIN, OrgRole.MEMBER)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @ApiOperation({
    summary: 'Despachar stock de una sede autorizada a otra sede de la empresa',
  })
  dispatch(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.transfers.dispatch(user, dto);
  }

  @Get()
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.CASHIER)
  @ApiOperation({
    summary: 'Listar las transferencias visibles para el usuario y sus sedes',
  })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryStockTransfersDto,
  ) {
    return this.transfers.findAll(user, query);
  }

  @Get(':id')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Leer una transferencia con sus ítems y sus sedes' })
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transfers.findOne(user, id);
  }

  @Post(':id/receive')
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Recibir una transferencia en la sede de destino' })
  receive(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transfers.receive(user, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancelar una transferencia en tránsito y devolver el stock',
  })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelStockTransferDto,
  ) {
    return this.transfers.cancel(user, id, dto);
  }
}
