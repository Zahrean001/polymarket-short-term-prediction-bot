function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const CRYPTO_TERMS = [
  "bitcoin", "ethereum", "solana", "ripple", "dogecoin", "microstrategy", "crypto", "coin", "token", "binance", "satoshi",
  "cardano", "chainlink", "avalanche", "polkadot", "litecoin", "tron", "toncoin", "shiba", "pepe", "aptos",
  "near", "arbitrum", "optimism", "uniswap", "aave", "ondo", "worldcoin", "sei",
];

const FAST_TIMEFRAMES = new Set(["5M", "15M"]);
const CONTEXT_TIMEFRAMES = new Set(["1H", "4H", "1D", "1W", "1MO", "1Y", "PREMARKET", "ETF"]);

function classifyMarket(market = {}) {
  const text = `${market.slug || ""} ${market.question || ""} ${market.category || ""}`.toLowerCase();
  const symbol = market.symbol || detectSymbol(text);
  const timeframe = market.timeframe || detectTimeframe(text);
  const marketFamily = market.marketFamily || detectMarketFamily(text);
  const isCrypto = symbol !== "OTHER" || hasCryptoTerm(text);
  if (!isCrypto) return { cryptoCandidate: false, strategy: "watch_only", symbol: "OTHER", timeframe, marketFamily };
  if (marketFamily === "DIRECTIONAL" && FAST_TIMEFRAMES.has(timeframe)) {
    return { cryptoCandidate: true, strategy: `${symbol.toLowerCase()}_${timeframe.toLowerCase()}_directional`, symbol, timeframe, marketFamily, scannerLane: "fast_entry_candidate" };
  }
  if (marketFamily === "DIRECTIONAL") {
    return { cryptoCandidate: true, strategy: `${symbol.toLowerCase()}_directional_context`, symbol, timeframe, marketFamily, scannerLane: "directional_context" };
  }
  if (marketFamily === "PREMARKET" || marketFamily === "ETF") {
    return { cryptoCandidate: true, strategy: `${symbol.toLowerCase()}_${marketFamily.toLowerCase()}_watch`, symbol, timeframe, marketFamily, scannerLane: "context_watch" };
  }
  return { cryptoCandidate: true, strategy: "crypto_event_watch", symbol, timeframe, marketFamily, scannerLane: "context_watch" };
}

function scoreMarket(market = {}) {
  const timeframe = String(market.timeframe || "").toUpperCase();
  const family = String(market.marketFamily || "").toUpperCase();
  const symbol = String(market.symbol || "").toUpperCase();
  const bookSource = String(market.bookSource || "").toLowerCase();
  const volumeScore = Math.min(30, Math.log10(Math.max(1, finite(market.volume))) * 6);
  const liquidityScore = Math.min(25, Math.log10(Math.max(1, finite(market.liquidity))) * 5);
  const edgeScore = Math.min(25, Math.max(0, finite(market.edgePercent)) * 2.5);
  const spreadPenalty = Math.min(20, Math.max(0, finite(market.slippageCents)) * 2);
  const stalePenalty = finite(market.bookAgeMs) > 2000 ? 20 : 0;
  const statusBonus = market.status === "opportunity" ? 15 : 0;
  const fastBonus = FAST_TIMEFRAMES.has(timeframe) ? 18 : 0;
  const contextBonus = CONTEXT_TIMEFRAMES.has(timeframe) ? 6 : 0;
  const directionalBonus = family === "DIRECTIONAL" ? 12 : 0;
  const symbolBonus = market.symbol && market.symbol !== "OTHER" ? 10 : 0;
  const historicalSymbolBonus = {
    ETH: 22,
    DOGE: 20,
    BTC: 18,
    XRP: 16,
    SOL: 2,
    BNB: -4,
  }[symbol] ?? 6;
  const wsFreshnessBonus = bookSource === "ws+ws" ? 18 : bookSource.includes("ws") ? 8 : bookSource === "rest+rest" ? -8 : 0;
  const ageBonus = finite(market.bookAgeMs) <= 500 ? 10 : finite(market.bookAgeMs) <= 1000 ? 5 : 0;
  const v331PriorityScore = historicalSymbolBonus + wsFreshnessBonus + ageBonus;
  return Math.max(0, Math.min(150, volumeScore + liquidityScore + edgeScore + statusBonus + fastBonus + contextBonus + directionalBonus + symbolBonus + v331PriorityScore - spreadPenalty - stalePenalty));
}

function detectSymbol(text = "") {
  if (/\bbtc\b|bitcoin/.test(text)) return "BTC";
  if (/\b(eth|ether)\b|ethereum/.test(text)) return "ETH";
  if (/\bsol\b|solana/.test(text)) return "SOL";
  if (/xrp|ripple/.test(text)) return "XRP";
  if (/doge|dogecoin/.test(text)) return "DOGE";
  if (/\bbnb\b|binance/.test(text)) return "BNB";
  if (/microstrategy|\bmstr\b/.test(text)) return "MSTR";
  if (/cardano|\bada\b/.test(text)) return "ADA";
  if (/chainlink|\blink\b/.test(text)) return "LINK";
  if (/avalanche|\bavax\b/.test(text)) return "AVAX";
  if (/polkadot|\bdot\b/.test(text)) return "DOT";
  if (/litecoin|\bltc\b/.test(text)) return "LTC";
  if (/tron|\btrx\b/.test(text)) return "TRX";
  if (/toncoin|\bton\b/.test(text)) return "TON";
  if (/shiba|\bshib\b/.test(text)) return "SHIB";
  if (/pepe/.test(text)) return "PEPE";
  if (/\bsui\b/.test(text)) return "SUI";
  if (/aptos|\bapt\b/.test(text)) return "APT";
  if (/\bnear\b/.test(text)) return "NEAR";
  if (/arbitrum|\barb\b/.test(text)) return "ARB";
  if (/optimism|\bop\b/.test(text)) return "OP";
  if (/uniswap|\buni\b/.test(text)) return "UNI";
  if (/aave/.test(text)) return "AAVE";
  if (/ondo/.test(text)) return "ONDO";
  if (/worldcoin|\bwld\b/.test(text)) return "WLD";
  if (/\bsei\b/.test(text)) return "SEI";
  return "OTHER";
}

function hasCryptoTerm(text = "") {
  return CRYPTO_TERMS.some((term) => text.includes(term)) || /\b(btc|eth|ether|sol|xrp|doge|bnb|mstr|ada|link|avax|dot|ltc|trx|ton|shib|sui|apt|near|arb|op|uni|wld|sei)\b/.test(text);
}

function detectMarketFamily(text = "") {
  if (/pre[-\s]?market/.test(text)) return "PREMARKET";
  if (/\betf\b/.test(text)) return "ETF";
  if (/updown|up or down|up\/down|higher|lower|above|below|price/.test(text)) return "DIRECTIONAL";
  return "EVENT";
}

function detectTimeframe(text = "") {
  if (/pre[-\s]?market/.test(text)) return "PREMARKET";
  if (/\betf\b/.test(text)) return "ETF";
  if (/(\b5m\b|5[-\s]?min|5 minutes)/.test(text)) return "5M";
  if (/(\b15m\b|15[-\s]?min|15 minutes)/.test(text)) return "15M";
  if (/(\b1h\b|1[-\s]?hour|1 hour)/.test(text)) return "1H";
  if (/(\b4h\b|4[-\s]?hour|4 hours)/.test(text)) return "4H";
  if (/(\b1d\b|1[-\s]?day|every day|daily)/.test(text)) return "1D";
  if (/(\b1w\b|weekly|week)/.test(text)) return "1W";
  if (/(\b1mo\b|monthly|per month|month)/.test(text)) return "1MO";
  if (/(\b1y\b|yearly|per year|each year|year)/.test(text)) return "1Y";
  return "UNK";
}

function enrichMarketCandidate(market) {
  const classification = classifyMarket(market);
  const opportunityScore = scoreMarket(market);
  return {
    ...market,
    ...classification,
    opportunityScore,
  };
}

function rankOpportunities(markets = []) {
  return markets.map(enrichMarketCandidate).sort((left, right) => finite(right.opportunityScore) - finite(left.opportunityScore));
}

export { classifyMarket, enrichMarketCandidate, rankOpportunities };
