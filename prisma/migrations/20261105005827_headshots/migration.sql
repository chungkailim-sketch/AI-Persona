-- CreateTable
CREATE TABLE "Headshot" (
    "key" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/svg+xml',
    "source" TEXT NOT NULL DEFAULT 'illustration',
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Headshot_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Headshot_region_gender_idx" ON "Headshot"("region", "gender");
