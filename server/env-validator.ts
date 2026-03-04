import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates all required and optional environment variables at startup.
 * Fails fast with descriptive errors if critical variables are missing.
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ========================================
  // CRITICAL ENVIRONMENT VARIABLES (Required)
  // ========================================

  // Database
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required for database connection');
  } else if (!process.env.DATABASE_URL.startsWith('postgres://') && !process.env.DATABASE_URL.startsWith('postgresql://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection string (postgres:// or postgresql://...)');
  }

  // OpenRouter Integration (optional - AI features disabled without it)
  if (!process.env.OPENROUTER_API_KEY) {
    warnings.push('OPENROUTER_API_KEY not configured - AI features disabled');
  } else if (!process.env.OPENROUTER_API_KEY.startsWith('sk-or-')) {
    warnings.push('OPENROUTER_API_KEY may be invalid (should start with "sk-or-")');
  }

  // Google Calendar (required for core functionality)
  const hasGoogleCalendarCreds = process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!hasGoogleCalendarCreds) {
    if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) {
      warnings.push('GOOGLE_CALENDAR_CLIENT_ID not configured - Calendar integration disabled');
    }
    if (!process.env.GOOGLE_CALENDAR_CLIENT_SECRET) {
      warnings.push('GOOGLE_CALENDAR_CLIENT_SECRET not configured - Calendar integration disabled');
    }
    if (!process.env.GOOGLE_CALENDAR_REFRESH_TOKEN) {
      warnings.push('GOOGLE_CALENDAR_REFRESH_TOKEN not configured - Calendar integration disabled');
    }
  }

  // Google Drive (uses Calendar credentials if Drive-specific not set)
  const hasDriveCreds = (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID) &&
    (process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET) &&
    (process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);

  if (!hasDriveCreds) {
    warnings.push('Google Drive not configured - Knowledge Base sync disabled (set GOOGLE_DRIVE_* or reuse GOOGLE_CALENDAR_* credentials with Drive scope)');
  }

  // Gmail (optional but recommended)
  if (!process.env.GMAIL_CLIENT_ID) {
    warnings.push('GMAIL_CLIENT_ID not configured - Email integration disabled');
  }
  if (!process.env.GMAIL_CLIENT_SECRET) {
    warnings.push('GMAIL_CLIENT_SECRET not configured - Email integration disabled');
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    warnings.push('GMAIL_REFRESH_TOKEN not configured - Email integration disabled');
  }

  // Telegram Bot
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    warnings.push('TELEGRAM_BOT_TOKEN not configured - Telegram bot integration disabled');
  } else if (!process.env.TELEGRAM_BOT_TOKEN.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    warnings.push('TELEGRAM_BOT_TOKEN format is invalid (expected format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)');
  }

  if (!process.env.AUTHORIZED_TELEGRAM_CHAT_IDS) {
    warnings.push('AUTHORIZED_TELEGRAM_CHAT_IDS not configured - all Telegram chats will be allowed (security risk)');
  }

  // Telegram Webhook URL validation (Project Ironclad)
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    if (!process.env.TELEGRAM_WEBHOOK_URL.startsWith('https://')) {
      warnings.push('TELEGRAM_WEBHOOK_URL must use HTTPS — Telegram requires secure webhooks');
    }
    if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
      warnings.push('TELEGRAM_WEBHOOK_SECRET not set — webhook requests will not be validated (security risk)');
    }
  }

  // Session Secret - required in production, optional in development
  const isProduction = process.env.NODE_ENV === 'production';
  if (!process.env.SESSION_SECRET) {
    if (isProduction) {
      errors.push('SESSION_SECRET is required for secure session management in production');
    } else {
      warnings.push('SESSION_SECRET not set - using default for development only');
    }
  } else if (process.env.SESSION_SECRET.length < 32) {
    if (isProduction) {
      errors.push('SESSION_SECRET must be at least 32 characters in production');
    } else {
      warnings.push('SESSION_SECRET should be at least 32 characters for security');
    }
  }

  // Authentication mode
  if (isProduction || process.env.REQUIRE_AUTH === 'true') {
    warnings.push('Authentication is ENABLED - users must set up a password to access the app');
  } else {
    warnings.push('Authentication is DISABLED (development mode) - set NODE_ENV=production or REQUIRE_AUTH=true to enable');
  }

  // ========================================
  // OPTIONAL ENVIRONMENT VARIABLES (Warnings)
  // ========================================

  // Twilio (WhatsApp integration - optional)
  if (!process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN) {
    warnings.push('Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) not configured - WhatsApp integration disabled');
  } else if (!process.env.TWILIO_ACCOUNT_SID) {
    warnings.push('TWILIO_ACCOUNT_SID is missing - WhatsApp integration may not work');
  } else if (!process.env.TWILIO_AUTH_TOKEN) {
    warnings.push('TWILIO_AUTH_TOKEN is missing - WhatsApp integration may not work');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates environment and exits process if critical errors are found.
 * Logs warnings but allows startup to continue.
 */
export function validateEnvironmentOrExit(): void {
  logger.info('Validating environment variables...');

  const result = validateEnvironment();

  // Log warnings
  if (result.warnings.length > 0) {
    logger.warn('Environment validation warnings:');
    result.warnings.forEach(warning => {
      logger.warn(`  ⚠ ${warning}`);
    });
  }

  // Check for errors
  if (!result.valid) {
    logger.error('Environment validation failed! Critical environment variables are missing or invalid:');
    result.errors.forEach(error => {
      logger.error(`  ✗ ${error}`);
    });
    logger.error('\nPlease configure the required environment variables and restart the application.');
    process.exit(1);
  }

  logger.info('✓ Environment validation passed');
}
