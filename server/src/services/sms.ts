import { config } from '../config';

interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export function isSmsConfigured(): boolean {
  return !!(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PHONE_NUMBER);
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!isSmsConfigured()) {
    return { success: false, error: 'SMS provider not configured' };
  }

  const accountSid = config.TWILIO_ACCOUNT_SID!;
  const authToken = config.TWILIO_AUTH_TOKEN!;
  const fromNumber = config.TWILIO_PHONE_NUMBER!;

  // Normalize phone number to E.164
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }

  try {
    // Use Twilio REST API directly (no SDK dependency needed)
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: normalizedTo,
        From: fromNumber,
        Body: body,
      }).toString(),
    });

    const data = await response.json() as { sid?: string; message?: string };

    if (response.ok) {
      return { success: true, externalId: data.sid };
    } else {
      return { success: false, error: data.message || 'Failed to send SMS' };
    }
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function normalizePhoneNumber(phone: string): string | null {
  if (!phone) return null;
  // Strip everything except digits and leading +
  const cleaned = phone.replace(/[^\d+]/g, '');
  // If already E.164
  if (/^\+1\d{10}$/.test(cleaned)) return cleaned;
  // If 10-digit US number
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Return null for invalid numbers
  return null;
}

interface TemplateContext {
  first_name?: string;
  last_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  clinic_name?: string;
  clinic_phone?: string;
}

export function renderTemplate(template: string, context: TemplateContext): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return result;
}
