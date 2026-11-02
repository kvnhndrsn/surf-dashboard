const HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';

function decodeHex(hex) {
  try {
    return decodeURIComponent(hex.replace(/([0-9a-fA-F]{2})/g, '%$1'));
  } catch {
    return null;
  }
}

function extractHandle(entry) {
  if (entry.policy_id === HANDLE_POLICY) {
    const hex = entry.asset_name || '';
    const name = decodeHex(hex);
    if (name) return '$' + name;
  }
  return null;
}

async function fetchAddressAssets(addresses, koiosUrl) {
  try {
    const resp = await fetch(koiosUrl + '/address_assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: addresses }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const addresses = req.query.addresses ? req.query.addresses.split(',') : [];
  if (addresses.length === 0) return res.json({});
  if (addresses.length > 100) return res.status(400).json({ error: 'Max 100 addresses' });

  try {
    const valid = addresses.filter(a => a && (a.startsWith('addr') || a.startsWith('stake')));
    if (valid.length === 0) return res.json({});

    const map = {};
    // v2 does not exist on Koios (404), so try v1 first to avoid a wasted round trip.
    const baseUrl = process.env.KOIOS_API_URL || 'https://api.koios.rest/api/v1';
    const fallbackUrl = 'https://api.koios.rest/api/v2';

    let data = await fetchAddressAssets(valid, baseUrl);

    if (!data) {
      data = await fetchAddressAssets(valid, fallbackUrl);
    }

    if (!Array.isArray(data)) return res.json(map);

    for (const entry of data) {
      if (entry.asset_list && Array.isArray(entry.asset_list)) {
        const addr = entry.address;
        for (const asset of entry.asset_list) {
          const handle = extractHandle(asset);
          if (handle) {
            map[addr] = handle;
            break;
          }
        }
      } else {
        const handle = extractHandle(entry);
        if (handle) {
          map[entry.address] = handle;
        }
      }
    }

    return res.json(map);
  } catch {
    return res.json({});
  }
}
