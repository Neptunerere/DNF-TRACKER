import { config } from './config.js';
import { createHash } from 'node:crypto';
import { pool, waitForDatabase } from './db.js';
import { fetchMarket } from './neople.js';
import { average, scoreListings } from './scoring.js';

let collecting = false;

async function collectItem(watchItem: { id: number; item_name: string }) {
  const run = await pool.query<{ id: number }>(
    `insert into collection_runs (watch_item_id, status) values ($1, 'running') returning id`,
    [watchItem.id],
  );
  const runId = run.rows[0].id;
  try {
    const { listings, sold } = await fetchMarket(watchItem.item_name);
    const historyResult = await pool.query<{ median_price: string; listing_count: number }>(
      `select median_sold_price as median_price,listing_count
       from market_hourly_stats where watch_item_id=$1 and bucket_at>=now()-interval '7 days'
       order by bucket_at desc limit 168`,
      [watchItem.id],
    );
    const history = historyResult.rows.map((row) => ({ medianPrice: Number(row.median_price), listingCount: Number(row.listing_count) }));
    const scored = scoreListings(listings, sold, history);
    const suppression = await pool.query<{ id: number }>(
      `select id from suppression_windows where enabled=true and now() between starts_at and ends_at
       and (item_pattern is null or $1 ilike item_pattern) order by starts_at desc limit 1`,
      [watchItem.item_name],
    );
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const result of scored) {
        const snapshot = await client.query<{ id: number }>(
          `insert into auction_snapshots
           (collection_run_id, watch_item_id, auction_no, item_id, item_name, rarity, unit_price, quantity, average_price, registered_at, raw_payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [runId, watchItem.id, result.row.auctionNo, result.row.itemId, result.row.itemName, result.row.itemRarity || null, result.unitPrice, result.quantity, result.row.averagePrice || null, result.row.regDate || null, result.row],
        );
        const event = await client.query<{ id: number }>(
          `insert into anomaly_events
           (auction_snapshot_id,watch_item_id,risk_score,severity,signal,price_deviation_pct,baseline_price,
            confidence_score,detector_version,baseline_sample_count,volume_ratio,feature_payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'rule-v2',$9,$10,$11) returning id`,
          [snapshot.rows[0].id, watchItem.id, result.score,
            result.confidence < 55 ? 'medium' : result.score >= 80 ? 'critical' : result.score >= 60 ? 'high' : 'medium',
            result.signal, result.deviation, result.baseline, result.confidence, result.baselineSampleCount,
            result.volumeRatio, { repeatedPriceCount: result.repeated, quantity: result.quantity, robustZ: result.robustZ, baselineReady: result.baselineReady }],
        );
        if (result.score >= 35) {
          const priceBucket = Math.round(Math.log(Math.max(1, result.unitPrice)) / Math.log(1.1));
          const signalKey = result.signal.toLowerCase().replace(/[^a-zA-Z0-9가-힣]+/g, '-');
          const direction = result.deviation >= 0 ? 'UP' : 'DOWN';
          const severity = result.confidence < 55 ? 'medium' : result.score >= 80 ? 'critical' : result.score >= 60 ? 'high' : 'medium';
          const existing = await client.query<{id:number}>(`select id from alerts where watch_item_id=$1 and signal_key=$2 and direction=$3
            and last_seen_at>=now()-interval '30 minutes' and status not in ('CLOSED','BENIGN') order by last_seen_at desc limit 1`,
            [watchItem.id,signalKey,direction]);
          const fingerprint = createHash('sha256').update(`${watchItem.id}:${signalKey}:${direction}:${Date.now()}`).digest('hex');
          await client.query(
            `insert into alerts
             (fingerprint,watch_item_id,representative_event_id,severity,risk_score,confidence_score,signal,signal_key,direction,
              min_unit_price,max_unit_price,min_deviation_pct,max_deviation_pct,suppressed,suppression_window_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11,$12,$13)
             on conflict (id) do nothing`,
            [fingerprint,watchItem.id,event.rows[0].id,severity,result.score,result.confidence,result.signal,signalKey,direction,
              result.unitPrice,result.deviation,suppression.rowCount ? true : false,suppression.rows[0]?.id || null],
          );
          let alertId:number;
          if(existing.rowCount){
            alertId=existing.rows[0].id;
            await client.query(`update alerts set representative_event_id=$2,severity=$3,risk_score=greatest(risk_score,$4),
              confidence_score=greatest(confidence_score,$5),occurrences=occurrences+1,last_seen_at=now(),
              min_unit_price=least(coalesce(min_unit_price,$6),$6),max_unit_price=greatest(coalesce(max_unit_price,$6),$6),
              min_deviation_pct=least(coalesce(min_deviation_pct,$7),$7),max_deviation_pct=greatest(coalesce(max_deviation_pct,$7),$7),updated_at=now() where id=$1`,
              [alertId,event.rows[0].id,severity,result.score,result.confidence,result.unitPrice,result.deviation]);
            await client.query(`delete from alerts where fingerprint=$1`,[fingerprint]);
          }else{
            const created=await client.query<{id:number}>(`select id from alerts where fingerprint=$1`,[fingerprint]); alertId=created.rows[0].id;
          }
          await client.query(`insert into incident_price_clusters(alert_id,price_bucket,min_unit_price,max_unit_price,min_deviation_pct,max_deviation_pct,occurrences)
            values($1,$2,$3,$3,$4,$4,1) on conflict(alert_id,price_bucket) do update set
            min_unit_price=least(incident_price_clusters.min_unit_price,excluded.min_unit_price),max_unit_price=greatest(incident_price_clusters.max_unit_price,excluded.max_unit_price),
            min_deviation_pct=least(incident_price_clusters.min_deviation_pct,excluded.min_deviation_pct),max_deviation_pct=greatest(incident_price_clusters.max_deviation_pct,excluded.max_deviation_pct),
            occurrences=incident_price_clusters.occurrences+1,last_seen_at=now()`,[alertId,priceBucket,result.unitPrice,result.deviation]);
        }
      }
      for (const row of sold) {
        await client.query(
          `insert into sold_snapshots
           (collection_run_id, watch_item_id, item_id, item_name, unit_price, quantity, sold_at, raw_payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [runId, watchItem.id, row.itemId, row.itemName, Number(row.unitPrice || row.currentPrice || 0), Number(row.count || row.regCount || 1), row.soldDate || null, row],
        );
      }
      await client.query(
        `insert into market_hourly_stats
         (watch_item_id, bucket_at, listing_count, sold_sample_count, median_sold_price, average_listing_price, high_risk_count, average_risk_score)
         values ($1,date_trunc('hour',now()),$2,$3,$4,$5,$6,$7)
         on conflict (watch_item_id,bucket_at) do update set
           listing_count=excluded.listing_count, sold_sample_count=excluded.sold_sample_count,
           median_sold_price=excluded.median_sold_price, average_listing_price=excluded.average_listing_price,
           high_risk_count=excluded.high_risk_count, average_risk_score=excluded.average_risk_score,
           updated_at=now()`,
        [watchItem.id, listings.length, sold.length, scored[0]?.baseline || 0, average(scored.map((value) => value.unitPrice)), scored.filter((value) => value.score >= 60 && value.confidence >= 55).length, average(scored.map((value) => value.score))],
      );
      await client.query(`update market_watch_items set last_collected_at=now(), last_error=null where id=$1`, [watchItem.id]);
      await client.query(`update collection_runs set status='completed', completed_at=now(), listing_count=$2, sold_count=$3 where id=$1`, [runId, listings.length, sold.length]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    console.log(`[collector] ${watchItem.item_name}: listings=${listings.length}, sold=${sold.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(`update collection_runs set status='failed', completed_at=now(), error_message=$2 where id=$1`, [runId, message]);
    await pool.query(`update market_watch_items set last_error=$2 where id=$1`, [watchItem.id, message]);
    console.error(`[collector] ${watchItem.item_name}: ${message}`);
  }
}

async function collectAll() {
  if (collecting) return;
  collecting = true;
  try {
    const result = await pool.query<{ id: number; item_name: string }>(
      `select id,item_name from market_watch_items where active=true order by priority desc,id`,
    );
    for (let offset = 0; offset < result.rows.length; offset += config.collectConcurrency) {
      await Promise.all(result.rows.slice(offset, offset + config.collectConcurrency).map(collectItem));
    }
  } finally {
    collecting = false;
  }
}

await waitForDatabase();
console.log(`[collector] ready; interval=${Math.round(config.collectIntervalMs / 1000)}s`);
async function runLoop() {
  const lock = await pool.query<{ locked: boolean }>('select pg_try_advisory_lock(424242) as locked');
  if (lock.rows[0]?.locked) {
    try { await collectAll(); } finally { await pool.query('select pg_advisory_unlock(424242)'); }
  } else {
    console.log('[collector] another worker owns the collection lock; skipping cycle');
  }
  setTimeout(runLoop, config.collectIntervalMs);
}
await runLoop();
