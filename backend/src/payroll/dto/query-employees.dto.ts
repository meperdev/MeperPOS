import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';

export class QueryEmployeesHttpDto {
  @Transform(({ obj, key }) => {
    const raw: unknown = obj[key];
    return raw === 'true' ? true : raw === 'false' ? false : raw;
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
