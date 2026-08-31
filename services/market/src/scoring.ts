import type { AuctionRow } from './neople.js';

export type HistoricalPoint = { medianPrice: number; listingCount: number };

export const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const mad = (values: number[], center: number) => median(values.map((value) => Math.abs(value - center)));

export function scoreListings(listings: AuctionRow[], sold: AuctionRow[], history: HistoricalPoint[] = []) {
  const soldPrices = sold.map((row) => Number(row.unitPrice || row.currentPrice || 0)).filter(Boolean);
  const currentMedian = median(soldPrices) || average(soldPrices);
  const historicalPrices = history.map((point) => point.medianPrice).filter((value) => value > 0);
  const baselineReady = historicalPrices.length >= 3;
  const historicalMedian = median(historicalPrices);
  const baseline = baselineReady ? historicalMedian : currentMedian;
  const priceMad = mad(historicalPrices, historicalMedian);
  const historicalVolume = median(history.map((point) => point.listingCount).filter((value) => value >= 0));
  const volumeRatio = historicalVolume > 0 ? listings.length / historicalVolume : 1;
  const confidence = Math.round(Math.min(100,
    Math.min(45, soldPrices.length * 0.45) +
    Math.min(40, historicalPrices.length * 8) +
    Math.min(15, listings.length * 0.3),
  ));
  const grouped = new Map<number, number>();
  listings.forEach((row) => {
    const price = Number(row.unitPrice || row.currentPrice || 0);
    if (price) grouped.set(price, (grouped.get(price) || 0) + 1);
  });

  return listings.map((row) => {
    const unitPrice = Number(row.unitPrice || row.currentPrice || 0);
    const deviation = baseline ? ((unitPrice - baseline) / baseline) * 100 : 0;
    const robustZ = baselineReady && priceMad > 0 ? Math.abs(unitPrice - historicalMedian) / (1.4826 * priceMad) : 0;
    const quantity = Number(row.count || row.regCount || 1);
    const repeated = grouped.get(unitPrice) || 1;
    const rawScore = Math.min(99,
      8 + Math.min(35, Math.abs(deviation) * 0.35) + Math.min(22, robustZ * 5) +
      Math.min(15, Math.log10(Math.max(1, quantity)) * 6) +
      Math.min(12, Math.max(0, repeated - 1) * 3) + Math.min(15, Math.max(0, volumeRatio - 1) * 10),
    );
    const score = Math.round(rawScore * (0.45 + confidence * 0.0055));
    const signal = robustZ >= 3.5 ? '과거 기준선 대비 강한 가격 이탈'
      : Math.abs(deviation) >= 50 ? '최근 거래 중앙값 대비 극단가'
      : volumeRatio >= 1.8 && Math.abs(deviation) >= 15 ? '등록량 급증 + 가격 변동'
      : repeated >= 4 ? '동일 가격대 집중 등록'
      : quantity >= 100 ? '대량 물량 등록'
      : '가격 편차 관찰';
    return { row, unitPrice, deviation, robustZ, quantity, repeated, score, signal, baseline,
      confidence, volumeRatio, baselineSampleCount: historicalPrices.length, baselineReady };
  });
}
