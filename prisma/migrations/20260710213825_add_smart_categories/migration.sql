-- CreateEnum
CREATE TYPE "SenderCategory" AS ENUM ('newsletters', 'promotions', 'social', 'updates', 'ridesharing', 'food', 'receipts', 'oldmail', 'largemail');

-- AlterTable
ALTER TABLE "SenderGroup" ADD COLUMN     "archivedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "category" "SenderCategory",
ADD COLUMN     "inboxCount" INTEGER NOT NULL DEFAULT 0;
