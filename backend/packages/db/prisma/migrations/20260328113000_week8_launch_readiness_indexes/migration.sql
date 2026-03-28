CREATE INDEX "advanced_report_requests_status_created_at_idx"
ON "advanced_report_requests"("status", "created_at");

CREATE INDEX "csv_import_batches_status_created_at_idx"
ON "csv_import_batches"("status", "created_at");

CREATE INDEX "csv_export_batches_requested_by_user_id_created_at_idx"
ON "csv_export_batches"("requested_by_user_id", "created_at");

CREATE INDEX "hubspot_push_batches_requested_by_user_id_created_at_idx"
ON "hubspot_push_batches"("requested_by_user_id", "created_at");

CREATE INDEX "hubspot_import_batches_requested_by_user_id_created_at_idx"
ON "hubspot_import_batches"("requested_by_user_id", "created_at");

CREATE INDEX "run_requests_requested_by_user_id_created_at_idx"
ON "run_requests"("requested_by_user_id", "created_at");

CREATE INDEX "run_requests_campaign_manager_user_id_created_at_idx"
ON "run_requests"("campaign_manager_user_id", "created_at");

CREATE INDEX "run_requests_client_created_at_idx"
ON "run_requests"("client", "created_at");

CREATE INDEX "run_requests_market_created_at_idx"
ON "run_requests"("market", "created_at");
