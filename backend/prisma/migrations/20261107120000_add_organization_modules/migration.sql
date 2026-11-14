CREATE TABLE "OrganizationModule" (
    "organizationId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    CONSTRAINT "OrganizationModule_pkey" PRIMARY KEY ("organizationId", "module"),
    CONSTRAINT "OrganizationModule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
