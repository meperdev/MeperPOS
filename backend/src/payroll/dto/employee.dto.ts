import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsDecimalAmount } from './decimal-amount.validator';

export enum EmployeeModality {
  FIXED = 'FIXED',
  BY_DAY = 'BY_DAY',
  OTHER = 'OTHER',
}

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  identification?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  jobTitle?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string | null;

  @IsOptional()
  @IsEnum(EmployeeModality)
  remunerationModality?: EmployeeModality | null;

  @IsOptional()
  @IsNumber()
  @IsDecimalAmount()
  @Min(0)
  @Max(9999999999.99)
  referenceAmount?: number | null;
}

export class UpdateEmployeeDto extends CreateEmployeeDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  declare name: string;
}

export class QueryEmployeesDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
