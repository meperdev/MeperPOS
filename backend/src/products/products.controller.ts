import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  HttpStatus,
  ParseEnumPipe,
  ParseBoolPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { OrgRole, ProductType } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { ProductSiteQueryPipe } from './dto/product-site.query';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { AuditAction } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlanLimitGuard } from '../plan-limits/plan-limits.guard';
import { PlanLimit } from '../plan-limits/plan-limits.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { LocationsService } from '../locations/locations.service';

@ApiTags('Products')
@Controller('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard, PlanLimitGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private locationsService: LocationsService,
  ) {}

  @Post()
  @Roles(OrgRole.ADMIN)
  @PlanLimit('products')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('PRODUCT_CREATE')
  @ApiOperation({ summary: 'Create a new product' })
  create(
    @Body() createProductDto: CreateProductDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.create(
      createProductDto,
      user.userId,
      user.organizationId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all products with pagination' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'all'],
    example: 'active',
  })
  @ApiQuery({ name: 'type', required: false, enum: ProductType })
  @ApiQuery({
    name: 'ids',
    required: false,
    description: 'Comma-separated product UUIDs; empty means no products',
  })
  @ApiQuery({ name: 'available', required: false, type: Boolean })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description:
      'Read one accessible site balance; omit it for the organization aggregate',
  })
  @ApiQuery({
    name: 'carriedAtSite',
    required: false,
    type: Boolean,
    description:
      'Only valid with locationId: list the products that site carries instead of the whole catalog',
  })
  async findAll(
    @CurrentUser() user: RequestUser,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status: 'active' | 'inactive' | 'all' = 'active',
    @Query('lowStock') lowStock?: string,
    @Query('orderBy') orderBy?: 'name' | 'createdAt',
    @Query('type', new ParseEnumPipe(ProductType, { optional: true }))
    type?: ProductType,
    @Query('ids') ids?: string,
    @Query('available', new ParseBoolPipe({ optional: true }))
    available?: boolean,
    @Query('locationId', ProductSiteQueryPipe) locationId?: string,
    @Query('carriedAtSite', new ParseBoolPipe({ optional: true }))
    carriedAtSite?: boolean,
  ) {
    if (ids !== undefined && typeof ids !== 'string') {
      throw new BadRequestException('ids must be a comma-separated string');
    }
    // No `await` on the organization-wide path: an omitted site keeps this read
    // exactly as synchronous as it was before site scoping existed.
    const locationSiteId =
      locationId === undefined
        ? undefined
        : await this.readableSite(user, locationId);
    return this.productsService.findAll(
      user.organizationId,
      page,
      limit,
      search,
      categoryId,
      status,
      lowStock === 'true',
      orderBy,
      type,
      ids === undefined ? undefined : ids === '' ? [] : ids.split(','),
      available ?? false,
      locationSiteId,
      carriedAtSite,
    );
  }

  @Get('low-stock')
  // Inventory staff reads the low-stock list on their own screen; the feed and
  // the bell already enable stock alerts for that role, so the API must agree.
  @Roles(OrgRole.ADMIN, OrgRole.INVENTORY_USER)
  @ApiOperation({ summary: 'Get products with low stock' })
  getLowStock(@CurrentUser() user: RequestUser) {
    return this.productsService.getLowStockProducts(user.organizationId);
  }

  @Get('search')
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Search products by name, SKU or barcode' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description:
      'Read one accessible site balance; omit it for the organization aggregate',
  })
  async search(
    @CurrentUser() user: RequestUser,
    @Query('q') query: string,
    @Query('limit') limit: number = 20,
    @Query('locationId', ProductSiteQueryPipe) locationId?: string,
  ) {
    const locationSiteId =
      locationId === undefined
        ? undefined
        : await this.readableSite(user, locationId);
    return this.productsService.searchProducts(
      query,
      limit,
      user.organizationId,
      locationSiteId,
    );
  }

  @Get('quick-search')
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Quick search product by barcode or SKU' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description:
      'Read one accessible site balance; omit it for the organization aggregate',
  })
  async quickSearch(
    @CurrentUser() user: RequestUser,
    @Query('code') code: string,
    @Query('locationId', ProductSiteQueryPipe) locationId?: string,
  ) {
    const locationSiteId =
      locationId === undefined
        ? undefined
        : await this.readableSite(user, locationId);
    return this.productsService.quickSearch(
      code,
      user.organizationId,
      locationSiteId,
    );
  }

  /**
   * Authorizes the optional site filter through the single site-access rule.
   *
   * `LocationsService.findAccessible` answers 404 'Location not found' for a
   * site in another organization, a site the membership was never assigned and
   * an unknown id, exactly like the other site routes; the products read never
   * re-derives that rule.
   */
  private async readableSite(
    user: RequestUser,
    locationId: string,
  ): Promise<string> {
    const site = await this.locationsService.findAccessible(user, locationId);
    return site.id;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.productsService.findOne(id, user.organizationId);
  }

  /**
   * Per-site breakdown of one product (T22).
   *
   * Every role that can open a product may read it, and the directory answers
   * only with the sites that role may see (owners and administrators: the whole
   * organization; an operational membership: its assignments). The service
   * keeps the read tenant-scoped.
   */
  @Get(':id/stock-by-site')
  @ApiOperation({ summary: 'Get the stock balance of every readable site' })
  async stockBySite(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const sites = await this.locationsService.list(user);
    return this.productsService.stockBySite(id, user.organizationId, sites);
  }

  /**
   * Per-site stock adjustment (T22). It is a stock edit, so it admits exactly
   * the roles the product edit does, and it leaves the same audit trail.
   */
  @Post(':id/stock-adjustments')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('PRODUCT_STOCK_ADJUST')
  @ApiOperation({ summary: 'Adjust the stock of one site' })
  adjustStock(
    @Param('id') id: string,
    @Body() stockAdjustmentDto: StockAdjustmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.adjustSiteStock(id, stockAdjustmentDto, user);
  }

  @Put(':id')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('PRODUCT_UPDATE')
  @ApiOperation({ summary: 'Update a product' })
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.update(
      id,
      updateProductDto,
      user.userId,
      user.organizationId,
    );
  }

  @Put(':id/deactivate')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('PRODUCT_DEACTIVATE')
  @ApiOperation({ summary: 'Deactivate a product' })
  deactivate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.productsService.deactivate(id, user.organizationId);
  }

  @Put(':id/reactivate')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('PRODUCT_REACTIVATE')
  @ApiOperation({ summary: 'Reactivate a product' })
  reactivate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.productsService.reactivate(id, user.organizationId);
  }

  @Delete(':id')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('PRODUCT_DELETE')
  @ApiOperation({ summary: 'Delete a product' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.productsService.remove(id, user.organizationId);
  }

  @Post('upload')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload product image' })
  async uploadImage(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /(jpg|jpeg|png|gif|webp)$/,
        })
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024, // 5MB
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
  ) {
    return this.productsService.uploadImage(file);
  }

  @Post(':id/upload')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload image for specific product' })
  async uploadProductImage(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /(jpg|jpeg|png|gif|webp)$/,
        })
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024, // 5MB
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
  ) {
    return this.productsService.uploadProductImage(
      id,
      file,
      user.organizationId,
    );
  }
}
