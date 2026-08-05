ALTER TABLE "runs" DROP CONSTRAINT "runs_checkout_id_project_checkouts_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_device_id_devices_id_fk";
--> statement-breakpoint
DROP INDEX "runs_active_fingerprint_uidx";--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "checkout_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "origin" text DEFAULT 'machine' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_checkout_id_project_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."project_checkouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_active_fingerprint_uidx" ON "runs" USING btree ("project_id","execution_key","fingerprint") WHERE "runs"."status" = 'running';