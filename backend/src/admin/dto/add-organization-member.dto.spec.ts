import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { AddOrganizationMemberDto } from './add-organization-member.dto';
import { UpdateMemberRoleDto } from './update-member-role.dto';

/**
 * S8 (b): OWNER is retired, so the platform panel must not be able to assign
 * it either. The DTOs make the value unrepresentable at the boundary (the
 * services refuse it again for callers that bypass HTTP).
 */
function parse<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
): T {
  return plainToInstance(type, body, { enableImplicitConversion: true });
}

function constraintOf(errors: ValidationError[], property: string): string[] {
  const found = errors.find((error) => error.property === property);
  return Object.keys(found?.constraints ?? {});
}

describe('admin member DTOs (S8 b)', () => {
  it('rejects OWNER when adding a member', async () => {
    const errors = await validate(
      parse(AddOrganizationMemberDto, {
        email: 'retired@example.com',
        role: OrgRole.OWNER,
      }),
    );

    expect(constraintOf(errors, 'role')).toContain('isNotIn');
  });

  it('keeps accepting every other role when adding a member', async () => {
    for (const role of [
      OrgRole.ADMIN,
      OrgRole.MEMBER,
      OrgRole.CASHIER,
      OrgRole.INVENTORY_USER,
    ]) {
      const errors = await validate(
        parse(AddOrganizationMemberDto, {
          email: 'member@example.com',
          role,
        }),
      );
      expect(constraintOf(errors, 'role')).toEqual([]);
    }
  });

  it('rejects OWNER when changing a member role', async () => {
    const errors = await validate(
      parse(UpdateMemberRoleDto, { role: OrgRole.OWNER }),
    );

    expect(constraintOf(errors, 'role')).toContain('isNotIn');
  });

  it('keeps accepting ADMIN when changing a member role', async () => {
    const errors = await validate(
      parse(UpdateMemberRoleDto, { role: OrgRole.ADMIN }),
    );

    expect(constraintOf(errors, 'role')).toEqual([]);
  });
});
