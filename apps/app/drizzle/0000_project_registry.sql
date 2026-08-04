CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "source_key" text NOT NULL UNIQUE,
  "source" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "projects_updated_at_idx"
  ON "projects" ("updated_at" DESC);
