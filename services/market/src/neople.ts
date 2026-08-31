import { config } from './config.js';

export type AuctionRow = {
  auctionNo: number;
  itemId: string;
  itemName: string;
  itemRarity?: string;
  count?: number;
  regCount?: number;
  unitPrice?: number;
  currentPrice?: number;
  averagePrice?: number;
  regDate?: string;
  soldDate?: string;
};

type NeopleResponse = {
  rows?: AuctionRow[];
  error?: { message: string };
};

async function request(path: string) {
  if (!config.neopleApiKey) throw new Error('NEOPLE_API_KEY is required');
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `https://api.neople.co.kr/df${path}${separator}apikey=${encodeURIComponent(config.neopleApiKey)}`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
  );
  const body = (await response.json()) as NeopleResponse;
  if (!response.ok || body.error) throw new Error(body.error?.message || `Neople API ${response.status}`);
  return body.rows || [];
}

export async function fetchMarket(itemName: string) {
  const query = `itemName=${encodeURIComponent(itemName)}&wordType=match`;
  const [listings, sold] = await Promise.all([
    request(`/auction?${query}&limit=100&sort=unitPrice:asc`),
    request(`/auction-sold?${query}&limit=100`),
  ]);
  return { listings, sold };
}
