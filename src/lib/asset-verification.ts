/**
 * 逐币数据源核验（PRODUCT_PLAN V0.2 启用门）。
 *
 * 目的：把「候选」与「可启用」真正分层——只有在本模块逐项通过核验（instrument 存续/
 * 交易状态、4H K 线可拉取与必要长度、成交量字段、资金费率、精度、时间戳/收盘语义、
 * 应用真实请求、限频）的标的，才允许由服务端写入核验记录并置为 enabled。
 *
 * 冻结红线：
 * - 只做核验与证据记录，不复制、不修改任何阈值/权重/状态机；
 * - 复用 market-client 的真实第三方请求，失败逐项写清真实原因，绝不编造通过；
 * - 依赖可注入（测试用假数据，无需出网），默认走真实请求。
 */
import { DEFAULT_V2_THRESHOLDS } from './config';
import {
  getFundingByInst,
  getOkxCandlesByInst,
  getOkxSwapInstruments,
  getOkxTickersByInst,
  type FundingResult,
  type OkxCandles,
  type OkxSwapInstrument,
  type OkxTickersByInst,
  type Result,
} from './market-client';
import { findAsset, type RegistryAsset, type VerificationCheck } from './registry';

/** 4H 周期毫秒（时间戳/收盘语义核验用；与 time.ts 口径一致）。 */
const H4_MS = 4 * 3_600_000;

export interface VerificationDeps {
  fetchInstruments: () => Promise<Result<OkxSwapInstrument[]>>;
  fetchCandles: (instId: string, bar: string, limit: number) => Promise<Result<OkxCandles>>;
  fetchTicker: (instIds: string[]) => Promise<Result<OkxTickersByInst>>;
  fetchFunding: (instId: string, binanceSymbol: string | null) => Promise<Result<FundingResult>>;
  /** 必要已收盘 4H K 线根数（Rolling 突破回看 + 1，策略零改动，仅读阈值）。 */
  minConfirmedCandles: number;
}

export const defaultVerificationDeps: VerificationDeps = {
  fetchInstruments: getOkxSwapInstruments,
  fetchCandles: (instId, bar, limit) => getOkxCandlesByInst(instId, bar, limit),
  fetchTicker: (instIds) => getOkxTickersByInst(instIds),
  fetchFunding: (instId, binanceSymbol) => getFundingByInst(instId, binanceSymbol, 30),
  minConfirmedCandles: DEFAULT_V2_THRESHOLDS.breakoutLookbackCandles + 1,
};

export interface VerificationOutcome {
  assetId: string;
  instrument: string;
  ok: boolean;
  checks: VerificationCheck[];
}

const check = (key: string, label: string, ok: boolean, detail: string): VerificationCheck => ({ key, label, ok, detail });

/** 从结果诊断里检测是否命中限频（HTTP 429）。 */
function sawRateLimit(...results: Result<unknown>[]): boolean {
  return results.some(
    (r) => r.diag.httpStatus === 429 || r.diag.attempts.some((a) => a.httpStatus === 429),
  );
}

/**
 * 对单个已登记标的跑完整核验（真实请求）。asset 必须已在注册表中；
 * 未知标的由 verifyAssetById 处理。任一必需项失败 outcome.ok=false，并保留全部逐项原因。
 */
export async function verifyAsset(
  asset: RegistryAsset,
  deps: VerificationDeps = defaultVerificationDeps,
): Promise<VerificationOutcome> {
  const checks: VerificationCheck[] = [];

  const instRes = await deps.fetchInstruments();
  const instrument = instRes.ok ? instRes.data.find((i) => i.instId === asset.instId) : undefined;

  checks.push(
    !instRes.ok
      ? check('instrument', 'Instrument 存续与类型', false, `OKX 永续目录不可用：${instRes.diag.errorDetail ?? instRes.error}`)
      : !instrument
        ? check('instrument', 'Instrument 存续与类型', false, `OKX 永续目录未找到 ${asset.instId}`)
        : !asset.instId.endsWith('-USDT-SWAP')
          ? check('instrument', 'Instrument 存续与类型', false, `${asset.instId} 非 USDT 永续合约`)
          : check('instrument', 'Instrument 存续与类型', true, `目录已登记 ${asset.instId}（USDT 永续）`),
  );

  checks.push(
    !instrument
      ? check('tradable', '上线/可交易状态', false, 'Instrument 未获取，无法判定交易状态')
      : instrument.state === 'live'
        ? check('tradable', '上线/可交易状态', true, 'state=live（可交易）')
        : check('tradable', '上线/可交易状态', false, `state=${instrument.state}（非 live）`),
  );

  const candlesRes = await deps.fetchCandles(asset.instId, '4H', 120);
  const confirmed = candlesRes.ok ? candlesRes.data.confirmedCandles : [];
  const min = deps.minConfirmedCandles;
  checks.push(
    !candlesRes.ok
      ? check('candles', '4H K 线可拉取与长度', false, `4H K 线拉取失败：${candlesRes.diag.errorDetail ?? candlesRes.error}`)
      : confirmed.length < min
        ? check('candles', '4H K 线可拉取与长度', false, `已收盘 4H K 线 ${confirmed.length} 根 < 需求 ${min}`)
        : check('candles', '4H K 线可拉取与长度', true, `4H 已收盘 ${confirmed.length} 根 ≥ ${min}`),
  );

  const last = confirmed.at(-1);
  checks.push(
    !candlesRes.ok || !last
      ? check('volume', '成交量字段', false, 'K 线不可用，无法核验成交量字段')
      : Number.isFinite(last.vol) && last.vol > 0
        ? check('volume', '成交量字段', true, `vol=${last.vol}，quoteVol=${last.quoteVol}`)
        : Number.isFinite(last.quoteVol) && last.quoteVol > 0
          ? check('volume', '成交量字段', true, `quoteVol=${last.quoteVol}（vol 缺失）`)
          : check('volume', '成交量字段', false, `成交量字段缺失或非正：vol=${last.vol}，quoteVol=${last.quoteVol}`),
  );

  checks.push(
    !instrument
      ? check('precision', '价格与数量精度', false, 'Instrument 未获取，无法判定精度')
      : (() => {
          const tick = Number(instrument.tickSz);
          const lot = Number(instrument.lotSz);
          const ok = Number.isFinite(tick) && tick > 0 && Number.isFinite(lot) && lot > 0;
          return check(
            'precision',
            '价格与数量精度',
            ok,
            ok
              ? `tickSz=${instrument.tickSz}，lotSz=${instrument.lotSz}，minSz=${instrument.minSz ?? '—'}`
              : `精度字段缺失或非正：tickSz=${instrument.tickSz ?? 'null'}，lotSz=${instrument.lotSz ?? 'null'}`,
          );
        })(),
  );

  checks.push(
    !candlesRes.ok || !last
      ? check('timestamp', '时间戳/收盘语义', false, 'K 线不可用，无法核验时间戳')
      : (() => {
          const aligned = last.ts % H4_MS === 0;
          const notFuture = last.ts <= Date.now() + H4_MS;
          const ok = aligned && notFuture;
          return check(
            'timestamp',
            '时间戳/收盘语义',
            ok,
            ok
              ? `末日线 ${new Date(last.ts).toISOString()}（4H 对齐，已收盘）`
              : `时间戳异常：ts=${last.ts}（4H 对齐=${aligned}）`,
          );
        })(),
  );

  const fundingRes = await deps.fetchFunding(asset.instId, asset.fundingBinanceSymbol);
  checks.push(
    !fundingRes.ok
      ? check('funding', '资金费率可用性', false, `资金费率不可用：${fundingRes.diag.errorDetail ?? fundingRes.error}`)
      : fundingRes.data.points.length === 0
        ? check('funding', '资金费率可用性', false, `${fundingRes.data.provider} 返回 0 条`)
        : check(
            'funding',
            '资金费率可用性',
            true,
            `${fundingRes.data.provider} 可用，${fundingRes.data.points.length} 条`,
          ),
  );

  const tickerRes = await deps.fetchTicker([asset.instId]);
  const ticker = tickerRes.ok ? tickerRes.data[asset.instId] : undefined;
  checks.push(
    !tickerRes.ok
      ? check('realRequest', '应用真实请求结果', false, `最新价请求失败：${tickerRes.diag.errorDetail ?? tickerRes.error}`)
      : !ticker || !Number.isFinite(ticker.last) || ticker.last <= 0
        ? check('realRequest', '应用真实请求结果', false, '最新价请求未返回该标的有效价格')
        : check(
            'realRequest',
            '应用真实请求结果',
            true,
            `最新价 ${ticker.last}（${new Date(ticker.ts).toISOString()}）`,
          ),
  );

  const rateLimited = sawRateLimit(instRes, candlesRes, tickerRes, fundingRes);
  checks.push(
    rateLimited
      ? check('rateLimit', '限频响应', false, '核验期间遇到 HTTP 429 限频')
      : check('rateLimit', '限频响应', true, '核验期间未触发限频（无 429）'),
  );

  return {
    assetId: asset.id,
    instrument: asset.instId,
    ok: checks.every((c) => c.ok),
    checks,
  };
}

/** 未知标的：不发起请求，直接给出可解释的失败项（测试与 API 共用）。 */
export function unknownAssetOutcome(id: string): VerificationOutcome {
  return {
    assetId: id,
    instrument: id,
    ok: false,
    checks: [check('resolve', '标的登记', false, `未知标的 ${id}：不在 OKX 永续候选目录`)],
  };
}

/**
 * 按 id 解析并核验：先查注册表，未知标的返回 unknownAssetOutcome（不发网络请求）。
 * 返回 asset（null 表示未登记）与 outcome，供 API 落库与响应。
 */
export async function verifyAssetById(
  id: string,
  registry: RegistryAsset[],
  deps: VerificationDeps = defaultVerificationDeps,
): Promise<{ asset: RegistryAsset | null; outcome: VerificationOutcome }> {
  const asset = findAsset(id, registry);
  if (!asset) return { asset: null, outcome: unknownAssetOutcome(id) };
  return { asset, outcome: await verifyAsset(asset, deps) };
}

export interface VerifyHttpResponse {
  status: number;
  body: {
    ok: boolean;
    id: string;
    instrument: string;
    checks: VerificationCheck[];
    message: string;
    /** 仅 200 全过分支存在。 */
    enabled?: boolean;
  };
}

/**
 * outcome → HTTP 映射（纯函数，便于 route 级测试）。
 * 分支顺序与启用门一致：未知标的 422 → 核验未过 422 → 持久化不可用 503 → 全过 200。
 * 200 分支不含 verifiedAt（落库时间由 route 在写入后附加）。
 */
export function mapVerifyOutcomeToHttp(
  outcome: VerificationOutcome,
  assetExists: boolean,
  dbNull: boolean,
): VerifyHttpResponse {
  if (!assetExists) {
    return {
      status: 422,
      body: {
        ok: false,
        id: outcome.assetId,
        instrument: outcome.instrument,
        checks: outcome.checks,
        message: `未知标的 ${outcome.assetId}：不在 OKX 永续候选目录`,
      },
    };
  }
  if (!outcome.ok) {
    const firstFail = outcome.checks.find((c) => !c.ok);
    return {
      status: 422,
      body: {
        ok: false,
        id: outcome.assetId,
        instrument: outcome.instrument,
        checks: outcome.checks,
        message: `核验未通过：${firstFail ? `${firstFail.label} — ${firstFail.detail}` : '存在失败项'}；未启用`,
      },
    };
  }
  if (dbNull) {
    return {
      status: 503,
      body: {
        ok: false,
        id: outcome.assetId,
        instrument: outcome.instrument,
        checks: outcome.checks,
        message: '核验全部通过，但配置持久化当前不可用，未能写入启用记录（未启用）',
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      id: outcome.assetId,
      instrument: outcome.instrument,
      enabled: true,
      checks: outcome.checks,
      message: '核验全部通过，已启用（可放入卡槽）',
    },
  };
}
