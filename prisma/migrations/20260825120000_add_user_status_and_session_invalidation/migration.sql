-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- Add the new column nullable first so existing rows can be backfilled
-- from `active` before the NOT NULL constraint is applied — preserves
-- every existing account's activation state instead of collapsing them
-- all onto the new column's default.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "status" "UserStatus";
ALTER TABLE "User" ADD COLUMN "sessionInvalidatedAt" TIMESTAMP(3);

-- Backfill: true -> ACTIVE, false -> INACTIVE. No existing account becomes
-- PENDING here — PENDING is reachable only through the new public Sign Up
-- path, never a status any pre-existing account should retroactively land
-- in.
UPDATE "User" SET "status" = CASE WHEN "active" THEN 'ACTIVE'::"UserStatus" ELSE 'INACTIVE'::"UserStatus" END;

ALTER TABLE "User" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "User" DROP COLUMN "active";
