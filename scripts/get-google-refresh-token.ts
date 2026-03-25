/**
 * One-time script to get a Google OAuth2 refresh token for nexus@revolvgroup.com.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/get-google-refresh-token.ts
 *
 * 1. Opens browser to Google consent screen
 * 2. Sign in as nexus@revolvgroup.com, grant calendar + email permissions
 * 3. Copies the refresh token from the terminal output
 * 4. Set it as GOOGLE_CALENDAR_REFRESH_TOKEN and GMAIL_REFRESH_TOKEN on Railway
 */

import { google } from 'googleapis';
import http from 'http';
import open from 'open';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3456/oauth/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.compose',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth/callback')) return;

  const url = new URL(req.url, `http://localhost:3456`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Done! Check your terminal for the refresh token.</h1>');

    console.log('\n========================================');
    console.log('REFRESH TOKEN (save this):');
    console.log(tokens.refresh_token);
    console.log('========================================');
    console.log('\nSet these on Railway:');
    console.log(`  GOOGLE_CALENDAR_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`  GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`  GOOGLE_CALENDAR_CLIENT_ID=${CLIENT_ID}`);
    console.log(`  GOOGLE_CALENDAR_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`  GMAIL_CLIENT_ID=${CLIENT_ID}`);
    console.log(`  GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log('========================================\n');
  } catch (err) {
    console.error('Token exchange failed:', err);
    res.writeHead(500);
    res.end('Token exchange failed');
  }

  server.close();
});

server.listen(3456, () => {
  console.log('Opening browser for Google OAuth consent...');
  console.log(`If it doesn't open, visit: ${authUrl}\n`);
  open(authUrl).catch(() => {
    // open may fail in some environments
  });
});
