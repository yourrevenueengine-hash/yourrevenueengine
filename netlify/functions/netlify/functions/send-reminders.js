// netlify/functions/send-reminders.js
// Scheduled function — runs every hour via cron.
// Checks all subscribed ORE members and sends a reminder email
// to anyone whose chosen send time falls within the current hour.
//
// Schedule: every hour on the hour
// Cron: "0 * * * *"
//
// Required environment variables (set in Netlify dashboard → Site → Environment):
//   GMAIL_USER     — your Gmail address (e.g. dustin@yourrevenueengine.com)
//   GMAIL_PASS     — Gmail App Password (16 chars, no spaces) — NOT your regular password
//   ORE_URL        — https://yourrevenueengine.com/ore.html
//   FROM_NAME      — Dustin @ Your Revenue Engine

import { getStore } from '@netlify/blobs';
import nodemailer from 'nodemailer';

// ─── EMAIL TEMPLATE ───────────────────────────────────────────────────────────
function buildEmail(toEmail, oreUrl) {
  const subject = `Your ORE is waiting. 5 minutes.`;

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; background: #0a0a0a; font-family: Arial, sans-serif; }
  .wrap { max-width: 540px; margin: 0 auto; padding: 40px 20px; }
  .tape { height: 8px; background: repeating-linear-gradient(-45deg, #f5c518 0px, #f5c518 14px, #0a0a0a 14px, #0a0a0a 22px); margin-bottom: 36px; }
  .eyebrow { font-size: 11px; font-weight: bold; letter-spacing: 4px; text-transform: uppercase; color: #f5c518; margin-bottom: 16px; }
  .headline { font-size: 36px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #f0ede8; line-height: 1; margin-bottom: 28px; }
  .body { font-size: 16px; color: #8a8880; line-height: 1.8; margin-bottom: 32px; }
  .body strong { color: #f0ede8; font-weight: 500; }
  .cta { display: inline-block; background: #f5c518; color: #0a0a0a; font-size: 13px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; padding: 14px 32px; text-decoration: none; }
  .footer { margin-top: 40px; font-size: 12px; color: #3a3530; line-height: 1.7; border-top: 1px solid #1a1a18; padding-top: 20px; }
  .footer a { color: #8a8880; }
</style>
</head>
<body>
<div class="wrap">
  <div class="tape"></div>
  <div class="eyebrow">// Daily Practice</div>
  <div class="headline">Your ORE<br>Is Waiting.</div>
  <div class="body">
    One project.<br>
    One action.<br>
    <strong>Five minutes.</strong><br><br>
    That's all today asks of you.<br><br>
    The thought that's been slowing you down?<br>
    It's still there. So is the tool that catches it.
  </div>
  <a href="${oreUrl}" class="cta">Open ORE &rarr;</a>
  <div class="footer">
    You're receiving this because you set a daily reminder in the ORE tool.<br>
    <a href="${oreUrl}">Log in to change your reminder time or unsubscribe.</a>
  </div>
</div>
</body>
</html>`;

  const text = `Your ORE is waiting. 5 minutes.\n\nOne project. One action. Five minutes.\n\nThat's all today asks.\n\nOpen ORE: ${oreUrl}\n\n---\nTo change your reminder time or unsubscribe, log into ORE: ${oreUrl}`;

  return { subject, html, text };
}

// ─── SHOULD SEND NOW? ─────────────────────────────────────────────────────────
// Returns true if the member's chosen time (in their timezone) matches
// the current UTC hour when converted. We check within the current hour window.
function shouldSendNow(record) {
  if (!record.subscribed || !record.time || !record.tz) return false;

  try {
    const now = new Date();

    // Get current time in member's timezone
    const memberNow = new Intl.DateTimeFormat('en-US', {
      timeZone: record.tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);

    const [currentH, currentM] = memberNow.split(':').map(Number);
    const [targetH, targetM]   = record.time.split(':').map(Number);

    // Match if we're within the same hour as their target time
    // (function runs every hour on the hour, so currentM will be 0–5)
    const currentDayInTz = new Intl.DateTimeFormat('en-US', {
      timeZone: record.tz,
      weekday: 'short'
    }).format(now);

    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDayNum = dayMap[currentDayInTz];

    const dayMatch = record.days.includes(currentDayNum);
    const hourMatch = currentH === targetH;

    return dayMatch && hourMatch;
  } catch {
    return false;
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async () => {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;
  const oreUrl    = process.env.ORE_URL || 'https://yourrevenueengine.com/ore.html';
  const fromName  = process.env.FROM_NAME || 'Dustin @ Your Revenue Engine';

  if (!gmailUser || !gmailPass) {
    console.error('Missing GMAIL_USER or GMAIL_PASS environment variables');
    return;
  }

  // Set up Gmail SMTP transporter
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailPass  // This is the App Password from Google, NOT your Gmail password
    }
  });

  // Load all member records from Netlify Blobs
  const store = getStore('ore-reminders');
  let keys;
  try {
    const list = await store.list();
    keys = list.blobs.map(b => b.key);
  } catch (err) {
    console.error('Failed to list Blobs store:', err);
    return;
  }

  if (!keys.length) {
    console.log('No members in store — nothing to send.');
    return;
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const key of keys) {
    let record;
    try {
      record = await store.get(key, { type: 'json' });
    } catch {
      skipped++;
      continue;
    }

    if (!record || !shouldSendNow(record)) {
      skipped++;
      continue;
    }

    const { subject, html, text } = buildEmail(record.email, oreUrl);

    try {
      await transporter.sendMail({
        from: `"${fromName}" <${gmailUser}>`,
        to: record.email,
        subject,
        html,
        text
      });
      sent++;
      console.log(`✓ Sent to ${record.email}`);
    } catch (err) {
      errors++;
      console.error(`✗ Failed to send to ${record.email}:`, err.message);
    }
  }

  console.log(`Done — sent: ${sent}, skipped: ${skipped}, errors: ${errors}`);
};

export const config = {
  schedule: '0 * * * *'  // Every hour on the hour
};
