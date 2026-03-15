-- Persist optional run targets so new scouting can store creator-count goals.

ALTER TABLE "run_requests"
ADD COLUMN "target" integer;
