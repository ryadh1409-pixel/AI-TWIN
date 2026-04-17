/**
 * Google Places API — Nearby Search (one request per type; Google does not support type=cafe|restaurant|park).
 */

const NEARBY_RADIUS_M = 1500;
const PLACE_TYPES = [
  { type: 'cafe', label: 'cafe' },
  { type: 'restaurant', label: 'restaurant' },
  { type: 'park', label: 'park' },
];

function toRad(d) {
  return (d * Math.PI) / 180;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatDistance(m) {
  if (m < 1000) return `~${m} m`;
  return `~${(m / 1000).toFixed(1)} km`;
}

function mapsUrlForPlace(place) {
  const q = encodeURIComponent(place.name);
  if (place.placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(place.placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

async function nearbySearchType(lat, lng, type, apiKey) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', String(NEARBY_RADIUS_M));
  url.searchParams.set('type', type);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const err = new Error(data.error_message || data.status || 'Places request failed');
    err.status = data.status;
    throw err;
  }

  const results = data.results || [];
  return results.map((r) => {
    const plat = r.geometry?.location?.lat;
    const plng = r.geometry?.location?.lng;
    const dm =
      plat != null && plng != null
        ? distanceMeters(lat, lng, plat, plng)
        : NEARBY_RADIUS_M;
    return {
      placeId: r.place_id || '',
      name: r.name || 'Unknown',
      rating: typeof r.rating === 'number' ? r.rating : null,
      vicinity: typeof r.vicinity === 'string' ? r.vicinity : '',
      distanceM: dm,
      lat: plat,
      lng: plng,
      types: Array.isArray(r.types) ? r.types : [],
    };
  });
}

function pickTopThree(lat, lng, buckets) {
  const picked = [];
  const used = new Set();

  for (const { label } of PLACE_TYPES) {
    const list = (buckets[label] || [])
      .slice()
      .sort((a, b) => a.distanceM - b.distanceM);
    const best = list.find((p) => p.placeId && !used.has(p.placeId));
    if (best) {
      used.add(best.placeId);
      picked.push({
        ...best,
        category: label,
        mapsUrl: mapsUrlForPlace(best),
      });
    }
  }

  const flat = Object.values(buckets)
    .flat()
    .filter((p) => p.placeId && !used.has(p.placeId))
    .sort((a, b) => a.distanceM - b.distanceM);

  for (const p of flat) {
    if (picked.length >= 3) break;
    used.add(p.placeId);
    picked.push({
      ...p,
      category: p.types?.includes('cafe')
        ? 'cafe'
        : p.types?.includes('restaurant')
          ? 'restaurant'
          : p.types?.includes('park')
            ? 'park'
            : 'place',
      mapsUrl: mapsUrlForPlace(p),
    });
  }

  return picked.slice(0, 3);
}

/**
 * One combined Nearby Search (parallel per type). Returns null on failure / missing key.
 */
async function loadNearbyPicked(lat, lng) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return null;
  }

  try {
    const buckets = { cafe: [], restaurant: [], park: [] };

    await Promise.all(
      PLACE_TYPES.map(async ({ type, label }) => {
        const list = await nearbySearchType(lat, lng, type, apiKey);
        buckets[label] = list;
      }),
    );

    const picked = pickTopThree(lat, lng, buckets);
    return picked.length ? picked : null;
  } catch (e) {
    console.warn('[places] loadNearbyPicked:', e?.message || e);
    return null;
  }
}

/**
 * Fetches up to 3 nearby cafes / restaurants / parks.
 * @returns {Promise<Array<{ name: string, rating: number|'N/A', address: string }>>}
 */
async function getNearbyPlaces(lat, lng) {
  const picked = await loadNearbyPicked(lat, lng);
  if (!picked) return [];
  return picked.map((p) => ({
    name: p.name,
    rating: p.rating != null ? p.rating : 'N/A',
    address: p.vicinity || '',
  }));
}

function buildNearbyPromptBlockFromSimple(places) {
  if (!places.length) return null;
  const lines = places
    .map((p, i) => {
      const r = p.rating === 'N/A' || p.rating == null ? 'N/A' : String(p.rating);
      return `${i + 1}. ${p.name} - rating ${r}`;
    })
    .join('\n');
  return `Nearby places:
${lines}
Respond briefly and naturally in Arabic (about 1–3 sentences when suggesting a spot); mention a place by name and rating if helpful. Do not invent venues not listed above.`;
}

function buildFallbackPromptBlock() {
  return `Nearby places (approximate — live place search unavailable):
1. A café near you — rating N/A
2. A park — rating N/A
3. A restaurant — rating N/A
Suggest short, natural Arabic ideas without inventing specific business names.`;
}

async function fetchNearbyPlaces(lat, lng) {
  const picked = await loadNearbyPicked(lat, lng);

  if (!picked || picked.length === 0) {
    return {
      places: [],
      promptBlock: buildFallbackPromptBlock(),
      source: 'fallback',
    };
  }

  const simple = picked.map((p) => ({
    name: p.name,
    rating: p.rating != null ? p.rating : 'N/A',
    address: p.vicinity || '',
  }));

  const places = picked.map((p) => ({
    name: p.name,
    rating: typeof p.rating === 'number' ? p.rating : null,
    distanceM: p.distanceM,
    category: p.category,
    placeId: p.placeId,
    lat: p.lat,
    lng: p.lng,
    mapsUrl: p.mapsUrl,
  }));

  return {
    places,
    promptBlock: buildNearbyPromptBlockFromSimple(simple),
    source: 'google',
  };
}

module.exports = {
  getNearbyPlaces,
  fetchNearbyPlaces,
  formatDistance,
  mapsUrlForPlace,
};
