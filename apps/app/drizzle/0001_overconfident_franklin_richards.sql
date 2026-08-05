CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"path" text NOT NULL,
	"git_remote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checkouts" ADD CONSTRAINT "project_checkouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checkouts" ADD CONSTRAINT "project_checkouts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checkouts" ADD CONSTRAINT "project_checkouts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_last_seen_idx" ON "devices" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_checkouts_device_path_uidx" ON "project_checkouts" USING btree ("device_id","path");--> statement-breakpoint
CREATE INDEX "project_checkouts_project_idx" ON "project_checkouts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_checkouts_user_device_idx" ON "project_checkouts" USING btree ("user_id","device_id");