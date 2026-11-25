import { IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class UpdateCashRegisterDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
