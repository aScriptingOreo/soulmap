-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coordinates" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "icon" TEXT,
    "iconSize" DOUBLE PRECISION,
    "mediaUrl" JSONB,
    "iconColor" TEXT,
    "radius" DOUBLE PRECISION,
    "lastModified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCoordinateSearch" BOOLEAN DEFAULT false,
    "lore" TEXT,
    "spoilers" TEXT,
    "noCluster" BOOLEAN DEFAULT false,
    "exactCoordinates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedBy" TEXT,
    "approvedBy" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);
