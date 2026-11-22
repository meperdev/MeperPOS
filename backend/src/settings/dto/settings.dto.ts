import {
  IsString,
  IsOptional,
  IsObject,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The business name prints in the receipt header. Same cap as the admin
 * create/update organization DTOs, so settings is not a bypass.
 */
export const ORGANIZATION_NAME_MAX_LENGTH = 100;

export class UpdateOrganizationNameDto {
  @ApiProperty({
    example: 'Acme Corp',
    maxLength: ORGANIZATION_NAME_MAX_LENGTH,
  })
  // Validate the trimmed value: it is what the service stores.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORGANIZATION_NAME_MAX_LENGTH)
  name: string;
}

export class UpdateReceiptPrefixDto {
  @ApiPropertyOptional({ example: 'REC-' })
  @IsString()
  @IsOptional()
  prefix?: string;
}

/** A partial write: only the fields sent are replaced. */
export class PurchaseOrderTemplateDto {
  @ApiPropertyOptional({ example: 'Bodega 4, Zona Franca' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Crédito a 30 días' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  paymentTerms?: string;

  @ApiPropertyOptional({ example: 'Se recibe solo mercancía con factura' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  terms?: string;

  @ApiPropertyOptional({ example: 'Gracias por su atención' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  footer?: string;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 'Empresa ABC - Comprobante #' })
  @IsString()
  @IsOptional()
  printHeader?: string;

  @ApiPropertyOptional({ example: 'Pague en efectivo. Gracias por su compra.' })
  @IsString()
  @IsOptional()
  printFooter?: string;

  @ApiPropertyOptional({ type: PurchaseOrderTemplateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseOrderTemplateDto)
  purchaseOrderTemplate?: PurchaseOrderTemplateDto;

  @ApiPropertyOptional({ example: { theme: 'dark' } })
  @IsObject()
  @IsOptional()
  custom?: Record<string, unknown>;
}
