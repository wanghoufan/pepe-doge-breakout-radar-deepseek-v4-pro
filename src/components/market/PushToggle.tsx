'use client';

/**
 * 全局推送（Web Push）订阅开关（默认关）。
 * - Notification.requestPermission + Service Worker 注册 + PushManager.subscribe；
 * - 订阅保存到服务端 SQLite（/api/push/subscribe），退订走 /api/push/unsubscribe；
 * - 状态显示：检测中/不支持/权限被拒/已关闭/已订阅/配置异常。
 * 关闭标签页后由服务端检查循环经 Web Push 送达系统通知。
 */
import { useCallback, useEffect, useState } from 'react';

type PushUiState = 'checking' | 'unsupported' | 'denied' | 'off' | 'on' | 'error';

const STATUS_TEXT: Record<PushUiState, string> = {
  checking: '检测中…',
  unsupported: '当前浏览器不支持系统推送（需 HTTPS/localhost + 支持 Push 的浏览器）',
  denied: '通知权限被拒绝，请到浏览器地址栏通知设置中手动允许后再试',
  off: '已关闭（默认关）',
  on: '已订阅：关闭标签页也能收到系统通知',
  error: '配置异常，请检查服务端 VAPID 配置',
};

/** VAPID 公钥 base64url → Uint8Array（PushManager applicationServerKey）。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushToggle() {
  const [state, setState] = useState<PushUiState>('checking');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setState('unsupported');
        return;
      }
      if ('Notification' in window && Notification.permission === 'denied') {
        if (!cancelled) setState('denied');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(sub ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('off');
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'off');
        setMsg('未获得通知权限，已保持关闭');
        return;
      }
      const cfgRes = await fetch('/api/push/config');
      const cfg = (await cfgRes.json()) as { configured?: boolean; publicKey?: string | null };
      if (!cfg.configured || !cfg.publicKey) {
        setState('error');
        setMsg('服务端未配置 VAPID 公钥（本地 .env.local 的 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY）');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
        }));
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      const out = (await res.json()) as { ok?: boolean; error?: string };
      if (!out.ok) {
        setState('error');
        setMsg(`订阅保存失败：${out.error ?? '未知原因'}`);
        return;
      }
      setState('on');
      setMsg('已开启全局推送');
    } catch (err) {
      setState('error');
      setMsg(err instanceof Error ? err.message : '订阅失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
      setMsg('已关闭全局推送');
    } catch (err) {
      setState('error');
      setMsg(err instanceof Error ? err.message : '退订失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const disabled = busy || state === 'checking' || state === 'unsupported' || state === 'denied';

  return (
    <div className="mt-2 rounded border border-border/60 p-2">
      <label className="flex items-center justify-between text-xs">
        <span>全局推送（关页也能收到系统通知）</span>
        <input
          type="checkbox"
          checked={state === 'on'}
          disabled={disabled}
          onChange={(e) => (e.target.checked ? void enable() : void disable())}
        />
      </label>
      <div className="mt-1 text-[11px] text-muted-foreground">{STATUS_TEXT[state]}</div>
      {state === 'on' && <div className="mt-1 text-[11px] text-muted-foreground">退订会同时删除服务端订阅记录。</div>}
      {msg && <div className="mt-1 text-[11px] text-warn">{msg}</div>}
    </div>
  );
}
