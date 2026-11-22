import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'CC' })
  @IsString()
  @MaxLength(20)
  documentType: string;

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @MaxLength(30)
  documentNumber: string;

  @ApiProperty({ example: 'john@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: '555-1234', required: false })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'Entrega en portería', required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  referencia?: string;

  @ApiProperty({ example: 'ABC-123', required: false })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  placaMoto?: string;

  @ApiProperty({ example: '123 Main St', required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  address?: string;

  @ApiProperty({
    enum: ['VIP', 'FREQUENT', 'OCCASIONAL', 'INACTIVE'],
    example: 'OCCASIONAL',
    required: false,
  })
  @IsEnum(['VIP', 'FREQUENT', 'OCCASIONAL', 'INACTIVE'])
  @IsOptional()
  segment?: 'VIP' | 'FREQUENT' | 'OCCASIONAL' | 'INACTIVE';
}

export class UpdateCustomerDto {
  @ApiProperty({ example: 'John Doe', required: false })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'CC', required: false })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  documentType?: string;

  @ApiProperty({ example: '1234567890', required: false })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({ example: 'john@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: '555-1234', required: false })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'Entrega en portería', required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  referencia?: string;

  @ApiProperty({ example: 'ABC-123', required: false })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  placaMoto?: string;

  @ApiProperty({ example: '123 Main St', required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  address?: string;

  @ApiProperty({
    enum: ['VIP', 'FREQUENT', 'OCCASIONAL', 'INACTIVE'],
    example: 'OCCASIONAL',
    required: false,
  })
  @IsEnum(['VIP', 'FREQUENT', 'OCCASIONAL', 'INACTIVE'])
  @IsOptional()
  segment?: 'VIP' | 'FREQUENT' | 'OCCASIONAL' | 'INACTIVE';

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
