import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { type, pool_id, from, to, limit } = req.query;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

  try {
    if (type === 'pools' && pool_id) {
      let query = supabase
        .from('surf_pool_snapshots')
        .select('*')
        .eq('pool_id', pool_id)
        .order('snapshot_at', { ascending: true });

      if (from) query = query.gte('snapshot_at', from);
      if (to) query = query.lte('snapshot_at', to);
      if (limit) query = query.limit(parseInt(limit));

      const { data, error } = await query;
      if (error) throw error;
      return res.json(data);
    }

    if (type === 'pools') {
      let query = supabase
        .from('surf_pool_snapshots')
        .select('*')
        .order('snapshot_at', { ascending: true });

      if (from) query = query.gte('snapshot_at', from);
      if (to) query = query.lte('snapshot_at', to);
      if (limit) query = query.limit(parseInt(limit));

      const { data, error } = await query;
      if (error) throw error;
      return res.json(data);
    }

    let query = supabase
      .from('surf_protocol_snapshots')
      .select('*')
      .order('snapshot_at', { ascending: true });

    if (from) query = query.gte('snapshot_at', from);
    if (to) query = query.lte('snapshot_at', to);
    if (limit) query = query.limit(parseInt(limit));

    const [snapResult, poolResult] = await Promise.all([
      query,
      supabase
        .from('surf_pool_snapshots')
        .select('pool_id')
        .order('snapshot_at', { ascending: false })
        .limit(1),
    ]);

    const { data, error } = snapResult;
    if (error) throw error;

    const availablePools = poolResult.data
      ? [...new Set(poolResult.data.map(r => r.pool_id))].sort()
      : [];

    return res.json({ snapshots: data, availablePools });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
