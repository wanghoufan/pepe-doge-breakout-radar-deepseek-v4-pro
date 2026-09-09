/**
 * UX 走查 15 项返修回归（纯函数层，不依赖网络/UI/声音）。
 * - MED-5：formatPricePlain 小币种全小数禁科学计数（UI 显示层；API 原样透出不动）。
 * - HIGH-2：ALERT_SEVERITY_STYLES 四严重度全覆盖。
 * - HIGH-3：summarizeSourceFreshness 摘要 + title 明细。
 * - HIGH-1/HIGH-4/MED-6~9/LOW-10~15 为纯展示层改动，由 ts-check + lint:build + build 覆盖。
 * Quant：NONE（阈值/权重零碰，见 config 审计测试仍在 ethfi.test.ts/v2.test.ts）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatPricePlain } from './format';
import { ALERT_SEVERITY_STYLES, buildAlertBody, type AlertSeverity } from './alert-center';
import { summarizeSourceFreshness } from './freshness';

test('UX-MED5-1：PEPE 量级展开全小数，无科学计数', () => {
  const out = formatPricePlain(0.000003605);
  assert.ok(!out.includes('e'), `含科学计数：${out}`);
  assert.ok(out.startsWith('0.0000036'), `非全小数：${out}`);
});

test('UX-MED5-2：API 浮点伪影输入同样展开（3.6462599999999995e-06）', () => {
  const out = formatPricePlain(3.6462599999999995e-06);
  assert.ok(!out.includes('e'), `含科学计数：${out}`);
  assert.ok(out.startsWith('0.00000364'), `非全小数：${out}`);
});

test('UX-MED5-3：ETHFI/DOGE/常规量级与 formatPrice 同口径', () => {
  assert.equal(formatPricePlain(0.5811), formatPrice(0.5811));
  assert.equal(formatPricePlain(0.6039), '0.6039');
  assert.equal(formatPricePlain(0.09), formatPrice(0.09));
  assert.equal(formatPricePlain(1234.567), formatPrice(1234.567));
  assert.equal(formatPricePlain(null), '—');
  assert.equal(formatPricePlain(0), '0');
});

test('UX-MED5-4：报警正文价格无科学计数（含突破位/失效位）', () => {
  const body = buildAlertBody('BREAKOUT_TRACK', 0.000003605, '新鲜', {
    breakoutLevel: 0.0000035,
    invalidationLevel: 0.0000034,
  });
  assert.ok(!body.includes('e-'), `正文含科学计数：${body}`);
  assert.ok(body.includes('0.000003605'), `当前价格未展开：${body}`);
});

test('UX-HIGH2-1：四严重度样式全覆盖（bar/title/badge 非空）', () => {
  const sevs: AlertSeverity[] = ['CRITICAL', 'IMPORTANT', 'WATCH', 'INFO'];
  for (const s of sevs) {
    const st = ALERT_SEVERITY_STYLES[s];
    assert.ok(st, `缺失 ${s}`);
    assert.ok(st.bar.length > 0 && st.title.length > 0 && st.badge.length > 0, `${s} 样式为空`);
  }
});

test('UX-HIGH2-2：四严重度视觉互异（禁全同样式）', () => {
  const keys = new Set(Object.values(ALERT_SEVERITY_STYLES).map((s) => `${s.bar}|${s.title}`));
  assert.equal(keys.size, 4, '严重度样式重复');
});

test('UX-HIGH3-1：全正常时摘要 N/N 路正常', () => {
  const { summary, title } = summarizeSourceFreshness([
    { label: 'K线 PEPE', status: 'ok', detail: 'K线PEPE·LIVE·刚刚' },
    { label: '现价 PEPE', status: 'ok', detail: '刚刚' },
  ]);
  assert.equal(summary, '来源新鲜度：2/2 路正常');
  assert.ok(title.includes('K线 PEPE') && title.includes('现价 PEPE'), `title 缺明细：${title}`);
});

test('UX-HIGH3-2：有异常时摘要标异常路数，title 保留全明细', () => {
  const { summary, title } = summarizeSourceFreshness([
    { label: 'K线 PEPE', status: 'ok', detail: 'K线PEPE·LIVE·刚刚' },
    { label: '资金费率 DOGE', status: 'stale', detail: '数据已过期' },
    { label: '现价 BTC', status: 'unavailable', detail: '无更新' },
  ]);
  assert.equal(summary, '来源新鲜度：1/3 路正常 · 2 路异常');
  assert.ok(title.includes('资金费率 DOGE') && title.includes('现价 BTC'), `title 缺明细：${title}`);
});
