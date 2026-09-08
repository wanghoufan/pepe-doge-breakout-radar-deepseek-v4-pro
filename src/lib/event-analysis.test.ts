import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_DEFS, computeEventMetrics } from './event-analysis';
import { parseISO } from './time';
import type { Candle } from './types';
import type { FundingRow } from './event-analysis';

const dataDir = path.resolve(process.cwd(), 'src/data');

function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T;
}

const pepeBars = loadJson<Candle[]>('candles/pepe-usdt-swap.json');
const dogeBars = loadJson<Candle[]>('candles/doge-usdt-swap.json');
const btcBars = loadJson<Candle[]>('candles/btc-usdt-swap.json');
const pepeFunding = loadJson<FundingRow[]>('funding/1000pepeusdt.json');
const dogeFunding = loadJson<FundingRow[]>('funding/dogeusdt.json');

const barsByCoin = { PEPE: pepeBars, DOGE: dogeBars };
const fundingByCoin = { PEPE: pepeFunding, DOGE: dogeFunding };

test('EVENT_DEFS 覆盖 21 个历史事件且使用完整 ISO 时间戳', () => {
  assert.equal(EVENT_DEFS.length, 21);
  const ids = EVENT_DEFS.map((e) => e.id);
  assert.equal(new Set(ids).size, 21);
  for (const e of EVENT_DEFS) {
    // 必须带 Z / 时区偏移，禁止裸日期
    assert.match(e.startIso, /Z$/);
    assert.match(e.endIso, /Z$/);
  }
});

test('时区整改：CST 日历日正确映射到 UTC ISO（P08 例）', () => {
  const p08 = EVENT_DEFS.find((e) => e.id === 'P08')!;
  // '2026-02-10'（北京时间 00:00）应等于 '2026-02-09T16:00:00Z'
  assert.equal(p08.startIso, '2026-02-09T16:00:00Z');
  assert.equal(parseISO(p08.startIso), Date.parse('2026-02-10T00:00:00+08:00'));
});

test('V2 重算：21 事件产出有效的 breakout 与 MFE/MAE', () => {
  for (const def of EVENT_DEFS) {
    const m = computeEventMetrics(def, barsByCoin[def.coin], btcBars, fundingByCoin[def.coin]);
    assert.equal(m.id, def.id);
    assert.ok(m.startTs < m.endTs, `${def.id} startTs 应早于 endTs`);
    if (m.breakoutTs != null) {
      assert.ok(m.breakoutLevel != null, `${def.id} 有突破必有 breakoutLevel`);
      assert.ok(m.breakoutClose != null, `${def.id} 有突破必有 breakoutClose`);
      assert.ok(m.mfe72h != null || m.mae72h != null, `${def.id} 突破后应有 MFE/MAE 之一`);
    }
  }
});

test('V2 重算：D01 暴露事后峰值 vs 突破后 72h 表现的口径差异', () => {
  // D01 事后峰值涨幅很大，但突破后 72h 表现应远低于峰值（说明事后波段≠策略收益）。
  const m = computeEventMetrics(EVENT_DEFS.find((e) => e.id === 'D01')!, dogeBars, btcBars, dogeFunding);
  assert.ok(m.coinPeakReturn > 100, 'D01 事后峰值应很大');
  assert.ok(m.mfe72h != null && m.mfe72h < m.coinPeakReturn, 'D01 突破后 72h MFE 应远低于事后峰值');
});
