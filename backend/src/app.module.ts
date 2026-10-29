import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { ReportsModule } from './reports/reports.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttlerModuleOptions } from './common/throttling/throttler-storage.factory';
import { SettingsModule } from './settings/settings.module';
import { ExportsModule } from './exports/exports.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { ImportsModule } from './imports/imports.module';
import { CacheModule } from './common/cache.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { SequenceModule } from './common/sequences/sequence.module';
import { AdminModule } from './admin/admin.module';
import { PlanLimitsModule } from './plan-limits/plan-limits.module';
import { OrganizationStatusGuard } from './common/guards/organization-status.guard';
import { CookieCsrfGuard } from './common/guards/cookie-csrf.guard';
import { CashRegistersModule } from './cash-registers/cash-registers.module';
import { BillingModule } from './billing/billing.module';
import { ExpensesModule } from './expenses/expenses.module';
import { LoansModule } from './loans/loans.module';
import { PayrollModule } from './payroll/payroll.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Global limit 100 req/60 s. The options are resolved here, inside the
    // imports array and after ConfigModule, so a `.env` value of REDIS_URL is
    // already visible and the shared storage is used when it is configured
    // (spec S4.3, S4.5).
    ThrottlerModule.forRoot(throttlerModuleOptions()),
    CacheModule,
    PrismaModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    CustomersModule,
    SalesModule,
    ReportsModule,
    SettingsModule,
    ExportsModule,
    CloudinaryModule,
    ImportsModule,
    UsersModule,
    TasksModule,
    SuppliersModule,
    PurchaseOrdersModule,
    SequenceModule,
    AdminModule,
    PlanLimitsModule,
    CashRegistersModule,
    BillingModule,
    ExpensesModule,
    LoansModule,
    PayrollModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    OrganizationStatusGuard,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Guard placement: there is no global JwtAuthGuard in this app —
    // authentication resolves at route level via @UseGuards(JwtAuthGuard).
    // CookieCsrfGuard only inspects transport attributes (method, headers,
    // cookies, path) and never reads request.user, so it is safe to register
    // globally ahead of route-level authentication while still rejecting
    // cookie-authenticated mutations before any handler runs. Throttling
    // stays first so abusive traffic is shed before CSRF validation.
    {
      provide: APP_GUARD,
      useClass: CookieCsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: OrganizationStatusGuard,
    },
  ],
})
export class AppModule {}
