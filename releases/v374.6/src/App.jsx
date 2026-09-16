import { startTransition, useEffect, useMemo, useRef, useState } from "react";

const BOT_API_BASE = import.meta.env.VITE_BOT_API_BASE || window.location.origin;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usd(value, digits = 2) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number(value));
}

function pct(value, digits = 1) {
  const v = number(value);
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}%`;
}

function useAnimatedValue(target, duration = 400) {
  const [display, setDisplay] = useState(number(target));

  useEffect(() => {
    const from = display;
    const to = number(target);
    if (Math.abs(from - to) < 0.0001) return;
    const start = performance.now();
    let raf = 0;

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}

function AnimatedUsd({ value, digits = 2 }) {
  const animated = useAnimatedValue(value);
  return <>{usd(animated, digits)}</>;
}

function AnimatedNumber({ value, digits = 1, suffix = "" }) {
  const animated = useAnimatedValue(value);
  return <>{number(animated).toFixed(digits)}{suffix}</>;
}

function time(value) {
  if (!value) return "--:--:--";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function dateTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusLabel(value = "") {
  return String(value || "unknown").replace(/^paper_/, "").replaceAll("_", " ").toUpperCase();
}

function settlementLabel(signal = {}) {
  return signal.settlementLabel || String(signal.settlementFinality || signal.settlementSource || "pending")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortTitle(value = "") {
  return String(value || "Unknown market")
    .replace(/^Bitcoin Up or Down -\s*/i, "BTC ")
    .replace(/^Ethereum Up or Down -\s*/i, "ETH ")
    .replace(/^Solana Up or Down -\s*/i, "SOL ")
    .replace(/^Dogecoin Up or Down -\s*/i, "DOGE ")
    .replace(/^XRP Up or Down -\s*/i, "XRP ")
    .replace(/^BNB Up or Down -\s*/i, "BNB ");
}

function windowLabel(start, end) {
  if (!start && !end) return "--";
  return `${time(start)}-${time(end)}`;
}

function ageMs(value) {
  const n = number(value, -1);
  if (n < 0) return "--";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function className(...items) {
  return items.filter(Boolean).join(" ");
}

function useBotState() {
  const [state, setState] = useState(null);
  const [offline, setOffline] = useState(false);
  const [lastUiUpdateAt, setLastUiUpdateAt] = useState(null);
  const [actionStatus, setActionStatus] = useState(null);
  const lastEventAtRef = useRef(0);
  const lastRealtimeAtRef = useRef("");

  function applyState(json) {
    if (!json || json.realtimeAt === lastRealtimeAtRef.current) return;
    lastRealtimeAtRef.current = json.realtimeAt || new Date().toISOString();
    startTransition(() => {
      setState(json);
      setLastUiUpdateAt(new Date().toISOString());
      setOffline(false);
    });
  }

  async function load({ force = false } = {}) {
    if (!force && Date.now() - lastEventAtRef.current < 2500) return state;
    const res = await fetch(`${BOT_API_BASE}/api/v3/ui-state`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    applyState(json);
    return json;
  }

  async function postApi(path, label) {
    setActionStatus({ label, status: "running" });
    try {
      const res = await fetch(`${BOT_API_BASE}${path}`, { method: "POST", cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load({ force: true }).catch(() => null);
      setActionStatus({ label, status: "ok", detail: json });
      return json;
    } catch (error) {
      setActionStatus({ label, status: "error", error: error instanceof Error ? error.message : "request_failed" });
      throw error;
    }
  }

  useEffect(() => {
    let closed = false;
    let events;

    async function safeLoad() {
      try {
        if (!closed) await load();
      } catch {
        if (!closed) setOffline(true);
      }
    }

    safeLoad();
    const fallbackTimer = window.setInterval(safeLoad, 1000);

    try {
      events = new EventSource(`${BOT_API_BASE}/api/events/ui`);
      events.onmessage = (event) => {
        if (!closed) {
          try {
            lastEventAtRef.current = Date.now();
            applyState(JSON.parse(event.data));
          } catch {
            setOffline(true);
          }
        }
      };
      events.onerror = () => !closed && setOffline(true);
    } catch {
      events = null;
    }

    return () => {
      closed = true;
      events?.close();
      window.clearInterval(fallbackTimer);
    };
  }, []);

  return { state, offline, lastUiUpdateAt, actionStatus, postApi };
}

// -------------------------------------------------------------
// COMPONENT 1: FLAT MINIMAL TOP LINE HEADER WITH HEARTBEAT PULSE
// -------------------------------------------------------------
function MinimalHeader({ state, offline, lastUiUpdateAt }) {
  const execution = state?.execution || {};
  const metrics = state?.metrics || {};
  return (
    <header className="minimal-header">
      <div className="hdr-brand">
        <span className="brand-dot" />
        <b>TradeBot // {String(state?.status || "live").toLowerCase()}</b>
        <div className={className("hdr-status-live", offline ? "offline" : "online")}>
          <span className="live-pulse-ring" />
          <span className="live-dot" />
          <b>{offline ? "OFFLINE" : "LIVE"}</b>
        </div>
      </div>
      <div className="hdr-telemetry">
        <span>lat: {ageMs(execution.scanLatencyMs)}</span>
        <span>mkt: {metrics.scannedMarkets || 0}/{metrics.scannedBooks || 0}</span>
        <span>sync: {time(lastUiUpdateAt || state?.realtimeAt)}</span>
        <span className={offline ? "status-offline" : "status-online"}>
          {offline ? "disconnected" : "connected"}
        </span>
      </div>
    </header>
  );
}

// -------------------------------------------------------------
// COMPONENT 2: SIDEBAR COMMAND STATION
// -------------------------------------------------------------
function CommandStation({ state, actionStatus, postApi }) {
  const metrics = state?.metrics || {};
  const prediction = state?.prediction || {};
  const gate = state?.gateProtocol || {};
  const stats = prediction.stats?.activeStats || prediction.stats || {};
  
  const equity = metrics.paperEquity ?? metrics.balance ?? 0;
  const realized = metrics.realizedPnl ?? stats.paperPnl ?? 0;
  const unrealized = metrics.unrealizedPnl ?? 0;
  const wins = stats.wins || 0;
  const settled = stats.settled || 0;
  const losses = settled - wins;

  const approved = gate.approved || prediction.tradeable;
  const blocked = gate.blockedAt;

  return (
    <div className="section command-sidebar">
      <div className="section-title">
        <h3>[01] SYSTEM METRICS</h3>
      </div>
      
      <div className="flat-metrics-list">
        <div className="metric-row">
          <label>equity</label>
          <span className="val-gold"><AnimatedUsd value={equity} /></span>
        </div>
        <div className="metric-row">
          <label>balance</label>
          <span>{usd(metrics.cashBalance ?? metrics.paperBalance ?? equity)}</span>
        </div>
        <div className="metric-row">
          <label>open reserved</label>
          <span>{usd(metrics.openExposure ?? 0)}</span>
        </div>
        <div className="metric-row">
          <label>floating pnl</label>
          <span className={number(unrealized) >= 0 ? "profit-text" : "loss-text"}>
            <AnimatedUsd value={unrealized} />
          </span>
        </div>
        <div className="metric-row">
          <label>realized pnl</label>
          <span className={number(realized) >= 0 ? "profit-text" : "loss-text"}>
            <AnimatedUsd value={realized} />
          </span>
        </div>
        <div className="metric-row">
          <label>accuracy</label>
          <span><AnimatedNumber value={stats.winRate || 0} />%</span>
        </div>
        <div className="metric-row">
          <label>ledger</label>
          <span>{wins}W // {losses}L</span>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: "20px" }}>
        <h3>[02] FLOW CONTROLLER</h3>
      </div>
      
      <div className={className("gate-indicator-box", approved ? "pass" : "block")}>
        <div className="box-header">
          <span className="dot" />
          <b>{approved ? "TRANSACTIONS ENCRYPTED" : "SHADOW OBSERVATION"}</b>
        </div>
        <p>{approved ? (prediction.selectedStrategy || "EV Scorer") : (blocked?.reason || "Observe Mode Active")}</p>
      </div>

      <div className="action-buttons-list">
        <button type="button" onClick={() => postApi("/api/v3/scan", "force scan").catch(() => null)}>
          &gt; FORCE SCANNER TICK
        </button>
        <button type="button" onClick={() => postApi("/api/v3/paper/close-open", "close paper open").catch(() => null)}>
          &gt; LIQUIDATE ACTIVE
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => {
            const ok = window.confirm("Reset system balance? This will clear all ledger stats.");
            if (ok) postApi("/api/v3/paper/reset-equity", "hard reset equity").catch(() => null);
          }}
        >
          &gt; RESET LIFE SYSTEM
        </button>
      </div>

      {actionStatus?.error && <div className="console-log-error">{actionStatus.error}</div>}
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 3: CENTER COLUMN OSCILLOSCOPE GRAPH
// -------------------------------------------------------------
const PNL_RANGES = [
  { key: "1D", label: "1d", ms: 24 * 60 * 60 * 1000 },
  { key: "1W", label: "1w", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1M", label: "1m", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "ALL", label: "all", ms: null },
];

function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    const controlOneX = current.x + (next.x - previous.x) / 6;
    const controlOneY = current.y + (next.y - previous.y) / 6;
    const controlTwoX = next.x - (afterNext.x - current.x) / 6;
    const controlTwoY = next.y - (afterNext.y - current.y) / 6;
    path += ` C ${controlOneX.toFixed(1)} ${controlOneY.toFixed(1)} ${controlTwoX.toFixed(1)} ${controlTwoY.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  return path;
}

function rangeStartMs(rangeKey, now) {
  const range = PNL_RANGES.find((item) => item.key === rangeKey);
  if (!range || range.key === "ALL") return 0;
  return now - range.ms;
}

function chartDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function resolveChartHover(points, x) {
  if (!points.length) return null;
  if (points.length === 1 || x <= points[0].x) return { ...points[0], source: points[0] };
  const last = points[points.length - 1];
  if (x >= last.x) return { ...last, source: last };

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (x >= current.x && x <= next.x) {
      const width = Math.max(1, next.x - current.x);
      const t = (x - current.x) / width;
      const nearest = t < 0.5 ? current : next;
      return {
        ...nearest,
        x,
        y: current.y + (next.y - current.y) * t,
        cumulative: current.cumulative + (next.cumulative - current.cumulative) * t,
        source: nearest,
      };
    }
  }

  return { ...last, source: last };
}

function buildPnlFlow(state, rangeKey = "1D") {
  const prediction = state?.prediction || {};
  const metrics = state?.metrics || {};
  const rawSignals = Array.isArray(prediction.signals) ? prediction.signals : [];
  const now = Date.now();
  const startMs = rangeStartMs(rangeKey, now);
  const totalPnl = number(metrics.realizedPnl) + number(metrics.unrealizedPnl);
  const rows = rawSignals
    .filter((signal) => signal?.status === "paper_win" || signal?.status === "paper_loss" || signal?.status === "paper_open")
    .map((signal) => ({
      ...signal,
      pnl: displaySignalPnl(signal, prediction),
      sortTime: msTime(signal.settledAt || signal.time || signal.windowEnd),
    }))
    .filter((signal) => signal.sortTime > 0)
    .filter((signal) => !startMs || signal.sortTime >= startMs)
    .sort((left, right) => left.sortTime - right.sortTime)
    .slice(-60);
  const hasRangeData = rows.length > 0;
  const chartRows = hasRangeData
    ? rows
    : [{
        id: "current-paper-pnl",
        pnl: totalPnl,
        cumulative: totalPnl,
        sortTime: msTime(state?.realtimeAt || state?.updatedAt) || now,
        time: state?.realtimeAt || state?.updatedAt,
      }];

  let cumulative = 0;
  const points = chartRows.map((signal, index) => {
    cumulative = hasRangeData ? cumulative + number(signal.pnl) : number(signal.cumulative);
    return { ...signal, index, cumulative };
  });

  const values = points.length ? points.map((point) => point.cumulative) : [0];
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const span = Math.max(1, maxValue - minValue);
  const pad = Math.max(0.5, span * 0.12);
  const view = { width: 760, height: 260, left: 10, right: 10, top: 20, bottom: 20 };
  const plotWidth = view.width - view.left - view.right;
  const plotHeight = view.height - view.top - view.bottom;
  const yMax = maxValue + pad;
  const yMin = minValue - pad;
  const ySpan = Math.max(1, yMax - yMin);
  const toX = (index, length = points.length) => view.left + (length <= 1 ? plotWidth : (index / (length - 1)) * plotWidth);
  const toY = (value) => view.top + ((yMax - value) / ySpan) * plotHeight;
  const svgSource = points.length === 1
    ? [{ ...points[0], index: 0 }, { ...points[0], index: 1, duplicate: true }]
    : points;
  const svgPoints = svgSource.map((point, index) => ({
    ...point,
    x: toX(index, svgSource.length),
    y: toY(point.cumulative),
  }));
  const zeroY = toY(0);
  const path = smoothPath(svgPoints);
  const areaPath = svgPoints.length
    ? `${path} L ${svgPoints[svgPoints.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${svgPoints[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
    : "";
  const last = points[points.length - 1] || null;

  return {
    points: svgPoints,
    path,
    areaPath,
    zeroY,
    minValue,
    maxValue,
    last,
    totalPnl,
    hasRangeData,
    paperEquity: number(metrics.paperEquity ?? metrics.balance),
  };
}

function displaySignalPnl(signal = {}, prediction = {}) {
  if (signal.status === "paper_win" || signal.status === "paper_loss") return number(signal.paperPnlUsd);
  if (Number.isFinite(Number(signal.markPnlUsd))) return number(signal.markPnlUsd);
  return estimateSignalPnl(signal, prediction);
}

function estimateSignalPnl(signal = {}, prediction = {}) {
  if (signal.status === "paper_win" || signal.status === "paper_loss") return number(signal.paperPnlUsd);
  const side = String(signal.direction || signal.side || "").toUpperCase();
  if (signal.slug !== prediction.slug) return 0;
  const bid = side === "UP" ? number(prediction.upBidPrice) : side === "DOWN" ? number(prediction.downBidPrice) : 0;
  if (bid <= 0) return 0;
  return number(signal.paperShares) * bid - number(signal.paperStakeUsd);
}

function msTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function FlatOscilloscope({ state }) {
  const [activeRange, setActiveRange] = useState("1D");
  const [hoverPoint, setHoverPoint] = useState(null);
  const chart = useMemo(() => buildPnlFlow(state, activeRange), [state, activeRange]);
  const positive = chart.totalPnl >= 0;
  const activePoint = hoverPoint || chart.points[chart.points.length - 1] || null;
  const lastPoint = chart.points[chart.points.length - 1] || null;

  function handleChartPointerMove(event) {
    if (!chart.points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 760;
    setHoverPoint(resolveChartHover(chart.points, x));
  }

  return (
    <div className="section oscilloscope-section">
      <div className="flat-section-header">
        <h3>[03] CUMULATIVE TRAJECTORY</h3>
        <div className="chart-tabs">
          {PNL_RANGES.map((range) => (
            <button
              key={range.key}
              type="button"
              className={range.key === activeRange ? "active" : ""}
              onClick={() => {
                setActiveRange(range.key);
                setHoverPoint(null);
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-container-flat" onPointerMove={handleChartPointerMove} onPointerLeave={() => setHoverPoint(null)}>
        <svg className="pnl-chart-flat" viewBox="0 0 760 260" preserveAspectRatio="none" role="img" aria-label="oscilloscope graph">
          <defs>
            <linearGradient id="pnlLineGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={positive ? "#A2C9B5" : "#E2A9A3"} />
              <stop offset="100%" stopColor={positive ? "#588E75" : "#A6636B"} />
            </linearGradient>
            <linearGradient id="pnlAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={positive ? "#A2C9B5" : "#E2A9A3"} stopOpacity="0.06" />
              <stop offset="100%" stopColor={positive ? "#A2C9B5" : "#E2A9A3"} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="10" x2="750" y1={chart.zeroY} y2={chart.zeroY} stroke="rgba(223, 205, 174, 0.05)" strokeDasharray="3 3" />
          {chart.areaPath ? <path d={chart.areaPath} fill="url(#pnlAreaGrad)" /> : null}
          {chart.path ? <path className="pnl-chart-line-animated" d={chart.path} fill="none" stroke="url(#pnlLineGrad)" strokeWidth="1.2" /> : null}
          {activePoint ? (
            <line x1={activePoint.x} x2={activePoint.x} y1="10" y2="250" stroke="rgba(223, 205, 174, 0.15)" strokeWidth="0.8" />
          ) : null}
        </svg>

        {activePoint ? (
          <div className="flat-tooltip" style={{ left: `${Math.min(90, Math.max(10, (activePoint.x / 760) * 100))}%` }}>
            <span className="t-val">{usd(activePoint.cumulative)}</span>
            <span className="t-date">{chartDate(activePoint.source?.settledAt || activePoint.source?.time || activePoint.settledAt || activePoint.time)}</span>
          </div>
        ) : null}

        {/* HTML Pulsing Node overlay: completely immune to SVG preserveAspectRatio="none" vertical flattening! */}
        {lastPoint ? (
          <div
            className="live-chart-node-html"
            style={{
              left: `${(lastPoint.x / 760) * 100}%`,
              top: `${(lastPoint.y / 260) * 100}%`,
            }}
          >
            <span className="live-node-dot" />
            <span className="live-node-pulse" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 4: FLAT ACTIVE POSITIONS
// -------------------------------------------------------------
function ActiveExecutions({ state }) {
  const prediction = state?.prediction || {};
  const signals = prediction.openSignals || prediction.signals || [];
  const open = signals.filter((signal) => signal.status === "paper_open").slice(0, 8);

  return (
    <div className="section executions-section">
      <div className="section-title">
        <h3>[04] ACTIVE EXECUTIONS</h3>
      </div>
      <table className="flat-table">
        <thead>
          <tr>
            <th style={{ width: "60px" }}>side</th>
            <th>instrument</th>
            <th>entry</th>
            <th>mark</th>
            <th>stake</th>
            <th className="text-right">unrealized</th>
          </tr>
        </thead>
        <tbody>
          {open.length ? open.map((pos) => {
            const floatingPnl = number(pos.markPnlUsd);
            const direction = String(pos.direction || "unknown").toUpperCase();
            return (
              <tr key={pos.id}>
                <td><span className={direction === "UP" ? "profit-text" : "loss-text"}>{direction.toLowerCase()}</span></td>
                <td>
                  <span className="asset-link">
                    {pos.marketUrl ? <a href={pos.marketUrl} target="_blank" rel="noreferrer">{shortTitle(pos.title)}</a> : shortTitle(pos.title)}
                  </span>
                  <small className="sub-desc">{pos.slug}</small>
                </td>
                <td>{number(pos.buyPrice).toFixed(3)}</td>
                <td>{number(pos.bidPrice).toFixed(3)}</td>
                <td>{usd(pos.paperStakeUsd)}</td>
                <td className={className("text-right font-bold", floatingPnl >= 0 ? "profit-text" : "loss-text")}>
                  {usd(floatingPnl)}
                </td>
              </tr>
            );
          }) : (
            <tr>
              <td colSpan="6" className="empty-tr">[no active executions in ledger]</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 5: FLAT TABS LEDGER (RILL VS SHADOW) WITH HOVER-DOWN
// -------------------------------------------------------------
function HistoryLedger({ state }) {
  const [tab, setTab] = useState("real");
  const prediction = state?.prediction || {};
  const signals = prediction.signals || [];
  
  const rillRows = useMemo(() => {
    return signals
      .filter((s) => s.status === "paper_win" || s.status === "paper_loss" || s.status === "paper_open")
      .map((signal) => ({
        ...signal,
        displayPnl: signal.markPnlUsd ?? estimateSignalPnl(signal, prediction),
        sortTime: signal.settledAt || signal.time || signal.windowEnd,
      }))
      .sort((left, right) => new Date(right.sortTime || 0) - new Date(left.sortTime || 0));
  }, [signals, prediction]);

  const shadowOpen = prediction.shadowOpenSignals || [];
  const shadowRecent = prediction.shadowRecentSignals || [];
  const allShadow = [...shadowOpen, ...shadowRecent];
  const shadowRows = useMemo(() => {
    return allShadow
      .map((signal) => ({
        ...signal,
        displayPnl: signal.markPnlUsd ?? estimateSignalPnl(signal, prediction),
        sortTime: signal.settledAt || signal.time || signal.windowEnd,
      }))
      .sort((left, right) => new Date(right.sortTime || 0) - new Date(left.sortTime || 0));
  }, [allShadow, prediction]);

  const activeRows = tab === "real" ? rillRows : shadowRows;

  return (
    <div className="section history-section">
      <div className="flat-section-header">
        <div className="ledger-tabs">
          <button type="button" className={tab === "real" ? "active" : ""} onClick={() => setTab("real")}>
            [rill ledger]
          </button>
          <button type="button" className={tab === "shadow" ? "active" : ""} onClick={() => setTab("shadow")}>
            [shadow trace]
          </button>
        </div>
        <span className="log-action-hint">hover to expand</span>
      </div>

      <div className="scrollable-log-container hover-down-logs">
        {activeRows.length ? activeRows.map((row) => {
          const isPending = row.status === "paper_open";
          const pnlVal = number(row.displayPnl);
          const win = pnlVal >= 0;
          return (
            <div key={row.id} className="flat-log-row">
              <span className="log-time">{dateTime(row.settledAt || row.time).split(" ").pop()}</span>
              <div className="log-asset">
                <b>{shortTitle(row.title)}</b>
                <small>{row.slug}</small>
              </div>
              <span className="log-direction">{row.direction.toLowerCase()}</span>
              <span className="log-meta">
                {isPending ? "active" : statusLabel(row.status).toLowerCase()} // {row.strategy || "ev"}
              </span>
              <span className={className("log-pnl", isPending ? "" : (win ? "profit-text" : "loss-text"))}>
                {isPending ? "observing" : usd(pnlVal)}
              </span>
            </div>
          );
        }) : <div className="empty-tr text-center">[logs partition empty]</div>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 6: COLUMN SCANNER CANDIDATES WITH OSCILLATING SENSOR
// -------------------------------------------------------------
function OpportunityScanner({ state }) {
  const scanner = state?.scanner || {};
  const rows = scanner.topCandidates || [];

  return (
    <div className="section scanner-section text-left">
      <div className="section-title">
        <h3>[05] OPPORTUNITY TICKER</h3>
      </div>
      
      <div className="flat-scanner-list active-scanning-sensor">
        {rows.length ? rows.map((row, index) => {
          const isEdge = row.status === "opportunity";
          return (
            <div key={`${row.slug}-${index}`} className="flat-scanner-row">
              <div className="sc-header-flat">
                <span className="sc-dot-state" />
                <span className="sc-sym">{row.symbol}</span>
                <span className="sc-tf">{row.timeframe}</span>
                <span className={className("sc-edge-pct", isEdge ? "edge" : "")}>
                  {isEdge ? "edge" : "wait"} // {number(row.edgePercent).toFixed(1)}%
                </span>
              </div>
              <p className="sc-quest">{shortTitle(row.question)}</p>
              <div className="sc-footer-flat">
                <span>ev score: {number(row.opportunityScore).toFixed(1)}</span>
                <span>{row.reason?.toLowerCase() || row.strategy?.toLowerCase()}</span>
              </div>
            </div>
          );
        }) : <div className="empty-tr">[awaiting scans]</div>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 7: STANDALONE ACCURACY CALIBRATION
// -------------------------------------------------------------
function AccuracyCalibration({ state }) {
  const learning = state?.learning || {};
  const strategies = learning.strategies || [];

  if (!strategies.length) return null;

  return (
    <div className="section accuracy-section">
      <div className="section-title">
        <h3>[07] ACCURACY CALIBRATION</h3>
      </div>
      <div className="strategy-lines">
        {strategies.slice(0, 4).map((item) => (
          <div className="strat-meter-row" key={item.strategy}>
            <span>{item.strategy.replace("strategy_", "").toLowerCase()}</span>
            <div className="meter-rail">
              <div className="meter-fill" style={{ width: `${number(item.winRate)}%` }} />
            </div>
            <b>{number(item.winRate).toFixed(0)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 8: GATES CHECKLIST
// -------------------------------------------------------------
function GateProtocols({ state }) {
  const gates = state?.gateProtocol?.allGates || [];

  return (
    <div className="section gates-section">
      <div className="section-title">
        <h3>[06] CHECK GATES</h3>
      </div>
      
      <div className="gates-flat-checklist">
        {gates.map((g) => (
          <div key={g.gateId} className={className("gate-flat-item", g.passed ? "pass" : "fail")}>
            <span className="gate-marker">{g.passed ? "✓" : "✗"}</span>
            <span className="gate-lbl">g{g.gateId}: {g.name.toLowerCase()}</span>
            <span className="gate-detail">{g.passed ? "approved" : g.reason?.toLowerCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 9: LIVE EVENTS (WITH SLIDE-IN ENTRANCE KEYFRAME)
// -------------------------------------------------------------
function LiveTelemetryFeed({ state }) {
  const prediction = state?.prediction || {};
  const rejects = (state?.rejects || []).filter((reject) => !/^HTTP\s+404$/i.test(String(reject.reason || "")));
  const signals = prediction.signals || [];

  const feedEvents = useMemo(() => {
    return [
      ...signals.slice(0, 5).map((s) => ({ type: s.status, time: s.time || s.settledAt, text: `${s.strategy || "ev"} ${s.direction.toLowerCase()}`, sub: `${usd(s.paperStakeUsd)}` })),
      ...rejects.slice(0, 5).map((r) => ({ type: "blocked", time: r.time, text: r.reason?.toLowerCase(), sub: r.symbol?.toLowerCase() || "scanner" })),
    ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 5);
  }, [signals, rejects]);

  return (
    <div className="section feed-section">
      <div className="section-title">
        <h3>[08] EVENT STREAM</h3>
      </div>
      
      <div className="flat-event-stream">
        {feedEvents.map((evt, idx) => (
          <div key={`${evt.time}-${idx}`} className="flat-event-row">
            <span className="evt-time">{time(evt.time).split(" ").pop()}</span>
            <span className={className("evt-dot", evt.type)} />
            <span className="evt-text">{evt.text}</span>
            <span className="evt-sub">{evt.sub}</span>
          </div>
        ))}
      </div>

      <div className="micro-price-grid">
        <div className="micro-row">
          <span>{prediction.slug ? `${prediction.slug.split("-")[0].toLowerCase()} contract` : "asset value"}</span>
          <b>{number(prediction.upBuyPrice).toFixed(3)}</b>
        </div>
        <div className="micro-row">
          <span>feed age</span>
          <b>{ageMs(prediction.bookAgeMs)}</b>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 10: LIVE ACTIVE SCAN TERMINAL (DISCOVERY CONSOLE)
// -------------------------------------------------------------
function DiscoveryConsole({ state, offline }) {
  const paneRef = useRef(null);
  const logs = useMemo(() => {
    if (offline) return [`[${time(Date.now())}] [system] [error] connection to node lost. scanner standby.`];
    const prediction = state?.prediction || {};
    const candidates = state?.scanner?.topCandidates || [];
    const rejects = state?.rejects || [];
    const signals = prediction.signals || [];
    const rows = [
      ...candidates.slice(0, 10).map((candidate) => ({
        at: candidate.time || state?.updatedAt || state?.realtimeAt,
        text: `[scan] ${String(candidate.symbol || "market").toLowerCase()}-${String(candidate.timeframe || "").toLowerCase()}: ${candidate.status || candidate.reason || "evaluated"}`,
      })),
      ...rejects.slice(0, 8).map((reject) => ({
        at: reject.time,
        text: `[gate] ${String(reject.symbol || "market").toLowerCase()} -> blocked (${reject.reason || "unspecified"})`,
      })),
      ...signals.slice(0, 8).map((signal) => ({
        at: signal.time || signal.settledAt,
        text: `[paper] ${String(signal.symbol || "market").toLowerCase()} ${String(signal.direction || "").toLowerCase()} -> ${signal.status || "recorded"}`,
      })),
    ]
      .filter((row) => row.at)
      .sort((left, right) => new Date(left.at) - new Date(right.at))
      .slice(-25)
      .map((row) => `[${time(row.at)}] ${row.text}`);
    return rows.length ? rows : [`[${time(state?.updatedAt || state?.realtimeAt)}] [scan] waiting for real backend telemetry`];
  }, [state, offline]);

  useEffect(() => {
    if (paneRef.current) {
      paneRef.current.scrollTop = paneRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="section terminal-section">
      <div className="section-title">
        <h3>[09] DISCOVERY CONSOLE</h3>
      </div>
      <div className="terminal-log-pane" ref={paneRef}>
        {logs.map((log, index) => {
          const isError = log.includes("[error]");
          return (
            <div key={index} className={className("terminal-log-line", isError ? "loss-text" : "")}>
              {log}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// COMPONENT 9: UQIE QUANT INTELLIGENCE (SHADOW PROFILER)
// -------------------------------------------------------------
function UQIEProfiler({ state }) {
  const strategyRouter = state?.strategyRouter || {};
  const candidates = strategyRouter.candidates || [];

  return (
    <div className="section uqie-section text-left" style={{ marginTop: "15px" }}>
      <style>{`
        @keyframes uqiePulse {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
        @keyframes uqieSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .uqie-active-dot {
          width: 6px;
          height: 6px;
          background-color: #10b981;
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 6px #10b981;
          animation: uqiePulse 1.5s infinite ease-in-out;
        }
        .uqie-row-animated {
          animation: uqieSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transition: all 0.25s ease;
        }
        .uqie-row-animated:hover {
          background: rgba(255, 255, 255, 0.025);
          transform: translateX(3px);
        }
        .uqie-flex-between {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          margin-top: 4px;
          opacity: 0.85;
          font-family: monospace;
        }
      `}</style>
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>[09] UQIE QUANT INTELLIGENCE (SHADOW)</h3>
        <span style={{ fontSize: "9px", color: "#10b981", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "5px" }}>
          <span className="uqie-active-dot" /> LIVE UQIE SCAN
        </span>
      </div>
      
      <div className="flat-scanner-list">
        {candidates.length ? candidates.map((cand, idx) => {
          const uqie = cand.uqie;
          if (!uqie) return null;
          
          let regimeLabel = "rangebound";
          let regimeClass = "profit-text"; // Green
          if (uqie.regime === 1) {
            regimeLabel = "trend";
            regimeClass = "asset-link"; // Yellowish/Blue
          } else if (uqie.regime === 2) {
            regimeLabel = "breakout/toxic";
            regimeClass = "loss-text"; // Red
          }
          
          return (
            <div 
              key={`${cand.strategy}-${idx}`} 
              className="flat-scanner-row uqie-row-animated" 
              style={{ borderLeft: cand.approved ? "3px solid #10b981" : "3px solid #ef4444" }}
            >
              <div className="sc-header-flat">
                <span className="sc-dot-state" style={{ background: cand.approved ? "#10b981" : "#ef4444" }} />
                <span className="sc-sym">{cand.symbol || "BTC"}</span>
                <span className="sc-tf" style={{ fontSize: "10px", opacity: 0.7 }}>
                  {cand.strategy.replace("strategy_", "").toLowerCase()}
                </span>
                <span className={className("sc-edge-pct", cand.approved ? "edge" : "")}>
                  {cand.side.toLowerCase()}
                </span>
              </div>
              
              <div className="uqie-flex-between" style={{ marginTop: "6px" }}>
                <span>implied vol: <b>{(uqie.iv * 100).toFixed(1)}%</b></span>
                <span>kelly stake: <b>${uqie.kellyStakeUsd.toFixed(2)}</b></span>
              </div>
              
              <div className="uqie-flex-between">
                <span>regime: <b className={regimeClass}>{regimeLabel}</b></span>
                <span>correlation: <b>{uqie.ewmc.toFixed(2)}</b></span>
              </div>
            </div>
          );
        }) : <div className="empty-tr">[no active strategy candidates]</div>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// MAIN CONTROLLER WITH IDE-STYLE SEAMLESS PANES
// -------------------------------------------------------------
export default function App() {
  const { state, offline, lastUiUpdateAt, actionStatus, postApi } = useBotState();
  const shellState = useMemo(() => state || {}, [state]);

  return (
    <main className="v3-app-flat">
      <MinimalHeader state={shellState} offline={offline} lastUiUpdateAt={lastUiUpdateAt} />
      
      <div className="flat-dashboard-workspace">
        {/* COLUMN 1: SIDEBAR (Left - Metrics, Control, Calibration, Gates) */}
        <div className="console-column col-left">
          <CommandStation state={shellState} actionStatus={actionStatus} postApi={postApi} />
          <AccuracyCalibration state={shellState} />
          <GateProtocols state={shellState} />
        </div>
        
        {/* COLUMN 2: CENTER (Main Operations - Trajectory, Executions, Ledger, Terminal, Events) */}
        <div className="main-workspace-pane">
          <FlatOscilloscope state={shellState} />
          <ActiveExecutions state={shellState} />
          <HistoryLedger state={shellState} />
          <DiscoveryConsole state={shellState} offline={offline} />
          <LiveTelemetryFeed state={shellState} />
          <UQIEProfiler state={shellState} />
        </div>
        
        {/* COLUMN 3: RIGHT (Scanner - Opportunity) */}
        <div className="right-workspace-pane">
          <OpportunityScanner state={shellState} />
        </div>
      </div>
    </main>
  );
}
