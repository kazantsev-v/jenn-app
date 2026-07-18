-- CreateTable
CREATE TABLE "OutputDestinationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutputDestinationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OutputDestinationPreference_userId_outputName_destinationType_destinationId_key" ON "OutputDestinationPreference"("userId", "outputName", "destinationType", "destinationId");

-- CreateIndex
CREATE INDEX "OutputDestinationPreference_userId_outputName_idx" ON "OutputDestinationPreference"("userId", "outputName");
