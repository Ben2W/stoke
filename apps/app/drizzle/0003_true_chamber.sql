DROP INDEX "projects_user_source_key_uidx";--> statement-breakpoint
CREATE INDEX "projects_user_source_key_idx" ON "projects" USING btree ("user_id","source_key");