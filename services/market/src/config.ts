export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://sentinel:sentinel@localhost:5432/dnf_market',
  neopleApiKey: process.env.NEOPLE_API_KEY || '',
  collectIntervalMs: Math.max(60_000, Number(process.env.COLLECT_INTERVAL_MS || 600_000)),
  collectConcurrency: Math.max(1, Number(process.env.COLLECT_CONCURRENCY || 3)),
};
