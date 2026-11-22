import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from '../rules/require-organization-guard.mjs';

// Route RuleTester's suites through node:test so `node --test` reports them.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

ruleTester.run('require-organization-guard', rule, {
  valid: [
    {
      name: 'class-level guard list includes the tenant guard',
      code: `
        @Controller('customers')
        @UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
        export class CustomersController {}
      `,
    },
    {
      name: 'method-level JwtAuthGuard is covered by the class tenant guard',
      code: `
        @Controller('sales')
        @UseGuards(OrganizationRequiredGuard)
        export class SalesController {
          @UseGuards(JwtAuthGuard)
          @Get()
          findAll() {}
        }
      `,
    },
    {
      name: 'guards that do not authenticate with JwtAuthGuard are out of scope',
      code: `
        @Controller('whatsapp/webhook')
        @UseGuards(WahaSignatureGuard)
        export class WebhookController {}
      `,
    },
  ],
  invalid: [
    {
      name: 'class-level JwtAuthGuard without the tenant guard',
      code: `
        @Controller('customers')
        @UseGuards(JwtAuthGuard, RolesGuard)
        export class CustomersController {}
      `,
      errors: [{ messageId: 'missingTenantGuard' }],
    },
    {
      name: 'method-level JwtAuthGuard in a class without the tenant guard',
      code: `
        @Controller('reports')
        export class ReportsController {
          @UseGuards(JwtAuthGuard)
          @Get('sales')
          sales() {}
        }
      `,
      errors: [{ messageId: 'missingTenantGuard', line: 4 }],
    },
  ],
});
