-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('idle', 'syncing', 'error');

-- CreateEnum
CREATE TYPE "SenderStatus" AS ENUM ('active', 'unsubscribed', 'deleted');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "UnsubMethod" AS ENUM ('link', 'email');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "googleAccessToken" TEXT NOT NULL,
    "googleRefreshToken" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'idle',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "latestEmailDate" TIMESTAMP(3),
    "hasUnsubscribeLink" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribeUrl" TEXT,
    "unsubscribeEmail" TEXT,
    "status" "SenderStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalEmails" INTEGER,
    "processedEmails" INTEGER NOT NULL DEFAULT 0,
    "pageTokenCursor" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnsubscribeAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderGroupId" TEXT NOT NULL,
    "method" "UnsubMethod" NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleteExisting" BOOLEAN NOT NULL,
    "emailsDeleted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UnsubscribeAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeleteAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderGroupId" TEXT NOT NULL,
    "emailsDeleted" INTEGER NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeleteAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SenderGroup_userId_emailCount_idx" ON "SenderGroup"("userId", "emailCount" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SenderGroup_userId_senderEmail_key" ON "SenderGroup"("userId", "senderEmail");

-- AddForeignKey
ALTER TABLE "SenderGroup" ADD CONSTRAINT "SenderGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnsubscribeAction" ADD CONSTRAINT "UnsubscribeAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnsubscribeAction" ADD CONSTRAINT "UnsubscribeAction_senderGroupId_fkey" FOREIGN KEY ("senderGroupId") REFERENCES "SenderGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteAction" ADD CONSTRAINT "DeleteAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteAction" ADD CONSTRAINT "DeleteAction_senderGroupId_fkey" FOREIGN KEY ("senderGroupId") REFERENCES "SenderGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
