function buildWeatherStrategyStatus() {
  return {
    enabled: process.env.STRATEGY_WEATHER_ENABLED === "1" || process.env.WEATHER_STRATEGY_ENABLED === "1",
    mode: process.env.WEATHER_STRATEGY_MODE || "paper",
    status: "scanner_ready",
    category: "weather",
    supportedMarkets: ["temperature_high", "temperature_low", "rainfall", "snowfall", "wind_speed"],
    keywords: ["weather", "temperature", "rain", "snow", "wind", "degrees", "°F", "°C"],
    note: "Weather strategy is staged as category scanner + forecast probability module. It is not high-frequency like BTC 5m.",
    updatedAt: new Date().toISOString(),
  };
}

export { buildWeatherStrategyStatus };
