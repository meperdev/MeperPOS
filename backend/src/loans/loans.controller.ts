import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateLoanDto } from './dto/create-loan.dto';
import { CreatePosLoanDto } from './dto/create-pos-loan.dto';
import {
  CollectLoanDto,
  LoanOperationDto,
  ReasonLoanDto,
  ReverseLoanDto,
} from './dto/loan-operation.dto';
import { QueryLoansDto } from './dto/query-loans.dto';
import { LoansService } from './loans.service';

@ApiTags('Loans')
@ApiBearerAuth()
@Controller('loans')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post('pos-initiation')
  @Roles(OrgRole.CASHIER)
  async initiateFromPos(
    @Body() dto: CreatePosLoanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.initiateFromPos(dto, user.organizationId, user);
  }

  @Post(':id/pos-completion')
  @Roles(OrgRole.CASHIER)
  completePosSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoanOperationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.completePosSale(
      id,
      dto,
      user.organizationId,
      user,
    );
  }

  @Post()
  @Roles(OrgRole.ADMIN)
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: RequestUser) {
    return this.loansService.create(dto, user.userId, user.organizationId);
  }

  @Post(':id/collections')
  @Roles(OrgRole.CASHIER)
  collect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectLoanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.mutate(
      id,
      'COLLECTED',
      dto,
      user.userId,
      user.organizationId,
    );
  }

  @Post(':id/collections/:paymentId/reverse')
  @Roles(OrgRole.ADMIN)
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ReverseLoanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.mutate(
      id,
      'REVERSED',
      { ...dto, paymentId },
      user.userId,
      user.organizationId,
    );
  }

  @Post(':id/close')
  @Roles(OrgRole.ADMIN)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoanOperationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.mutate(
      id,
      'CLOSED',
      dto,
      user.userId,
      user.organizationId,
    );
  }

  @Post(':id/cancel')
  @Roles(OrgRole.ADMIN)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonLoanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.mutate(
      id,
      'CANCELLED',
      dto,
      user.userId,
      user.organizationId,
    );
  }

  @Get()
  @Roles(OrgRole.CASHIER)
  findAll(@Query() query: QueryLoansDto, @CurrentUser() user: RequestUser) {
    return this.loansService.findAll(query, user.organizationId);
  }

  @Get(':id')
  @Roles(OrgRole.CASHIER)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.findOne(id, user.organizationId);
  }

  @Get(':id/history')
  @Roles(OrgRole.CASHIER)
  getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryLoansDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.loansService.getHistory(id, query, user.organizationId);
  }
}
