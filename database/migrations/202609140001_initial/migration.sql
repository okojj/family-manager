-- CreateTable
CREATE TABLE `Family` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `googleSub` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `familyId` CHAR(36) NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'UNASSIGNED',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_googleSub_key`(`googleSub`),
    INDEX `User_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invitation` (
    `id` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Invitation_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `tokenHash` CHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `csrf` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginChallenge` (
    `tokenHash` CHAR(64) NOT NULL,
    `nonce` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MissionTemplate` (
    `id` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `weekdays` VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5,6,0',
    `dueTime` VARCHAR(5) NOT NULL DEFAULT '23:59',
    `reward` INTEGER NOT NULL,
    `penalty` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission` (
    `id` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `templateId` CHAR(36) NOT NULL,
    `date` CHAR(10) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `dueTime` VARCHAR(5) NOT NULL,
    `reward` INTEGER NOT NULL,
    `penalty` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL DEFAULT 0,
    `submittedAt` DATETIME(3) NULL,

    INDEX `Mission_familyId_date_status_idx`(`familyId`, `date`, `status`),
    UNIQUE INDEX `Mission_templateId_userId_date_key`(`templateId`, `userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Wallet` (
    `userId` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `held` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PointEntry` (
    `id` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `points` INTEGER NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PointEntry_sourceKey_key`(`sourceKey`),
    INDEX `PointEntry_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Redemption` (
    `id` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `points` INTEGER NOT NULL,
    `rate` INTEGER NOT NULL DEFAULT 100,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    `payingParentId` CHAR(36) NULL,
    `requestKey` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,

    UNIQUE INDEX `Redemption_requestKey_key`(`requestKey`),
    INDEX `Redemption_familyId_status_idx`(`familyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `date` CHAR(10) NOT NULL,
    `time` VARCHAR(5) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'EVENT',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `requestKey` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `Event_requestKey_key`(`requestKey`),
    INDEX `Event_familyId_date_idx`(`familyId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `title` VARCHAR(180) NOT NULL,
    `link` VARCHAR(180) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `note` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
