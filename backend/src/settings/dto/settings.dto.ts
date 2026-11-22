import {
  IsString,
  IsOptional,
  IsObject,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationNameDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  name: string;
}

export class UpdateReceiptPrefixDto {
  @ApiPropertyOptional({ example: 'REC-' })
  @IsString()
  @MaxLength(20)
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
  @MaxLength(500)
  @IsOptional()
  printHeader?: string;

  @ApiPropertyOptional({ example: 'Pague en efectivo. Gracias por su compra.' })
  @IsString()
  @MaxLength(500)
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
