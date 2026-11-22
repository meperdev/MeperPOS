import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule, { isBoundedPattern } from '../rules/require-string-length-bound.mjs';

// Route RuleTester's suites through node:test so `node --test` reports them.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

const DTO = 'src/settings/dto/settings.dto.ts';
const dto = (body) => `export class SomeDto {\n${body}\n}`;

ruleTester.run('require-string-length-bound', rule, {
  valid: [
    {
      name: '@IsString with @MaxLength',
      filename: DTO,
      code: dto(`  @IsString()\n  @MaxLength(100)\n  name: string;`),
    },
    {
      name: '@IsString with @Length',
      filename: DTO,
      code: dto(`  @IsString()\n  @Length(1, 20)\n  prefix: string;`),
    },
    {
      name: '@IsOptional + @IsString + @MaxLength',
      filename: DTO,
      code: dto(`  @IsOptional()\n  @IsString()\n  @MaxLength(500)\n  printFooter?: string;`),
    },
    {
      name: 'string array bounded per element',
      filename: DTO,
      code: dto(
        `  @IsString({ each: true })\n  @MaxLength(64, { each: true })\n  ids: string[];`,
      ),
    },
    ...[
      '@IsEnum(Status)',
      "@IsIn(['a', 'b'])",
      '@IsUUID()',
      '@IsEmail()',
      '@IsUrl()',
      '@IsISO8601()',
      '@IsDateString()',
      '@IsValidPassword()',
    ].map((exempt) => ({
      name: `exempt by ${exempt}`,
      filename: DTO,
      code: dto(`  @IsString()\n  ${exempt}\n  field: string;`),
    })),
    {
      name: 'exempt by @Matches with an anchored, bounded regex',
      filename: DTO,
      code: dto(`  @IsString()\n  @Matches(/^\\d{4}-\\d{2}$/)\n  month: string;`),
    },
    {
      name: 'a non-DTO file is out of scope',
      filename: 'src/settings/settings.service.ts',
      code: dto(`  @IsString()\n  name: string;`),
    },
    {
      name: 'a DTO spec file is out of scope',
      filename: 'src/settings/dto/settings.dto.spec.ts',
      code: dto(`  @IsString()\n  name: string;`),
    },
    {
      name: 'non-string validators are out of scope',
      filename: DTO,
      code: dto(
        `  @IsNumber()\n  amount: number;\n\n  @IsBoolean()\n  active: boolean;\n\n  @IsInt()\n  page: number;`,
      ),
    },
  ],
  invalid: [
    {
      name: '@IsString alone',
      filename: DTO,
      code: dto(`  @IsString()\n  @IsNotEmpty()\n  name: string;`),
      errors: [{ messageId: 'missingLengthBound', line: 2, data: { name: 'name' } }],
    },
    {
      name: '@IsOptional does not exempt',
      filename: DTO,
      code: dto(`  @IsString()\n  @IsOptional()\n  printHeader?: string;`),
      errors: [{ messageId: 'missingLengthBound', data: { name: 'printHeader' } }],
    },
    {
      name: '@IsString({ each: true }) still needs a per-element bound',
      filename: DTO,
      code: dto(`  @IsArray()\n  @ArrayMaxSize(10)\n  @IsString({ each: true })\n  ids: string[];`),
      errors: [{ messageId: 'missingLengthBound', line: 4 }],
    },
    {
      name: '@Matches(/\\S/) is a non-blank check, not a bound',
      filename: DTO,
      code: dto(`  @IsString()\n  @Matches(/\\S/)\n  employeeId: string;`),
      errors: [{ messageId: 'missingLengthBound' }],
    },
    {
      name: '@Matches with an unbounded quantifier is not a bound',
      filename: DTO,
      code: dto(`  @IsString()\n  @Matches(/^\\d+(?:\\.\\d{1,2})?$/)\n  amount: string;`),
      errors: [{ messageId: 'missingLengthBound' }],
    },
    {
      name: '@IsNumberString is not exempt (isNumeric has no length cap)',
      filename: DTO,
      code: dto(`  @IsString()\n  @IsNumberString()\n  code: string;`),
      errors: [{ messageId: 'missingLengthBound' }],
    },
    {
      name: 'each unbounded property is reported',
      filename: DTO,
      code: dto(
        `  @IsString()\n  @MaxLength(10)\n  ok: string;\n\n  @IsString()\n  a: string;\n\n  @IsString()\n  b: string;`,
      ),
      errors: [
        { messageId: 'missingLengthBound', line: 6, data: { name: 'a' } },
        { messageId: 'missingLengthBound', line: 9, data: { name: 'b' } },
      ],
    },
  ],
});

describe('isBoundedPattern', () => {
  it('accepts anchored patterns with fixed or bounded repetition', () => {
    for (const source of [
      '^\\d{4}-\\d{2}$',
      '^(?!0000)\\d{4}-\\d{2}-\\d{2}$',
      '^[A-Z+*]{2,5}$',
    ]) {
      assert.equal(isBoundedPattern(source), true, source);
    }
  });

  it('rejects unanchored or unbounded patterns', () => {
    for (const source of [
      '\\S',
      '^\\d+$',
      '^a*$',
      '^\\d{2,}$',
      '^abc',
      'abc$',
      '^abc\\$',
    ]) {
      assert.equal(isBoundedPattern(source), false, source);
    }
  });
});
