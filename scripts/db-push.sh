#!/bin/bash
# Script to push database schema changes to Railway PostgreSQL
# Usage: ./scripts/db-push.sh

# Uses DATABASE_URL from environment (set in .env or Railway)
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set. Export it or add to .env first."
  exit 1
fi

echo "🚀 Pushing database schema to Railway..."
echo ""

npx drizzle-kit push

echo ""
echo "✅ Database schema push complete!"
