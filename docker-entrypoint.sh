#!/bin/bash
set -e

# Wait for database
echo "Waiting for database to be ready..."
until bun run wait-db; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is up - continuing"

# Run any pending migrations
echo "Initializing database..."
bun run db:init

# Start the application
echo "Starting application..."
exec "$@"
