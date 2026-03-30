# SB-OS Automations

This directory contains all automation logic for SB-OS backend behaviors.

## Implemented Automations

### 1. Daily Day Auto-Creation (`daily-day-creation.ts`)
**Purpose**: Pre-create day records at midnight to ensure they're ready for health/nutrition entries and tasks.

**Schedule**: Runs daily at 00:00 (midnight)

**Logic**:
- Checks if day record exists for today's date
- If not, creates a new day record with ID `day_YYYY-MM-DD`
- Sets default title as `YYYY-MM-DD – [Untitled]`

**Implementation**:
```typescript
import { scheduleDailyDayCreation } from './automations/daily-day-creation';
scheduleDailyDayCreation();
```

### 2. Weekly Planning Reminder (`weekly-planning-reminder.ts`)
**Purpose**: Remind users to plan their week every Sunday evening.

**Schedule**: Runs every Sunday at 18:00 (6 PM)

**Future Enhancements**:
- Send email notification via Resend/SendGrid
- Send push notification via Firebase/OneSignal
- Send Telegram message
- Create a reminder task in the system

## Database-Level Automations

### 4. Task Completion Timestamp
**Location**: `/server/storage.ts` - `updateTask()` method

**Logic**:
```typescript
// When task status changes to 'done', set completedAt to current timestamp
if (updates.status === 'done' && !updates.completedAt) {
  updateData.completedAt = new Date();
}

// When task status changes from 'done' to something else, clear completedAt
if (updates.status && updates.status !== 'done') {
  updateData.completedAt = null;
}
```

**Test**:
```bash
curl -X PATCH http://localhost:5000/api/tasks/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
# Response should have completedAt timestamp

curl -X PATCH http://localhost:5000/api/tasks/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
# Response should have completedAt: null
```

### 5. Health Entry Auto-Link to Day
**Location**: `/server/routes.ts` - `POST /api/health`

**Logic**:
- Extracts date from health entry
- Calls `storage.getDayOrCreate(date)` to ensure day exists
- Links health entry to day via `dayId` field

**Test**:
```bash
curl -X POST http://localhost:5000/api/health \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-11-23",
    "sleep_hours": 7.5,
    "energy_level": 4,
    "mood": "high",
    "workout_done": true
  }'
# Response should show dayId: "day_2025-11-23"
```

### 6. Nutrition Entry Auto-Link to Day
**Location**: `/server/routes.ts` - `POST /api/nutrition`

**Logic**:
- Extracts date from datetime field
- Calls `storage.getDayOrCreate(date)` to ensure day exists
- Links nutrition entry to day via `dayId` field

**Test**:
```bash
curl -X POST http://localhost:5000/api/nutrition \
  -H "Content-Type: application/json" \
  -d '{
    "datetime": "2025-11-23T12:30:00Z",
    "meal_type": "lunch",
    "description": "Grilled chicken with quinoa",
    "calories": 650
  }'
# Response should show dayId: "day_2025-11-23"
```

## API-Level Automations

### 7. Project Completion Suggestion
**Location**: `/server/routes.ts` - `PATCH /api/tasks/:id`

**Logic**:
- When a task is marked as 'done'
- If task has a `projectId`
- Fetch all tasks for that project
- If all tasks are 'done', return a suggestion to mark project as complete

**Response Format**:
```json
{
  "task": { /* updated task */ },
  "suggestion": {
    "type": "project_completion",
    "message": "All tasks in project completed. Mark project as done?",
    "projectId": "proj_xxx"
  }
}
```

**Frontend Integration**:
Frontend should listen for `suggestion` field in PATCH /api/tasks/:id response and show a toast/modal asking user to mark project as done.

**Test**:
```bash
# 1. Create a project
curl -X POST http://localhost:5000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Project", "status": "active"}'
# Save project ID

# 2. Create 3 tasks for the project
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Task 1", "project_id": "PROJECT_ID", "status": "next"}'

curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Task 2", "project_id": "PROJECT_ID", "status": "next"}'

curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Task 3", "project_id": "PROJECT_ID", "status": "next"}'

# 3. Mark first two tasks as done
curl -X PATCH http://localhost:5000/api/tasks/TASK1_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'

curl -X PATCH http://localhost:5000/api/tasks/TASK2_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'

# 4. Mark last task as done - should get suggestion
curl -X PATCH http://localhost:5000/api/tasks/TASK3_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
# Response should contain suggestion object
```

### 8. Capture Conversion Logic
**Location**: `/server/routes.ts` - `POST /api/captures/:id/convert`
**Storage Method**: `/server/storage.ts` - `convertCaptureToTask()`

**Logic**:
- Takes capture item and task data
- Creates task with merged data (capture + provided task data)
- Marks capture as `clarified = true`
- Links capture to task via `linkedTaskId`

**Test**:
```bash
# 1. Create capture
curl -X POST http://localhost:5000/api/captures \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build new feature",
    "type": "idea",
    "source": "brain"
  }'
# Save capture ID

# 2. Convert to task
curl -X POST http://localhost:5000/api/captures/CAPTURE_ID/convert \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build new feature",
    "status": "next",
    "priority": "P1",
    "type": "business"
  }'
# Response should have:
# - task: newly created task
# - capture: updated capture with clarified=true and linkedTaskId set
```

## Testing

### Prerequisites
1. Valid PostgreSQL database (Neon or Railway)
2. DATABASE_URL environment variable set in `.env`
3. Database schema initialized (`npm run db:push`)

### Running Tests

**Full Test Suite** (requires database):
```bash
npx tsx server/test-automations.ts
```

**Manual Testing** (via API):
Use the curl commands provided in each automation section above.

**Verify Cron Jobs** (check server logs):
```bash
npm run dev
# Look for these log messages:
# ✓ SB-OS automations initialized (day creation, weekly planning, RAG embeddings, agent scheduler)
# 📅 Daily day creation automation scheduled (runs at midnight)
# 📆 Weekly planning reminder scheduled (Sundays at 6 PM)
```

### Common Issues

**Database Connection Error**:
```
Error: getaddrinfo EAI_AGAIN
```
**Solution**: Ensure DATABASE_URL is set to a valid PostgreSQL connection string, not SQLite (`file:./test.db`).

**Cron Jobs Not Running**:
**Solution**: Cron jobs are scheduled but won't execute until their scheduled time. Check logs to verify they're registered.

**Task Completion Timestamp Not Set**:
**Solution**: Ensure you're using PATCH /api/tasks/:id with `{"status": "done"}` in the request body.

## Architecture Notes

### Why `getDayOrCreate()`?
The `getDayOrCreate()` method ensures day records exist before linking health/nutrition entries. This pattern:
- Prevents foreign key constraint errors
- Simplifies client logic (no need to create day first)
- Enables automatic day creation on first entry

### Why Project Completion Suggestion?
Instead of auto-marking projects as done, we suggest it to the user:
- Gives user control over project lifecycle
- Allows user to verify all work is complete
- Prevents accidental status changes
- Provides better UX with confirmation dialog

### Cron Job Timing
- **Daily Day Creation (00:00)**: Pre-creates day record before user wakes up
- **Weekly Planning (Sunday 18:00)**: Weekend evening, time to plan ahead

## Future Enhancements

1. **Smart Task Scheduling**: Auto-suggest focus dates based on due dates and priorities
2. **Health Trend Analysis**: Weekly/monthly health reports via cron
3. **Nutrition Goal Tracking**: Auto-calculate daily nutrition totals
4. **Project Deadline Alerts**: Notify when project due date approaches
5. **Habit Streak Tracking**: Track consecutive days of health entries
6. **Email/Push Notifications**: Replace console.log with actual notifications
7. **Calendar Integration**: Sync tasks with Google Calendar
8. **AI-Powered Suggestions**: Use LLM to suggest task prioritization

## Maintenance

### Adding New Automations

1. Create file in `/server/automations/`
2. Export scheduling function
3. Import and call in `/server/index.ts`
4. Add documentation to this README
5. Add test to `/server/test-automations.ts`

### Modifying Cron Schedules

Cron format: `minute hour day month weekday`
- `0 0 * * *` = Daily at midnight
- `0 18 * * 0` = Sundays at 6 PM
- `0 9 * * 1-5` = Weekdays at 9 AM

### Debugging

Enable debug logging:
```typescript
import { logger } from '../logger';
logger.info({ data }, 'Automation triggered');
logger.error({ error }, 'Automation failed');
```

## Dependencies

- `node-cron`: Cron job scheduling
- `@types/node-cron`: TypeScript types for node-cron
- `drizzle-orm`: Database ORM
- `@neondatabase/serverless`: PostgreSQL driver

## License

Part of SB-OS project.
