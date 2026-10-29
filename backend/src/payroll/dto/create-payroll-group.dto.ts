import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

export class CreatePayrollGroupDto {
  @IsString()
  @Matches(/\S/)
  employeeId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  shiftIds: string[];
}
