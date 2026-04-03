import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { logger } from './logger';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
];

type GmailAccount = "default" | "syntheliq";

function createOAuth2Client(account: GmailAccount = "default") {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = account === "syntheliq"
    ? process.env.SYNTHELIQ_GMAIL_REFRESH_TOKEN
    : process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:5000/oauth/gmail/callback');

  if (refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });
  }

  return { oauth2Client, refreshToken };
}

export function getAuthUrl(): string | null {
  const result = createOAuth2Client();
  if (!result) {
    return null;
  }

  return result.oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
  });
}

export async function getTokensFromCode(code: string) {
  const result = createOAuth2Client();
  if (!result) {
    throw new Error('OAuth2 client not configured');
  }

  const { tokens } = await result.oauth2Client.getToken(code);
  return tokens;
}

export async function getUncachableGmailClient(account: GmailAccount = "default") {
  const result = createOAuth2Client(account);

  if (!result || !result.refreshToken) {
    const envVar = account === "syntheliq" ? "SYNTHELIQ_GMAIL_REFRESH_TOKEN" : "GMAIL_REFRESH_TOKEN";
    throw new Error(`Gmail not connected for account "${account}". Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and ${envVar} environment variables.`);
  }

  try {
    const { credentials } = await result.oauth2Client.refreshAccessToken();
    result.oauth2Client.setCredentials(credentials);
    return google.gmail({ version: 'v1', auth: result.oauth2Client });
  } catch (error: any) {
    logger.error({ error: error?.message || error, account }, 'Failed to refresh Gmail access token');
    throw new Error(`Failed to authenticate with Gmail (account: ${account})`);
  }
}

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: Date;
  labelIds?: string[];
  isUnread: boolean;
}

export async function listMessages(options: {
  maxResults?: number;
  query?: string;
  labelIds?: string[];
  account?: GmailAccount;
}): Promise<EmailMessage[]> {
  const gmail = await getUncachableGmailClient(options.account);

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults: options.maxResults || 10,
    q: options.query,
    labelIds: options.labelIds,
  });

  const messages = response.data.messages || [];

  const fullMessages: EmailMessage[] = [];
  for (const message of messages) {
    if (!message.id) continue;

    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full',
    });

    const headers = fullMessage.data.payload?.headers || [];
    const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
    const to = headers.find(h => h.name?.toLowerCase() === 'to')?.value || '';
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
    const dateStr = headers.find(h => h.name?.toLowerCase() === 'date')?.value || '';

    // Helper function to decode Gmail's URL-safe base64
    const decodeBase64Url = (data: string): string => {
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      const paddedBase64 = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      return Buffer.from(paddedBase64, 'base64').toString('utf-8');
    };

    let body = '';
    if (fullMessage.data.payload?.body?.data) {
      body = decodeBase64Url(fullMessage.data.payload.body.data);
    } else if (fullMessage.data.payload?.parts) {
      const textPart = fullMessage.data.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = decodeBase64Url(textPart.body.data);
      }
    }

    const isUnread = fullMessage.data.labelIds?.includes('UNREAD') || false;

    fullMessages.push({
      id: message.id,
      threadId: fullMessage.data.threadId || '',
      from,
      to,
      subject,
      snippet: fullMessage.data.snippet || '',
      body,
      date: new Date(dateStr),
      labelIds: fullMessage.data.labelIds || undefined,
      isUnread,
    });
  }

  return fullMessages;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmail = await getUncachableGmailClient();

    const message = [
      `To: ${options.to}`,
      `Subject: ${options.subject}`,
      '',
      options.body,
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Save as draft instead of sending directly — Sayed reviews before sending
    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: encodedMessage,
          threadId: options.threadId || undefined,
        },
      },
    });

    logger.info({ draftId: response.data.id, to: options.to, subject: options.subject }, 'Email saved as draft');

    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to create draft',
    };
  }
}

export async function searchEmails(query: string, maxResults: number = 10): Promise<EmailMessage[]> {
  return listMessages({ query, maxResults });
}

export async function getUnreadCount(): Promise<number> {
  const gmail = await getUncachableGmailClient();

  const response = await gmail.users.labels.get({
    userId: 'me',
    id: 'UNREAD',
  });

  return response.data.messagesUnread || 0;
}

export async function markAsRead(messageIds: string[], account: GmailAccount = "default"): Promise<void> {
  const gmail = await getUncachableGmailClient(account);

  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids: messageIds,
      removeLabelIds: ['UNREAD'],
    },
  });
}

export async function addLabel(messageIds: string[], labelId: string): Promise<void> {
  const gmail = await getUncachableGmailClient();

  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids: messageIds,
      addLabelIds: [labelId],
    },
  });
}
