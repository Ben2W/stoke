CREATE TABLE "run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"operation" text NOT NULL,
	"workflow" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"node_count" integer,
	"cached_node_count" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_checkout_id_project_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."project_checkouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_events_run_id_id_idx" ON "run_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_active_fingerprint_uidx" ON "runs" USING btree ("project_id","checkout_id","fingerprint") WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "runs_user_started_at_idx" ON "runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_project_started_at_idx" ON "runs" USING btree ("project_id","started_at");