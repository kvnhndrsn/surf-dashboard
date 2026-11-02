const HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';

// CIP-68 asset names are hex(label) + hex(name): 222 = handle reference token,
// 100 = user token. Plain (pre-CIP-68) handles are just hex(name).
const CIP68_PREFIXES = ['000de140', '000643b0'];

// /address_assets answers with one row per asset and caps the response at 1000
// rows, so a single whale address (SURF pools hold thousands of assets) can eat
// the whole page and starve the other addresses in the batch. Ask a few at a time.
const CHUNK_SIZE = 4;
const PARALLEL_CHUNKS = 3;
const CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map();

function decodeHandleName(assetNameHex) {
  if (!assetNameHex) return null;
  let hex = String(assetNameHex).toLowerCase();
  for (const prefix of CIP68_PREFIXES) {
    if (hex.startsWith(prefix)) {
      hex = hex.slice(prefix.length);
      break;
    }
  }
  if (!hex || hex.length % 2 !== 0) return null;

  let name = '';
  try {
    if (typeof Buffer !== 'undefined') {
      name = Buffer.from(hex, 'hex').toString('utf8');
    } else {
      for (let i = 0; i < hex.length; i += 2) {
        name += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
    }
  } catch {
    return null;
  }

  name = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!name || name.includes('\uFFFD')) return null;
  return name;
}

function handleFromRow(row) {
  const policy = row.policy_id || row.policyId;
  if (policy !== HANDLE_POLICY) return null;
  const name = decodeHandleName(row.asset_name || row.assetName || '');
  return name ? '$' + name : null;
}

async function postAddressAssets(addresses, baseUrl) {
  try {
    const resp = await fetch(baseUrl + '/address_assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: addresses }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const requested = req.query.addresses ? String(req.query.addresses).split(',') : [];
  const addresses = [...new Set(
    requested.map(a => (a || '').trim()).filter(a => a.startsWith('addr') || a.startsWith('stake')),
  )].slice(0, 100);

  const map = {};
  const now = Date.now();
  const missing = [];

  for (const address of addresses) {
    const hit = cache.get(address);
    if (hit && now - hit.at <= CACHE_TTL_MS) {
      if (hit.handle) map[address] = hit.handle;
    } else {
      if (hit) cache.delete(address);
      missing.push(address);
    }
  }
  if (missing.length === 0) return res.json(map);

  const chunks = [];
  for (let i = 0; i < missing.length; i += CHUNK_SIZE) chunks.push(missing.slice(i, i + CHUNK_SIZE));

  const baseUrl = process.env.KOIOS_API_URL || 'https://api.koios.rest/api/v1';
  const fallbackUrl = 'https://api.koios.rest/api/v2';

  const runChunk = async (chunk) => {
    let rows = await postAddressAssets(chunk, baseUrl);
    if (!rows) rows = await postAddressAssets(chunk, fallbackUrl);
    // Transient Koios failure: leave these uncached so the next load retries.
    if (!rows) return;

    const found = new Map();
    for (const row of rows) {
      const address = row.address || row.payment_address;
      if (!address) continue;
      const list = Array.isArray(row.asset_list) ? row.asset_list : [row];
      for (const asset of list) {
        const handle = handleFromRow(asset);
        if (handle) {
          found.set(address, handle);
          break;
        }
      }
    }

    for (const address of chunk) {
      const handle = found.get(address) || null;
      cache.set(address, { handle, at: Date.now() });
      if (handle) map[address] = handle;
    }
  };

  // Small worker pool: enough throughput to stay fast, gentle enough for Koios.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
      await runChunk(chunk);
    }
  }));

  return res.json(map);
}
