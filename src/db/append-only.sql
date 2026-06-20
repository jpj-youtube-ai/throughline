-- Enforce the append-only invariant for the event log at the database level,
-- not just by convention. Any UPDATE or DELETE against `events` raises.
CREATE OR REPLACE FUNCTION throughline_events_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_append_only ON events;
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION throughline_events_append_only();
