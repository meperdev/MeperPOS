import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsInt,
  IsOptional,
  IsBoolean,
  Min,
  IsUUID,
  IsEnum,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  MaxLength,
} from 'class-validator';
import { ProductType, PromotionType } from '@prisma/client';
import { DianTaxCode } from '../../common/utils/tax.util';

/**
 * Cross-field rule mirroring the taxable/taxRate invariant: a product that is
 * not taxable cannot carry a tribute code. A taxable product may omit the code,
 * in which case `resolveEffectiveTaxCode` resolves it to IVA.
 *
 * `@IsOptional()` runs first, so an explicit `null` (clearing the code) never
 * reaches this constraint.
 */
@ValidatorConstraint({ name: 'taxCodeRequiresTaxable', async: false })
class TaxCodeRequiresTaxableConstraint implements ValidatorConstraintInterface {
  validate(taxCode: unknown, args: ValidationArguments): boolean {
    if (taxCode === null || taxCode === undefined) return true;
    const { taxable } = args.object as { taxable?: boolean | null };
    return taxable !== false;
  }

  defaultMessage(): string {
    return 'taxCode cannot be set when taxable is false';
  }
}

const TAX_CODE_API_PROPERTY = {
  enum: DianTaxCode,
  enumName: 'DianTaxCode',
  required: false,
  nullable: true,
  description:
    'DIAN tribute code of the item. Omitted on a taxable product resolves to IVA.',
} as const;

export class CreateProductDto {
  @ApiProperty({ example: 'Product Name' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @MaxLength(50)
  sku: string;

  @ApiProperty({ example: '123456789', required: false })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  barcode?: string;

  @ApiProperty({ example: 'Product description', required: false })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 100.0 })
  @IsNumber()
  @Min(0)
  costPrice: number;

  @ApiProperty({ example: 150.0 })
  @IsNumber()
  @Min(0)
  salePrice: number;

  @ApiProperty({ example: 19.0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxRate?: number;

  @ApiProperty(TAX_CODE_API_PROPERTY)
  @Validate(TaxCodeRequiresTaxableConstraint)
  @IsEnum(DianTaxCode)
  @IsOptional()
  taxCode?: DianTaxCode | null;

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  taxable?: boolean;

  // Stock is counted in whole units (Product.stock/minStock are Int).
  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(0)
  minStock: number;

  @ApiProperty({
    enum: ProductType,
    enumName: 'ProductType',
    required: false,
    default: 'PRODUCT',
  })
  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  tracksStock?: boolean;

  @ApiProperty({ example: 'https://example.com/image.jpg', required: false })
  @IsString()
  @MaxLength(2048)
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({ example: 'uuid-category-id' })
  @IsUUID('all')
  categoryId: string;

  @ApiProperty({
    enum: PromotionType,
    enumName: 'PromotionType',
    required: false,
    nullable: true,
  })
  @IsEnum(PromotionType)
  @IsOptional()
  promotionType?: PromotionType | null;

  @ApiProperty({ example: 8000, required: false, nullable: true })
  @IsNumber()
  @Min(0)
  @IsOptional()
  promotionValue?: number | null;
}

export class UpdateProductDto {
  @ApiProperty({ example: 'Product Name', required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'SKU-001', required: false })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  sku?: string;

  @ApiProperty({ example: '123456789', required: false })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  barcode?: string;

  @ApiProperty({ example: 'Product description', required: false })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 100.0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @ApiProperty({ example: 150.0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  salePrice?: number;

  @ApiProperty({ example: 19.0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxRate?: number;

  @ApiProperty(TAX_CODE_API_PROPERTY)
  @Validate(TaxCodeRequiresTaxableConstraint)
  @IsEnum(DianTaxCode)
  @IsOptional()
  taxCode?: DianTaxCode | null;

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  taxable?: boolean;

  // Stock is counted in whole units (Product.stock/minStock are Int).
  @ApiProperty({ example: 10, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiProperty({ example: 5, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @ApiProperty({
    enum: ProductType,
    enumName: 'ProductType',
    required: false,
  })
  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  tracksStock?: boolean;

  @ApiProperty({ example: 'https://example.com/image.jpg', required: false })
  @IsString()
  @MaxLength(2048)
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({ example: 'uuid-category-id', required: false })
  @IsUUID('all')
  @IsOptional()
  categoryId?: string;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiProperty({
    enum: PromotionType,
    enumName: 'PromotionType',
    required: false,
    nullable: true,
  })
  @IsEnum(PromotionType)
  @IsOptional()
  promotionType?: PromotionType | null;

  @ApiProperty({ example: 8000, required: false, nullable: true })
  @IsNumber()
  @Min(0)
  @IsOptional()
  promotionValue?: number | null;
}
