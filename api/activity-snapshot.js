import { createClient } from '@supabase/supabase-js';

const SURF_API = 'https://surflending.org';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function surfFetch(path) {
  const res = await fetch(SURF_API + path);
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req, res) {
  if (req.query.key !== process.env.SNAPSHOT_KEY) {
    return res.status(401).json({ error: 'invalid key' });
  }

  try {
    const activities = await surfFetch('/api/getActivities?length=50');
    if (!activities || !Array.isArray(activities)) {
      return res.status(502).json({ error: 'could not fetch activities' });
    }

    const rows = activities.map(a => ({
      activity_type: a.type,
      address: a.address || '',
      amount: a.amount || 0,
      asset: a.asset || '',
      collateral_amount: a.collateralAmount || 0,
      collateral_asset: a.collateralAsset || '',
      pool_id: a.poolId || '',
      tx_hash: a.txHash || '',
      activity_time: a.time || 0,
    }));

    const { error } = await supabase
      .from('surf_activities')
      .upsert(rows, { onConflict: 'tx_hash', ignoreDuplicates: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const { count } = await supabase
      .from('surf_activities')
      .select('*', { count: 'exact', head: true });

    return res.json({ fetched: rows.length, total_stored: count });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
