-- CreateTable
CREATE TABLE "HeatmapDatapoint" (
  "id" SERIAL NOT NULL,
  "lat" JSONB NOT NULL,
  "intensity" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "weight" INTEGER NOT NULL,
  "radius" INTEGER NOT NULL DEFAULT 25,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastModified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "visible" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "HeatmapDatapoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatmapType" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "intensity" DOUBLE PRECISION,
  "colorBindings" JSONB,

  CONSTRAINT "HeatmapType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatmapDatapointType" (
  "datapointId" INTEGER NOT NULL,
  "typeId" INTEGER NOT NULL,

  CONSTRAINT "HeatmapDatapointType_pkey" PRIMARY KEY ("datapointId","typeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeatmapType_name_key" ON "HeatmapType"("name");

-- CreateIndex
CREATE INDEX "HeatmapDatapointType_datapointId_idx" ON "HeatmapDatapointType"("datapointId");

-- CreateIndex
CREATE INDEX "HeatmapDatapointType_typeId_idx" ON "HeatmapDatapointType"("typeId");

-- AddForeignKey
ALTER TABLE "HeatmapDatapointType" ADD CONSTRAINT "HeatmapDatapointType_datapointId_fkey" FOREIGN KEY ("datapointId") REFERENCES "HeatmapDatapoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatmapDatapointType" ADD CONSTRAINT "HeatmapDatapointType_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "HeatmapType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
