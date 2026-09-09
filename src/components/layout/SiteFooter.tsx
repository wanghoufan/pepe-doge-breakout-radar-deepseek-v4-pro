export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 py-8">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">风险提示与研究边界</p>
          <p className="mt-1.5">
            本站是基于历史市场事实的研究演示工具。所有指标、阈值与权重均为「候选规则」，
            样本仅来自 21 个已挑选的历史上涨行情，<b className="text-warn">未经失败样本或样本外检验</b>，
            不构成交易信号、投资建议或收益承诺。本站<b className="text-warn">不输出胜率、准确率、假突破概率或任何收益承诺</b>。
            加密货币波动极大，请独立思考并自行承担风险。
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <p>PEPE·DOGE·ETHFI 突破雷达 · 研究工具</p>
          <p>数据：OKX / Binance（实时，部署后可接入）· 历史快照（本地）</p>
        </div>
      </div>
    </footer>
  );
}