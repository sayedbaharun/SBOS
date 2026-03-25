import cron from 'node-cron';
import { logger } from '../logger';

/**
 * Daily Reflection Reminder
 * Runs every day at 9 PM to remind the user to fill out their daily reflection.
 * Future enhancement: Send email or push notification.
 */
export function scheduleDailyReflectionReminder() {
  // Run every day at 21:00 (9 PM Dubai time)
  cron.schedule('0 21 * * *', async () => {
    try {
      logger.info('🌙 Daily Reflection Reminder: How was your day?');

      // TODO: Future enhancement - Send notification
      // Examples:
      // - Send email via Resend/SendGrid
      // - Send push notification via Firebase/OneSignal
      // - Send Telegram message
      // - Create a reminder task in the system

    } catch (error) {
      logger.error({ error }, 'Failed to send daily reflection reminder');
    }
  }, { timezone: 'Asia/Dubai' });

  logger.info('🌙 Daily reflection reminder scheduled (every day at 9 PM Dubai time)');
}
