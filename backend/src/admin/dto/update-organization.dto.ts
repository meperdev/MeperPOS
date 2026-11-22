import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  taxId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  address?: string;

  @IsString()
  @MaxLength(2048)
  @IsOptional()
  logoUrl?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
