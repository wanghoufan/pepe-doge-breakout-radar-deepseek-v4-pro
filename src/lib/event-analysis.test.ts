import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_DEFS, computeEventMetrics } from './event-analysis';
import type { Candle } from './types';
import type { FundingRow } from './event-analysis';

/**
 * 回归测试：用资料包 `03_量化数据` 的原始 K 线 / 资金费率快照重新计算，
 * 与预生成的 `event_metrics.json` 逐字段比对，保证实现口径未发生漂移。
 */

const dataDir = path.resolve(process.cwd(), 'src/data');

function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T;
}

const pepeBars = loadJson<Candle[]>('candles/pepe-usdt-swap.json');
const dogeBars = loadJson<Candle[]>('candles/doge-usdt-swap.json');
const btcBars = loadJson<Candle[]>('candles/btc-usdt-swap.json');
const pepeFunding = loadJson<FundingRow[]>('funding/1000pepeusdt.json');
const dogeFunding = loadJson<FundingRow[]>('funding/dogeusdt.json');

const stored = loadJson<
  Array<Record<string, number | string | boolean | null>>
>('event-metrics.json');

const barsByCoin = { PEPE: pepeBars, DOGE: dogeBars };
const fundingByCoin = { PEPE: pepeFunding, DOGE: dogeFunding };

const NUMERIC_FIELDS = [
  'startTs',
  'endTs',
  'preReturnPct',
  'preRangePct',
  'preAtrPct',
  'compressionRatio',
  'preVolumeRatio',
  'breakoutDelayHours',
  'breakoutVolRatio',
  'first48AvgVolRatio',
  'eventLow',
  'eventHigh',
  'coinPeakReturn',
  'eventMaxDrawdown',
  'btcReturnPct',
  'btcPeakReturnPct',
  'btcMaxDrawdown',
  'relativePeakVsBtc',
  'preFundingAvgPct',
  'preFundingMaxPct',
  'eventFundingAvgPct',
  'eventFundingMaxPct',
  'eventFundingOverheatRate',
] as const;

test('EVENT_DEFS 覆盖全部 21 个历史事件', () => {
  assert.equal(EVENT_DEFS.length, 21);
  const ids = EVENT_DEFS.map((e) => e.id);
  assert.equal(new Set(ids).size, 21);
});

test('回归：21 个事件关键指标与 event_metrics.json 一致', () => {
  const storedById = new Map(stored.map((r) => [r.id, r]));

  for (const def of EVENT_DEFS) {
    const expected = storedById.get(def.id);
    assert.ok(expected, `缺少预计算记录：${def.id}`);

    const computed = computeEventMetrics(
      def,
      barsByCoin[def.coin],
      btcBars,
      fundingByCoin[def.coin],
    );

    // 布尔字段严格相等
    assert.equal(computed.startAboveEma20, expected.startAboveEma20, `${def.id} startAboveEma20`);
    assert.equal(computed.emaBullishStack, expected.emaBullishStack, `${def.id} emaBullishStack`);
    assert.equal(computed.breakoutTs ?? null, expected.breakoutTs ?? null, `${def.id} breakoutTs`);

    // 数值字段在浮点容差内一致
    for (const f of NUMERIC_FIELDS) {
      const a = computed[f] as number | null;
      const b: number | string | null = (expected[f] as number | string | null) ?? null;
      const bNum: number | null = typeof b === 'string' ? (b === '' ? null : Number(b)) : b;
      if (a == null || bNum == null) {
        assert.equal(a, bNum, `${def.id}.${f} 一方为空`);
        continue;
      }
      const diff = Math.abs(a - bNum);
      const tol = Math.max(1e-6, Math.abs(bNum) * 1e-6);
      assert.ok(diff <= tol, `${def.id}.${f} 偏差过大：computed=${a} stored=${bNum} diff=${diff}`);
    }
  }
});