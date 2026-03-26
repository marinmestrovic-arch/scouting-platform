-- Campaign-centric scouting, campaign reference tables, and run campaign snapshot linkage.

-- CreateTable
CREATE TABLE "clients" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "client_id" UUID NOT NULL,
  "market_id" UUID NOT NULL,
  "brief_link" TEXT,
  "month" "run_month" NOT NULL,
  "year" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "run_requests"
ADD COLUMN "campaign_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "clients_name_key" ON "clients"("name");

-- CreateIndex
CREATE INDEX "clients_created_at_idx" ON "clients"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "markets_name_key" ON "markets"("name");

-- CreateIndex
CREATE INDEX "markets_created_at_idx" ON "markets"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_name_client_market_month_year_key" ON "campaigns"("name", "client_id", "market_id", "month", "year");

-- CreateIndex
CREATE INDEX "campaigns_client_id_idx" ON "campaigns"("client_id");

-- CreateIndex
CREATE INDEX "campaigns_market_id_idx" ON "campaigns"("market_id");

-- CreateIndex
CREATE INDEX "campaigns_is_active_idx" ON "campaigns"("is_active");

-- CreateIndex
CREATE INDEX "campaigns_created_at_idx" ON "campaigns"("created_at");

-- CreateIndex
CREATE INDEX "run_requests_campaign_id_idx" ON "run_requests"("campaign_id");

-- AddForeignKey
ALTER TABLE "campaigns"
ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns"
ADD CONSTRAINT "campaigns_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns"
ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_requests"
ADD CONSTRAINT "run_requests_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
