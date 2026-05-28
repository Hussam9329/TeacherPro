import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { phone, message } = await req.json();
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v20.0';

  if (!phone || !message) {
    return NextResponse.json({ ok: false, error: 'phone and message are required' }, { status: 400 });
  }

  if (!token || !phoneNumberId) {
    return NextResponse.json({ ok: false, mode: 'dry-run', error: 'WhatsApp Business keys are not configured', phone, message });
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message, preview_url: false },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ ok: false, error: data }, { status: response.status });
  }
  return NextResponse.json({ ok: true, data });
}
