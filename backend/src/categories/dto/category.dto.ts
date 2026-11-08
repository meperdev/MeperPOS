import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { DianTaxCode } from '../../common/utils/tax.util';

const DEFAULT_TAX_CODE_API_PROPERTY = {
  enum: DianTaxCode,
  enumName: 'DianTaxCode',
  required: false,
  nullable: true,
  description:
    'DIAN tribute code products of this category inherit. Omitted on a taxable category resolves to IVA.',
} as const;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Electronics' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Electronic devices and accessories',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 19.0,
    description: 'Default tax rate percentage (0-100)',
    required: false,
  })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  defaultTaxRate?: number;

  @ApiProperty(DEFAULT_TAX_CODE_API_PROPERTY)
  @IsEnum(DianTaxCode)
  @IsOptional()
  defaultTaxCode?: DianTaxCode | null;
}

export class UpdateCategoryDto {
  @ApiProperty({ example: 'Electronics', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'Electronic devices and accessories',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiProperty({
    example: 19.0,
    description: 'Default tax rate percentage (0-100)',
    required: false,
  })
  @Transform(({ value }) => {
    if (value === '') return null;
    if (value === null || value === undefined) return value;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultTaxRate?: number | null;

  @ApiProperty(DEFAULT_TAX_CODE_API_PROPERTY)
  @IsEnum(DianTaxCode)
  @IsOptional()
  defaultTaxCode?: DianTaxCode | null;
}
