CREATE FUNCTION "notify_run_event_change"() RETURNS trigger AS $$
DECLARE
  run_user_id text;
BEGIN
  SELECT "user_id" INTO run_user_id FROM "runs" WHERE "id" = NEW."run_id";
  PERFORM pg_notify(
    'stoke_run_changes',
    json_build_object('runId', NEW."run_id", 'userId', run_user_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "run_events_notify_change"
AFTER INSERT ON "run_events"
FOR EACH ROW EXECUTE FUNCTION "notify_run_event_change"();--> statement-breakpoint
CREATE FUNCTION "notify_run_row_change"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'stoke_run_changes',
    json_build_object('runId', NEW."id", 'userId', NEW."user_id")::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "runs_notify_change"
AFTER INSERT OR UPDATE OF "status", "node_count", "cached_node_count", "error", "completed_at" ON "runs"
FOR EACH ROW EXECUTE FUNCTION "notify_run_row_change"();
