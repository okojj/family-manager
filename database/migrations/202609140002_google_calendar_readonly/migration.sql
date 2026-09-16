-- CreateTable
CREATE TABLE `GoogleCalendarConnection` (
    `familyId` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `refreshTokenEncrypted` TEXT NOT NULL,
    `calendarId` VARCHAR(1024) NULL,
    `calendarName` VARCHAR(255) NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `lastSyncedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(255) NULL,
    `syncLease` CHAR(36) NULL,
    `syncLeaseUntil` DATETIME(3) NULL,

    PRIMARY KEY (`familyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarOAuthState` (
    `tokenHash` CHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `sessionHash` CHAR(64) NOT NULL,
    `verifier` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoogleCalendarEvent` (
    `id` CHAR(64) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `googleEventId` VARCHAR(1024) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `date` CHAR(10) NOT NULL,
    `endDate` CHAR(10) NOT NULL,
    `time` VARCHAR(5) NOT NULL,
    `allDay` BOOLEAN NOT NULL,
    `note` TEXT NOT NULL,
    `htmlLink` VARCHAR(2048) NULL,

    INDEX `GoogleCalendarEvent_familyId_date_idx`(`familyId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
