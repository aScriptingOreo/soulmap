-- Create or replace the function for triggering notifications
CREATE OR REPLACE FUNCTION notify_location_changes()
RETURNS trigger AS $$
BEGIN
  -- Construct the payload with information about what changed
  PERFORM pg_notify(
    'location_changes',
    json_build_object(
      'action', TG_OP,
      'table', TG_TABLE_NAME,
      'id', NEW.id,
      'timestamp', NOW()
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS location_changes_trigger ON "Location";

-- Create the trigger on the Location table
CREATE TRIGGER location_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON "Location"
FOR EACH ROW
EXECUTE FUNCTION notify_location_changes();
