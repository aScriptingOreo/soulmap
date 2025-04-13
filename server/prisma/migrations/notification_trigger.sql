-- Create a function that sends notifications when locations are changed
CREATE OR REPLACE FUNCTION notify_location_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify a channel called "location_changes" with the operation type
  PERFORM pg_notify('location_changes', json_build_object(
    'operation', TG_OP,
    'table', TG_TABLE_NAME,
    'id', CASE 
      WHEN TG_OP = 'DELETE' THEN OLD.id
      ELSE NEW.id
    END
  )::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for inserts, updates, and deletes
DROP TRIGGER IF EXISTS location_changes_trigger ON "Location";

CREATE TRIGGER location_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON "Location"
FOR EACH ROW
EXECUTE FUNCTION notify_location_changes();
