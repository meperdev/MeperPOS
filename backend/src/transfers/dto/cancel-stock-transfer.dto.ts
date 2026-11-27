import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CancelStockTransferDto {
  @ApiProperty({ maxLength: 500, description: 'Why the transfer is cancelled' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  reason!: string;
}
