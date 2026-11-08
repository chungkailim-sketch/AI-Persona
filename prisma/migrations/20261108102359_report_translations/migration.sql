-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_lang_sourceHash_key" ON "ContentTranslation"("lang", "sourceHash");
