import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { AddOrganizationMemberDto } from './add-organization-member.dto';
import { UpdateMemberRoleDto } from './update-member-role.dto';

/**
 * S9: OWNER and MEMBER are no longer OrgRole values, so the platform panel
 * cannot assign them at all — `@IsEnum(OrgRole)` refuses the retired literals
 * at the boundary, exactly like any other unknown role.
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

describe('admin member DTOs (S9)', () => {
  it.each(['OWNER', 'MEMBER'])(
    'rejects the retired %s role when adding a member',
    async (role) => {
      const errors = await validate(
        parse(AddOrganizationMemberDto, {
          email: 'retired@example.com',
          role,
        }),
      );

      expect(constraintOf(errors, 'role')).toContain('isEnum');
    },
  );

  it('keeps accepting every current role when adding a member', async () => {
    for (const role of [
      OrgRole.ADMIN,
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

  it.each(['OWNER', 'MEMBER'])(
    'rejects the retired %s role when changing a member role',
    async (role) => {
      const errors = await validate(parse(UpdateMemberRoleDto, { role }));

      expect(constraintOf(errors, 'role')).toContain('isEnum');
    },
  );

  it('keeps accepting ADMIN when changing a member role', async () => {
    const errors = await validate(
      parse(UpdateMemberRoleDto, { role: OrgRole.ADMIN }),
    );

    expect(constraintOf(errors, 'role')).toEqual([]);
  });
});
