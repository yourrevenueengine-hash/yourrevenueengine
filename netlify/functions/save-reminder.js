// netlify/functions/save-reminder.js
// Saves or updates a member's reminder preferences in Netlify Blobs.
// Called from the ORE Reminders tab when a member sets or cancels their reminder.

import { getStore } from '@netlify/blobs';

export default async (req) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { email, time, tz, days, subscribed } = body;

  if (!email || typeof subscribed !== 'boolean') {
    return new Response('Missing required fields', { status: 400 });
  }

  // Netlify Blobs store — one record per member email
  const store = getStore('ore-reminders');

  if (!subscribed) {
    // Member unsubscribed — mark as inactive but keep their prefs
    const existing = await store.get(email, { type: 'json' }).catch(() => ({}));
    await store.setJSON(email, { ...existing, subscribed: false, updatedAt: new Date().toISOString() });
    return new Response(JSON.stringify({ ok: true, action: 'unsubscribed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate time format (HH:MM)
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return new Response('Invalid time format. Expected HH:MM', { status: 400 });
  }

  // Validate days array (0–6)
  if (!Array.isArray(days) || !days.length || days.some(d => d < 0 || d > 6)) {
    return new Response('Invalid days array', { status: 400 });
  }

  // Save member prefs
  const record = {
    email,
    time,       // "06:30" — 24hr, member's local time
    tz,         // "America/Los_Angeles" etc.
    days,       // [0,1,2,3,4,5,6] — days of week to send
    subscribed: true,
    updatedAt: new Date().toISOString()
  };

  await store.setJSON(email, record);

  return new Response(JSON.stringify({ ok: true, action: 'saved' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = {
  path: '/.netlify/functions/save-reminder'
};
