import { NextResponse } from 'next/server';
import { getHistoricalEvents } from '@/lib/data-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const events = getHistoricalEvents();
  return NextResponse.json({ ok: true, count: events.length, data: events });
}