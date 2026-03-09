import { Telegraf } from 'telegraf';
import { processMessage } from './ai-assistant';
import { storage } from './storage';
import { extractTextFromPhoto } from './photo-ocr';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn('TELEGRAM_BOT_TOKEN not set - Telegram bot will not start');
}

// Load authorized chat IDs from environment variable
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// Rate limiting: Map<chatId, { count: number; resetAt: number }>
const chatRateLimits = new Map<string, { count: number; resetAt: number }>();

// Cleanup expired rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  const expiredChatIds: string[] = [];
  chatRateLimits.forEach((limit, chatId) => {
    if (now > limit.resetAt) {
      expiredChatIds.push(chatId);
    }
  });
  expiredChatIds.forEach(chatId => chatRateLimits.delete(chatId));
}, 5 * 60 * 1000);

function checkRateLimit(chatId: string, maxRequests = 10, windowMs = 60000): boolean {
  const now = Date.now();
  const limit = chatRateLimits.get(chatId);

  if (!limit || now > limit.resetAt) {
    chatRateLimits.set(chatId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false;
  }

  limit.count++;
  return true;
}

export const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN, { handlerTimeout: 300_000 }) : null;

// Initialize bot if token exists
if (bot) {
  // Middleware: Access Control
  bot.use((ctx, next) => {
    const chatId = ctx.chat?.id.toString();

    // In production, REQUIRE authorized chat IDs - fail closed
    if (AUTHORIZED_CHAT_IDS.length === 0) {
      if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT) {
        console.error('⛔ CRITICAL: AUTHORIZED_TELEGRAM_CHAT_IDS not set in production - BLOCKING ALL ACCESS');
        return ctx.reply("⛔ Bot is misconfigured. Contact administrator.");
      }
      // Development mode: allow access but warn
      console.warn('⚠️ Development mode: No AUTHORIZED_TELEGRAM_CHAT_IDS configured - running in open mode');
      return next();
    }

    if (!chatId || !AUTHORIZED_CHAT_IDS.includes(chatId)) {
      console.warn(`⛔ Unauthorized access attempt from chat ID: ${chatId}`);
      return ctx.reply("⛔ Unauthorized. This is a private assistant.");
    }

    return next();
  });

  // Middleware: Rate Limiting
  bot.use((ctx, next) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) {
      return ctx.reply("Error: Unable to identify chat.");
    }

    if (!checkRateLimit(chatId)) {
      console.warn(`⏱️  Rate limit exceeded for chat ID: ${chatId}`);
      return ctx.reply("⏱️  You're sending messages too quickly. Please wait a moment and try again.");
    }

    return next();
  });

  // Handle /start command
  bot.command('start', async (ctx) => {
    await ctx.reply(
      `👋 Welcome to Aura, your AI personal assistant!\n\n` +
      `I can help you:\n` +
      `• View your schedule\n` +
      `• Check availability\n` +
      `• Book appointments\n` +
      `• Reschedule appointments\n` +
      `• Cancel appointments\n\n` +
      `Just send me a message like "What's my schedule tomorrow?" or "Book a meeting at 2pm"`
    );
  });

  // Handle all text messages
  bot.on('text', async (ctx) => {
    try {
      const chatId = ctx.chat.id.toString();
      const messageText = ctx.message.text;
      const firstName = ctx.from.first_name || '';
      const lastName = ctx.from.last_name || '';
      const username = ctx.from.username || '';
      
      // Save incoming user message
      await storage.createMessage({
        phoneNumber: chatId,
        messageContent: messageText,
        sender: 'user',
        messageType: 'text',
        platform: 'telegram',
        processed: false,
      });

      // Process message with AI
      const aiResponse = await processMessage(messageText, chatId, 'telegram');

      // Save assistant response
      await storage.createMessage({
        phoneNumber: chatId,
        messageContent: aiResponse,
        sender: 'assistant',
        messageType: 'text',
        platform: 'telegram',
        processed: true,
        aiResponse: aiResponse,
      });

      // Send response to user
      await ctx.reply(aiResponse);
    } catch (error) {
      console.error('Error processing Telegram message:', error);
      await ctx.reply('Sorry, I encountered an error processing your message. Please try again.');
    }
  });

  // Handle photo messages with OCR
  bot.on('photo', async (ctx) => {
    try {
      const chatId = ctx.chat.id.toString();
      const caption = ctx.message.caption || '';
      
      await ctx.reply('📸 Processing photo...');

      // Get the highest quality photo
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1];

      // Get download URL
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      
      // Extract text using GPT-4 Vision (directly from Telegram URL)
      const ocrResult = await extractTextFromPhoto(fileLink.href);

      // Guard: Check if OCR returned any text
      if (!ocrResult.extractedText || ocrResult.extractedText.trim().length === 0) {
        await ctx.reply('I couldn\'t extract any text from this photo. Please try again with a clearer image or add a caption to describe what you want to save.');
        return;
      }

      // Create quick note with OCR result and optional caption
      const noteContent = `${ocrResult.extractedText}${caption ? `\n\nCaption: ${caption}` : ''}`;
      
      // Process as a quick note command with OCR metadata hints
      const quickNoteMessage = `Save this as a quick note: ${noteContent}`;
      const aiResponse = await processMessage(quickNoteMessage, chatId, 'telegram');

      // Save photo message in history
      await storage.createMessage({
        phoneNumber: chatId,
        messageContent: `Photo note: ${noteContent}`,
        sender: 'user',
        messageType: 'photo',
        platform: 'telegram',
        processed: true,
      });

      // Save assistant response in history (symmetric with text handler)
      await storage.createMessage({
        phoneNumber: chatId,
        messageContent: aiResponse,
        sender: 'assistant',
        messageType: 'text',
        platform: 'telegram',
        processed: true,
        aiResponse: aiResponse,
      });

      // Send confirmation
      await ctx.reply(aiResponse);
    } catch (error) {
      console.error('Error processing photo message:', error);
      await ctx.reply('Sorry, I encountered an error processing your photo. Please try again.');
    }
  });

  // Error handling
  bot.catch((err: any, ctx: any) => {
    console.error(`Error for ${ctx.updateType}:`, err);
  });

  console.log('Telegram bot initialized successfully');
} else {
  console.log('Telegram bot not initialized - missing BOT_TOKEN');
}

// Setup webhook with secret token for security
export async function setupTelegramWebhook(webhookUrl: string) {
  if (!bot) {
    throw new Error('Telegram bot not initialized');
  }

  try {
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (webhookSecret) {
      // Set webhook with secret token for validation
      await bot.telegram.setWebhook(webhookUrl, {
        secret_token: webhookSecret
      });
      console.log(`Telegram webhook set to: ${webhookUrl} (with secret validation)`);
    } else {
      // Development mode: webhook without secret
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`⚠️ Telegram webhook set to: ${webhookUrl} (NO SECRET - development only)`);
    }
  } catch (error) {
    console.error('Failed to set Telegram webhook:', error);
    throw error;
  }
}

// Remove webhook (for development with polling)
export async function removeTelegramWebhook() {
  if (!bot) {
    throw new Error('Telegram bot not initialized');
  }

  try {
    await bot.telegram.deleteWebhook();
    console.log('Telegram webhook removed');
  } catch (error) {
    console.error('Failed to remove Telegram webhook:', error);
    throw error;
  }
}

/**
 * Send proactive message (briefings, suggestions) to a user
 * Used by scheduled jobs system
 */
export async function sendProactiveMessage(chatId: string, message: string): Promise<void> {
  if (!bot) {
    console.error('Cannot send proactive message: Bot not initialized');
    return;
  }

  try {
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
    });
    console.log(`Proactive message sent to ${chatId}`);
  } catch (error) {
    console.error(`Failed to send proactive message to ${chatId}:`, error);
    throw error;
  }
}
