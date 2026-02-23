#!/bin/bash
# ============================================================================
# SB-OS Conversation Checkpoint Hook
# Fires on every UserPromptSubmit — saves conversation context BEFORE
# Claude processes the new request. This prevents context loss from
# context window compression.
# ============================================================================

# Read hook input from stdin
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
DATE=$(date +"%Y-%m-%d")

# Directories
MEMORY_DIR="$HOME/.claude/projects/-Users-sayedbaharun/memory"
CHECKPOINT_DIR="$MEMORY_DIR/checkpoints"
mkdir -p "$CHECKPOINT_DIR"

# Save a rolling checkpoint log (appended, one file per day)
CHECKPOINT_FILE="$CHECKPOINT_DIR/$DATE.log"
{
  echo "=== CHECKPOINT: $TIMESTAMP ==="
  echo "Session: $SESSION_ID"
  echo "User said: $PROMPT"
  echo ""
} >> "$CHECKPOINT_FILE"

# If transcript exists, save a snapshot (max every 5 minutes to avoid spam)
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  SNAPSHOT_FILE="$CHECKPOINT_DIR/${DATE}_transcript_latest.jsonl"
  LAST_SNAPSHOT_AGE=999

  if [ -f "$SNAPSHOT_FILE" ]; then
    LAST_MOD=$(stat -f %m "$SNAPSHOT_FILE" 2>/dev/null || stat -c %Y "$SNAPSHOT_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    LAST_SNAPSHOT_AGE=$(( (NOW - LAST_MOD) / 60 ))
  fi

  # Only copy transcript if >5 minutes since last snapshot
  if [ "$LAST_SNAPSHOT_AGE" -ge 5 ]; then
    cp "$TRANSCRIPT_PATH" "$SNAPSHOT_FILE"
  fi
fi

# Allow prompt to proceed
exit 0
