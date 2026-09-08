/** 展示格式化工具（时区统一 Asia/Shanghai，价格自适应精度）。 */

const TZ = 'Asia/Shanghai';

export function formatTs(ts: number | null, opts: Intl.DateTimeFormatOptions = {}): string {
  if (ts == null) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...opts,
  }).format(new Date(ts));
}

export function formatDate(ts: number | null): string {
  if (ts == null) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

/** 价格：根据数量级自适应小数位。 */
export function formatPrice(v: number | null, digits = 6): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (abs >= 0.01) return v.toFixed(4);
  if (abs >= 0.0001) return v.toFixed(6);
  return v.toExponential(4);
}

export function formatPct(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

export function formatRatio(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}x`;
}

/** 大数压缩（成交额等）。 */
export function formatCompact(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

/** 相对时间（新鲜度展示）。 */
export function relativeTime(ts: number | null): string {
  if (ts == null) return '未知';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

/** 时钟时间 HH:mm（Phase A：K 线区间展示全站一种，Asia/Shanghai）。 */
export function formatClock(ts: number | null): string {
  if (ts == null) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

export const TZ_LABEL = 'UTC+8 · 北京时间';