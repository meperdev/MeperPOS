import { IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateCashRegisterDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
