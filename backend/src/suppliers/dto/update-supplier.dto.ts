import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { SupplierAccountType } from '@prisma/client';

export class UpdateSupplierDto {
  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({ required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  address?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  contactName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  bank?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  accountNumber?: string;

  @ApiProperty({ enum: SupplierAccountType, required: false })
  @IsEnum(SupplierAccountType)
  @IsOptional()
  accountType?: SupplierAccountType;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
