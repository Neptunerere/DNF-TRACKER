import * as cheerio from 'cheerio';
import { pool, waitForDatabase } from './db.js';

const INVENTORY_URL = 'https://df.inven.co.kr/dataninfo/item/';
const AVATAR_URL = 'https://dnfnow.xyz/avatar';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHtml(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'DNF-Market-Sentinel/0.1 portfolio-catalog' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

type CatalogRow = { name: string; kind: string; category: string; level?: number; job?: string; source: string; url: string };

async function upsert(rows: CatalogRow[]) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const row of rows) {
      await client.query(
        `insert into item_catalog (item_name,item_kind,category,level,job_name,source_name,source_url)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (source_name,item_name,category) do update set
           level=excluded.level,job_name=excluded.job_name,source_url=excluded.source_url,last_seen_at=now()`,
        [row.name, row.kind, row.category, row.level || null, row.job || null, row.source, row.url],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

async function importInventory() {
  const rootHtml = await fetchHtml(INVENTORY_URL);
  const $root = cheerio.load(rootHtml);
  const urls = [...new Set($root('a[href*="class3="]')
    .map((_, element) => new URL($root(element).attr('href') || '', INVENTORY_URL).href).get())]
    .filter((url) => new URL(url).searchParams.has('class3'));
  let imported = 0;
  for (const url of urls) {
    const $ = cheerio.load(await fetchHtml(url));
    const rows: CatalogRow[] = [];
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
      if (cells.length < 5 || !cells[1] || !cells[4]) return;
      const category = cells[4];
      rows.push({ name: cells[1], kind: /칭호|오라/.test(category) ? 'cosmetic' : 'equipment', category,
        level: Number.parseInt(cells[2], 10) || undefined, job: cells[3], source: '던파 인벤 아이템 DB', url });
    });
    await upsert(rows);
    imported += rows.length;
    console.log(`[catalog] ${new URL(url).search}: ${rows.length}`);
    await pause(150);
  }
  return imported;
}

async function importAvatars() {
  const $ = cheerio.load(await fetchHtml(AVATAR_URL));
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  $('tr[data-name]').each((_, element) => {
    const row = $(element);
    const name = row.attr('data-name')?.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    const path = row.attr('onclick')?.match(/location\.href='([^']+)'/)?.[1] || AVATAR_URL;
    rows.push({ name, kind: 'avatar_set', category: '아바타 세트', source: 'DNFNOW 공개 아바타',
      url: new URL(path, AVATAR_URL).href });
  });
  await upsert(rows);
  return rows.length;
}

await waitForDatabase();
const selectedSource = process.env.CATALOG_SOURCE || 'all';
const equipmentCount = selectedSource === 'avatar' ? 0 : await importInventory();
const avatarCount = selectedSource === 'equipment' ? 0 : await importAvatars();
await pool.query(
  `update item_catalog c set market_verified=exists
   (select 1 from market_watch_items w where lower(w.item_name)=lower(c.item_name) and w.active=true)`,
);
console.log(`[catalog] complete: equipment=${equipmentCount}, avatarSets=${avatarCount}`);
await pool.end();
