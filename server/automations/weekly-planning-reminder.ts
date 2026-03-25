import cron from 'node-cron';
import { logger } from '../logger';

/**
 * Weekly Planning Reminder
 * Runs every Sunday at 6 PM to remind the user to plan their week.
 * Future enhancement: Send email or push notification.
 */
export function scheduleWeeklyPlanningReminder() {
  // Run every Sunday at 18:00 (6 PM Dubai time)
  cron.schedule('0 18 * * 0', async () => {
    try {
      logger.info('📅 Weekly Planning Reminder: Time to plan your week!');

      // TODO: Future enhancement - Send notification
      // Examples:
      // - Send email via Resend/SendGrid
      // - Send push notification via Firebase/OneSignal
      // - Send Telegram message
      // - Create a reminder task in the system

    } catch (error) {
      logger.error({ error }, 'Failed to send weekly planning reminder');
    }
  }, { timezone: 'Asia/Dubai' });

  logger.info('📆 Weekly planning reminder scheduled (Sundays at 6 PM Dubai time)');
}
