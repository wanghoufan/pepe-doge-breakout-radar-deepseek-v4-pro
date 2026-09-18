import { NextResponse } from 'next/server';
import { getVapidPublicKey, isPushConfigured } from '@/lib/server/push-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 下发 VAPID 公钥与可用状态（公钥可公开；私钥绝不外泄）。 */
export async function GET() {
  const configured = isPushConfigured();
  return NextResponse.json({
    ok: true,
    configured,
    publicKey: configured ? getVapidPublicKey() : null,
  });
}
