#!/bin/bash
# ============================================================================
# SB-OS Post-Response Checkpoint
# Fires after Claude finishes responding (Stop event).
# Saves the latest transcript snapshot so the full exchange is captured.
# ============================================================================

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
DATE=$(date +"%Y-%m-%d")
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

MEMORY_DIR="$HOME/.claude/projects/-Users-sayedbaharun/memory"
CHECKPOINT_DIR="$MEMORY_DIR/checkpoints"
mkdir -p "$CHECKPOINT_DIR"

# Always save transcript after a response completes
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  cp "$TRANSCRIPT_PATH" "$CHECKPOINT_DIR/${DATE}_transcript_latest.jsonl"
fi

# Log completion
echo "[$TIMESTAMP] Response complete (session: $SESSION_ID)" >> "$CHECKPOINT_DIR/$DATE.log"

exit 0
