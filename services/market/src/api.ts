import express from 'express';
import { config } from './config.js';
import { pool, waitForDatabase } from './db.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((_request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', process.env.WEB_ORIGIN || 'http://localhost:3000');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', async (_request, response) => {
  await pool.query('select 1');
  response.json({ status: 'ok' });
});

app.get('/market/overview', async (request, response) => {
  const itemName = typeof request.query.itemName === 'string' ? request.query.itemName.trim() : '';
  const params: unknown[] = [];
  const itemFilter = itemName ? `and w.item_name ilike $1` : '';
  if (itemName) params.push(`%${itemName}%`);
  const result = await pool.query(
    `with latest_runs as (
       select distinct on (watch_item_id) id,watch_item_id,completed_at,listing_count,sold_count
       from collection_runs where status='completed' order by watch_item_id,completed_at desc
     )
     select e.id,e.risk_score,e.severity,e.signal,e.price_deviation_pct,e.baseline_price,e.created_at,
            e.confidence_score,e.detector_version,e.baseline_sample_count,e.volume_ratio,
            a.auction_no,a.item_id,a.item_name,a.rarity,a.unit_price,a.quantity,a.registered_at,
            w.item_name as watch_name,r.listing_count,r.sold_count,r.completed_at
     from latest_runs r
     join market_watch_items w on w.id=r.watch_item_id
     join auction_snapshots a on a.collection_run_id=r.id
     join anomaly_events e on e.auction_snapshot_id=a.id
     where 1=1 ${itemFilter}
     order by e.risk_score desc,e.created_at desc limit 100`,
    params,
  );
  const rows = result.rows.slice(0, 40).map((row) => ({
    id: `AUC-${row.auction_no}`,
    auctionNo: Number(row.auction_no), itemId: row.item_id, item: row.item_name,
    category: row.rarity || '경매장 아이템', unitPrice: Number(row.unit_price),
    price: Number(row.unit_price).toLocaleString('ko-KR'),
    deltaValue: Number(row.price_deviation_pct),
    delta: `${Number(row.price_deviation_pct) >= 0 ? '+' : ''}${Number(row.price_deviation_pct).toFixed(1)}%`,
    volume: Number(row.quantity).toLocaleString('ko-KR'), score: Number(row.risk_score),
    severity: row.severity, signal: row.signal, time: row.registered_at || row.created_at,
    confidence: Number(row.confidence_score), detectorVersion: row.detector_version,
    baselineSampleCount: Number(row.baseline_sample_count), volumeRatio: Number(row.volume_ratio),
    baselineReady: Number(row.baseline_sample_count) >= 3,
    imageUrl: `https://img-api.neople.co.kr/df/items/${row.item_id}`,
  }));
  const stats = await pool.query(
    `select coalesce(sum(listing_count),0)::int as listing_count,
            coalesce(sum(sold_sample_count),0)::int as sold_count,
            coalesce(avg(median_sold_price),0) as median_price,
            coalesce(avg(average_listing_price),0) as average_price
     from market_hourly_stats where bucket_at=(select max(bucket_at) from market_hourly_stats)`,
  );
  const summary = stats.rows[0];
  const coverage = await pool.query(
    `select count(*) filter (where active)::int as watch_count,
            count(*) filter (where active and baseline_count>=3)::int as baseline_ready,
            max(last_collected_at) as last_collection_at
     from (select w.active,w.last_collected_at,count(h.id) as baseline_count
           from market_watch_items w left join market_hourly_stats h on h.watch_item_id=w.id
           group by w.id) coverage`,
  );
  response.json({
    source: 'DNF tracker Sentinel Collector', fetchedAt: new Date().toISOString(), query: itemName || '전체 Watchlist',
    summary: { listingCount: summary.listing_count, soldSampleCount: summary.sold_count, medianSoldPrice: Number(summary.median_price), averageListingPrice: Number(summary.average_price),
      highRiskCount: rows.filter((row) => row.score >= 60 && row.confidence >= 55).length,
      averageRiskScore: rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0,
      watchItemCount: coverage.rows[0].watch_count, baselineReadyItems: coverage.rows[0].baseline_ready,
      lastCollectionAt: coverage.rows[0].last_collection_at },
    rows, limitations: 'Watchlist 기반 수집 데이터이며, 이상 징후는 불공정 이용 판정이 아닙니다.',
  });
});

app.get('/watch-items', async (_request, response) => {
  const result = await pool.query(`select id,item_name,active,priority,last_collected_at,last_error from market_watch_items order by priority desc,id`);
  response.json({ rows: result.rows });
});

app.get('/catalog', async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
  const kind = typeof request.query.kind === 'string' ? request.query.kind.trim() : '';
  const result = await pool.query(
    `select id,item_name,item_kind,category,level,job_name,source_name,market_verified,last_seen_at
     from item_catalog where ($1='' or item_name ilike '%' || $1 || '%') and ($2='' or item_kind=$2)
     order by level desc nulls last,item_name limit 500`,
    [query, kind],
  );
  const counts = await pool.query(`select item_kind,count(*)::int from item_catalog group by item_kind order by item_kind`);
  response.json({ query, kind, counts: counts.rows, rows: result.rows });
});

app.get('/operations/dashboard', async (request, response) => {
  const range = request.query.range === '30일' ? '30 days' : request.query.range === '7일' ? '7 days' : '24 hours';
  const [trend, alerts, topItems, health, rules, suppressions, cases, activity, alertCounts] = await Promise.all([
    pool.query(`select bucket_at,sum(high_risk_count)::int alert_count,round(avg(average_risk_score),1) average_risk
      from market_hourly_stats where bucket_at>=now()-$1::interval group by bucket_at order by bucket_at`, [range]),
    pool.query(`select a.id,a.status,a.severity,a.risk_score,a.confidence_score,a.signal,a.occurrences,
      a.first_seen_at,a.last_seen_at,a.assigned_to,a.resolution_reason,a.analyst_note,a.suppressed,w.item_name,a.direction,
      a.min_unit_price,a.max_unit_price,a.min_deviation_pct,a.max_deviation_pct,
      e.price_deviation_pct,e.baseline_price,e.volume_ratio,e.baseline_sample_count,e.feature_payload,
      s.unit_price,s.quantity,s.item_id,coalesce((select jsonb_agg(jsonb_build_object('priceBucket',pc.price_bucket,'minPrice',pc.min_unit_price,
        'maxPrice',pc.max_unit_price,'minDeviation',pc.min_deviation_pct,'maxDeviation',pc.max_deviation_pct,'occurrences',pc.occurrences)
        order by pc.occurrences desc) from incident_price_clusters pc where pc.alert_id=a.id),'[]'::jsonb) price_clusters
      from alerts a join market_watch_items w on w.id=a.watch_item_id
      left join anomaly_events e on e.id=a.representative_event_id left join auction_snapshots s on s.id=e.auction_snapshot_id
      order by case a.status when 'NEW' then 0 when 'INVESTIGATING' then 1 else 2 end,a.risk_score desc,a.last_seen_at desc limit 100`),
    pool.query(`select w.item_name,count(*)::int alerts,max(a.risk_score)::int max_risk,sum(a.occurrences)::int occurrences
      from alerts a join market_watch_items w on w.id=a.watch_item_id where a.status not in ('BENIGN','CLOSED')
      group by w.id order by alerts desc,max_risk desc limit 10`),
    pool.query(`select w.id,w.item_name,w.last_collected_at,w.last_error,
      coalesce(r.status,'never') status,coalesce(r.listing_count,0) listing_count,coalesce(r.sold_count,0) sold_count,
      extract(epoch from (r.completed_at-r.started_at))::int duration_seconds
      from market_watch_items w left join lateral
      (select * from collection_runs where watch_item_id=w.id order by started_at desc limit 1) r on true
      where w.active order by (w.last_error is not null) desc,w.last_collected_at asc nulls first limit 105`),
    pool.query(`select * from detection_rules order by id`),
    pool.query(`select * from suppression_windows order by starts_at desc limit 20`),
    pool.query(`select c.*,w.item_name,a.severity,a.risk_score from analysis_cases c join alerts a on a.id=c.alert_id
      join market_watch_items w on w.id=a.watch_item_id order by c.updated_at desc limit 30`),
    pool.query(`select * from audit_logs order by created_at desc limit 20`),
    pool.query(`select count(*) filter(where status in ('NEW','INVESTIGATING','ESCALATED') and not suppressed)::int active,
      count(*) filter(where status in ('NEW','INVESTIGATING','ESCALATED') and not suppressed and severity in ('high','critical'))::int high
      from alerts`),
  ]);
  response.json({ fetchedAt: new Date().toISOString(), summary: {
    activeAlerts: alertCounts.rows[0].active, highAlerts: alertCounts.rows[0].high,
    collectionHealthy: health.rows.filter((row) => row.status==='completed' && !row.last_error).length,
    collectionTotal: health.rowCount, baselineReady: (await pool.query(`select count(*)::int count from (select watch_item_id from market_hourly_stats group by watch_item_id having count(*)>=3)s`)).rows[0].count,
  }, trend: trend.rows, alerts: alerts.rows, topItems: topItems.rows, collectionHealth: health.rows,
    rules: rules.rows, suppressions: suppressions.rows, cases: cases.rows, activity: activity.rows });
});

app.patch('/alerts/:id', async (request, response) => {
  const id = Number(request.params.id);
  const before = await pool.query(`select * from alerts where id=$1`, [id]);
  if (!before.rowCount) return response.status(404).json({ message: 'Alert를 찾을 수 없습니다.' });
  const { status, assignedTo, resolutionReason, analystNote } = request.body || {};
  const result = await pool.query(`update alerts set status=coalesce($2,status),assigned_to=coalesce($3,assigned_to),
    resolution_reason=coalesce($4,resolution_reason),analyst_note=coalesce($5,analyst_note),updated_at=now()
    where id=$1 returning *`, [id,status || null,assignedTo || null,resolutionReason || null,analystNote || null]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload,after_payload) values('alert',$1,'UPDATE',$2,$3)`,
    [id,before.rows[0],result.rows[0]]);
  response.json(result.rows[0]);
});

app.post('/alerts/:id/cases', async (request, response) => {
  const alertId = Number(request.params.id); const { title, priority, owner, summary } = request.body || {};
  const result = await pool.query(`insert into analysis_cases(alert_id,title,priority,owner,summary,status)
    values($1,$2,coalesce($3,'P2'),$4,$5,'OPEN') returning *`,
    [alertId,title || `Alert #${alertId} 조사`,priority || null,owner || null,summary || null]);
  await pool.query(`update alerts set status='INVESTIGATING',updated_at=now() where id=$1`, [alertId]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,after_payload) values('case',$1,'CREATE',$2)`, [result.rows[0].id,result.rows[0]]);
  response.status(201).json(result.rows[0]);
});

app.patch('/rules/:id', async (request, response) => {
  const id=Number(request.params.id); const before=await pool.query(`select * from detection_rules where id=$1`,[id]);
  const result=await pool.query(`update detection_rules set enabled=coalesce($2,enabled),thresholds=coalesce($3,thresholds),version=version+1,updated_at=now() where id=$1 returning *`,
    [id,typeof request.body?.enabled==='boolean'?request.body.enabled:null,request.body?.thresholds||null]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload,after_payload) values('rule',$1,'UPDATE',$2,$3)`,[id,before.rows[0],result.rows[0]]);
  response.json(result.rows[0]);
});

app.post('/backtests', async (request, response) => {
  const threshold=Math.max(0,Math.min(100,Number(request.body?.riskThreshold||60)));
  const stats=await pool.query(`select count(*)::int total,count(*) filter(where risk_score >= $1)::int matched,
    count(distinct watch_item_id) filter(where risk_score >= $1)::int affected_items,
    round(avg(confidence_score) filter(where risk_score >= $1),1) confidence from anomaly_events where created_at>=now()-interval '7 days'`,[threshold]);
  const result=stats.rows[0];
  await pool.query(`insert into backtest_runs(rule_key,parameters,result) values('combined-risk',$1,$2)`,[{riskThreshold:threshold},result]);
  response.json({ parameters:{riskThreshold:threshold},result });
});

app.post('/suppressions', async (request, response) => {
  const { name,itemPattern,startsAt,endsAt,reason }=request.body||{};
  if(!name||!startsAt||!endsAt||!reason) return response.status(400).json({message:'필수 입력값이 없습니다.'});
  const result=await pool.query(`insert into suppression_windows(name,item_pattern,starts_at,ends_at,reason) values($1,$2,$3,$4,$5) returning *`,[name,itemPattern||null,startsAt,endsAt,reason]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,after_payload) values('suppression',$1,'CREATE',$2)`,[result.rows[0].id,result.rows[0]]);
  response.status(201).json(result.rows[0]);
});

app.patch('/suppressions/:id', async (request, response) => {
  const id=Number(request.params.id); const {name,itemPattern,startsAt,endsAt,reason,enabled}=request.body||{};
  const before=await pool.query(`select * from suppression_windows where id=$1`,[id]);
  if(!before.rowCount) return response.status(404).json({message:'억제 구간을 찾을 수 없습니다.'});
  const result=await pool.query(`update suppression_windows set name=coalesce($2,name),item_pattern=$3,
    starts_at=coalesce($4,starts_at),ends_at=coalesce($5,ends_at),reason=coalesce($6,reason),
    enabled=coalesce($7,enabled),updated_at=now() where id=$1 returning *`,
    [id,name||null,itemPattern??before.rows[0].item_pattern,startsAt||null,endsAt||null,reason||null,typeof enabled==='boolean'?enabled:null]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload,after_payload) values('suppression',$1,'UPDATE',$2,$3)`,[id,before.rows[0],result.rows[0]]);
  response.json(result.rows[0]);
});

app.delete('/suppressions/:id', async (request, response) => {
  const id=Number(request.params.id); const before=await pool.query(`select * from suppression_windows where id=$1`,[id]);
  if(!before.rowCount) return response.status(404).json({message:'억제 구간을 찾을 수 없습니다.'});
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload) values('suppression',$1,'DELETE',$2)`,[id,before.rows[0]]);
  await pool.query(`delete from suppression_windows where id=$1`,[id]); response.status(204).send();
});

app.patch('/cases/:id', async (request, response) => {
  const id=Number(request.params.id); const {title,status,priority,owner,summary}=request.body||{};
  const before=await pool.query(`select * from analysis_cases where id=$1`,[id]);
  if(!before.rowCount) return response.status(404).json({message:'조사 케이스를 찾을 수 없습니다.'});
  const result=await pool.query(`update analysis_cases set title=coalesce($2,title),status=coalesce($3,status),
    priority=coalesce($4,priority),owner=$5,summary=$6,updated_at=now() where id=$1 returning *`,
    [id,title||null,status||null,priority||null,owner??before.rows[0].owner,summary??before.rows[0].summary]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload,after_payload) values('case',$1,'UPDATE',$2,$3)`,[id,before.rows[0],result.rows[0]]);
  response.json(result.rows[0]);
});

app.delete('/cases/:id', async (request, response) => {
  const id=Number(request.params.id); const before=await pool.query(`select * from analysis_cases where id=$1`,[id]);
  if(!before.rowCount) return response.status(404).json({message:'조사 케이스를 찾을 수 없습니다.'});
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload) values('case',$1,'DELETE',$2)`,[id,before.rows[0]]);
  await pool.query(`delete from analysis_cases where id=$1`,[id]); response.status(204).send();
});

app.get('/collaboration/dashboard', async (_request, response) => {
  const [metrics, contexts, notes, actions] = await Promise.all([
    pool.query(`select
      (select count(*)::int from anomaly_events where created_at>=coalesce((select greatest(min(first_seen_at),now()-interval '7 days') from alerts),now()-interval '7 days')) raw_signals,
      (select count(*)::int from alerts where first_seen_at>=coalesce((select greatest(min(first_seen_at),now()-interval '7 days') from alerts),now()-interval '7 days')) grouped_alerts,
      (select count(*)::int from alerts where status='BENIGN' and updated_at>=now()-interval '7 days') benign,
      (select count(*)::int from alerts where status='ESCALATED' and updated_at>=now()-interval '7 days') escalated,
      (select count(*)::int from response_actions where status in ('OPEN','IN_PROGRESS')) open_actions,
      (select count(*)::int from operational_contexts where status not in ('CANCELLED') and now() between starts_at and ends_at) active_contexts`),
    pool.query(`select *,case when now() between starts_at and ends_at then 'ACTIVE' when now()>ends_at then 'ENDED' else status end effective_status
      from operational_contexts order by starts_at desc limit 50`),
    pool.query(`select n.*,c.title context_title,w.item_name from collaboration_notes n
      left join operational_contexts c on c.id=n.context_id left join alerts a on a.id=n.alert_id
      left join market_watch_items w on w.id=a.watch_item_id order by n.created_at desc limit 50`),
    pool.query(`select r.*,w.item_name,a.risk_score,a.severity,c.title case_title from response_actions r
      left join alerts a on a.id=r.alert_id left join market_watch_items w on w.id=a.watch_item_id
      left join analysis_cases c on c.id=r.case_id order by r.created_at desc limit 50`),
  ]);
  const m=metrics.rows[0]; const raw=Number(m.raw_signals), grouped=Number(m.grouped_alerts);
  response.json({metrics:{...m,deduplicationRate:raw?Number(((1-grouped/raw)*100).toFixed(1)):0},contexts:contexts.rows,notes:notes.rows,actions:actions.rows});
});

app.post('/contexts', async (request, response) => {
  const {contextType,title,description,itemPattern,startsAt,endsAt,sourceLabel,createdBy}=request.body||{};
  if(!contextType||!title||!startsAt||!endsAt) return response.status(400).json({message:'필수 입력값이 없습니다.'});
  const result=await pool.query(`insert into operational_contexts(context_type,title,description,item_pattern,starts_at,ends_at,source_label,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[contextType,title,description||null,itemPattern||null,startsAt,endsAt,sourceLabel||null,createdBy||null]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,after_payload) values('context',$1,'CREATE',$2)`,[result.rows[0].id,result.rows[0]]);
  response.status(201).json(result.rows[0]);
});

app.patch('/contexts/:id', async (request, response) => {
  const id=Number(request.params.id),before=await pool.query(`select * from operational_contexts where id=$1`,[id]);
  if(!before.rowCount) return response.status(404).json({message:'운영 컨텍스트를 찾을 수 없습니다.'});
  const {contextType,title,description,itemPattern,startsAt,endsAt,sourceLabel,status}=request.body||{};
  const result=await pool.query(`update operational_contexts set context_type=coalesce($2,context_type),title=coalesce($3,title),description=$4,
    item_pattern=$5,starts_at=coalesce($6,starts_at),ends_at=coalesce($7,ends_at),source_label=$8,status=coalesce($9,status),updated_at=now() where id=$1 returning *`,
    [id,contextType||null,title||null,description??before.rows[0].description,itemPattern??before.rows[0].item_pattern,startsAt||null,endsAt||null,sourceLabel??before.rows[0].source_label,status||null]);
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload,after_payload) values('context',$1,'UPDATE',$2,$3)`,[id,before.rows[0],result.rows[0]]); response.json(result.rows[0]);
});

app.delete('/contexts/:id', async (request, response) => {
  const id=Number(request.params.id),before=await pool.query(`select * from operational_contexts where id=$1`,[id]);
  if(!before.rowCount) return response.status(404).json({message:'운영 컨텍스트를 찾을 수 없습니다.'});
  await pool.query(`insert into audit_logs(entity_type,entity_id,action,before_payload) values('context',$1,'DELETE',$2)`,[id,before.rows[0]]);
  await pool.query(`delete from operational_contexts where id=$1`,[id]); response.status(204).send();
});

app.post('/collaboration-notes', async (request, response) => {
  const {contextId,alertId,authorRole,feedbackType,note}=request.body||{}; if(!note)return response.status(400).json({message:'내용이 필요합니다.'});
  const result=await pool.query(`insert into collaboration_notes(context_id,alert_id,author_role,feedback_type,note) values($1,$2,$3,$4,$5) returning *`,[contextId||null,alertId||null,authorRole||'CM',feedbackType||'CONTEXT',note]);response.status(201).json(result.rows[0]);
});

app.post('/response-actions', async (request, response) => {
  const {alertId,caseId,actionType,targetTeam,owner,note}=request.body||{}; if(!actionType)return response.status(400).json({message:'대응 유형이 필요합니다.'});
  const result=await pool.query(`insert into response_actions(alert_id,case_id,action_type,target_team,owner,note) values($1,$2,$3,$4,$5,$6) returning *`,[alertId||null,caseId||null,actionType,targetTeam||null,owner||null,note||null]);response.status(201).json(result.rows[0]);
});

app.patch('/response-actions/:id', async (request, response) => {
  const id=Number(request.params.id),{status,owner,note}=request.body||{}; const result=await pool.query(`update response_actions set status=coalesce($2,status),owner=$3,note=$4,updated_at=now() where id=$1 returning *`,[id,status||null,owner??null,note??null]);
  if(!result.rowCount)return response.status(404).json({message:'후속 대응을 찾을 수 없습니다.'}); response.json(result.rows[0]);
});

await waitForDatabase();
app.listen(config.port, '0.0.0.0', () => console.log(`[api] listening on ${config.port}`));
