const NEOPLE_API_BASE = 'https://api.neople.co.kr/df';

type AuctionRow = {
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
};

type NeopleList<T> = {
  rows?: T[];
  error?: { status: number; message: string };
};

const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

async function fetchNeople<T>(path: string, apiKey: string) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `${NEOPLE_API_BASE}${path}${separator}apikey=${encodeURIComponent(apiKey)}`,
    {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 },
    },
  );
  const body = (await response.json()) as NeopleList<T>;
  if (!response.ok || body.error)
    throw new Error(body.error?.message ?? `Neople API ${response.status}`);
  return body.rows ?? [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const itemName = searchParams.get('itemName')?.trim() || '';
  if (itemName.length > 50)
    return Response.json(
      { message: '아이템명이 너무 깁니다.' },
      { status: 400 },
    );

  const marketApiUrl = process.env.MARKET_API_URL;
  if (marketApiUrl) {
    try {
      const upstream = await fetch(
        `${marketApiUrl}/market/overview${itemName ? `?itemName=${encodeURIComponent(itemName)}` : ''}`,
        { headers: { Accept: 'application/json' } },
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    } catch {
      return Response.json(
        { message: '수집 데이터 API에 연결할 수 없습니다.' },
        { status: 502 },
      );
    }
  }

  const apiKey = process.env.NEOPLE_API_KEY;
  if (!apiKey) {
    return Response.json(
      { message: 'MARKET_API_URL 또는 NEOPLE_API_KEY 설정이 필요합니다.' },
      { status: 503 },
    );
  }

  const directItemName = itemName || '무색 큐브 조각';

  const common = `itemName=${encodeURIComponent(directItemName)}&wordType=match`;
  try {
    const [listings, sold] = await Promise.all([
      fetchNeople<AuctionRow>(
        `/auction?${common}&limit=100&sort=unitPrice:asc`,
        apiKey,
      ),
      fetchNeople<AuctionRow>(`/auction-sold?${common}&limit=100`, apiKey),
    ]);

    const soldPrices = sold
      .map((row) => Number(row.unitPrice || row.currentPrice || 0))
      .filter(Boolean);
    const baseline = median(soldPrices) || average(soldPrices);
    const grouped = new Map<number, number>();
    listings.forEach((row) => {
      const price = Number(row.unitPrice || row.currentPrice || 0);
      if (price) grouped.set(price, (grouped.get(price) ?? 0) + 1);
    });

    const rows = listings
      .slice(0, 40)
      .map((row) => {
        const unitPrice = Number(row.unitPrice || row.currentPrice || 0);
        const deviation = baseline
          ? ((unitPrice - baseline) / baseline) * 100
          : 0;
        const repeated = grouped.get(unitPrice) ?? 1;
        const quantity = Number(row.count || row.regCount || 1);
        const priceRisk = Math.min(55, Math.abs(deviation) * 0.45);
        const volumeRisk = Math.min(20, Math.log10(Math.max(1, quantity)) * 7);
        const clusterRisk = Math.min(20, Math.max(0, repeated - 1) * 4);
        const score = Math.round(
          Math.min(99, 10 + priceRisk + volumeRisk + clusterRisk),
        );
        const signal =
          Math.abs(deviation) >= 50
            ? '최근 거래 중앙값 대비 극단가'
            : repeated >= 4
              ? '동일 가격대 집중 등록'
              : quantity >= 100
                ? '대량 물량 등록'
                : '가격 편차 관찰';

        return {
          id: `AUC-${row.auctionNo}`,
          auctionNo: row.auctionNo,
          itemId: row.itemId,
          item: row.itemName,
          category: row.itemRarity || '경매장 아이템',
          unitPrice,
          price: unitPrice.toLocaleString('ko-KR'),
          deltaValue: deviation,
          delta: `${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}%`,
          volume: quantity.toLocaleString('ko-KR'),
          score,
          severity: score >= 80 ? 'critical' : score >= 60 ? 'high' : 'medium',
          signal,
          time: row.regDate || '현재 등록',
          imageUrl: `https://img-api.neople.co.kr/df/items/${row.itemId}`,
        };
      })
      .sort((a, b) => b.score - a.score);

    return Response.json({
      source: 'Neople Open API',
      fetchedAt: new Date().toISOString(),
      query: directItemName,
      summary: {
        listingCount: listings.length,
        soldSampleCount: sold.length,
        medianSoldPrice: baseline,
        averageListingPrice: average(
          listings
            .map((row) => Number(row.unitPrice || row.currentPrice || 0))
            .filter(Boolean),
        ),
        highRiskCount: rows.filter((row) => row.score >= 60).length,
        averageRiskScore: average(rows.map((row) => row.score)),
      },
      rows,
      limitations:
        '최근 거래 데이터는 최대 100건 또는 1개월 범위이며, 결과는 이상 징후이지 불공정 이용 판정이 아닙니다.',
    });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : '네오플 API 조회에 실패했습니다.',
      },
      { status: 502 },
    );
  }
}
