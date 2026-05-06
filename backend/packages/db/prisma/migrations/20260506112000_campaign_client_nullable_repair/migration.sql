ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_client_id_fkey";
ALTER TABLE "campaigns" ALTER COLUMN "client_id" DROP NOT NULL;
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_client_id_fkey"
  FOREIGN KEY ("client_id")
  REFERENCES "clients"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
