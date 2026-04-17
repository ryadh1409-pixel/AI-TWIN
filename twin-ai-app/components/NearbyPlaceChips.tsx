import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NearbyPlaceSuggestion } from '@/services/api';

function formatDist(m: number) {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function openMapsSearch(placeName: string) {
  const q = encodeURIComponent(placeName);
  const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
  void Linking.openURL(url);
}

type Props = {
  places: NearbyPlaceSuggestion[];
  nearbySource?: string;
};

export function NearbyPlaceChips({ places, nearbySource }: Props) {
  if (!places?.length) return null;
  const subtitle =
    nearbySource === 'google'
      ? 'From Google Places'
      : nearbySource === 'fallback'
        ? 'Approximate ideas'
        : '';

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Nearby</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      {places.map((p, i) => (
        <View
          key={`${p.placeId || p.name}-${i}`}
          style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.name}>{p.name}</Text>
            <Text style={styles.meta}>
              {p.category} · {p.rating != null ? `${p.rating}★` : '—'} ·{' '}
              {formatDist(p.distanceM)}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.mapsBtn, pressed && styles.mapsBtnPressed]}
            onPress={() => openMapsSearch(p.name)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${p.name} in Maps`}>
            <Text style={styles.mapsBtnText}>Open in Maps</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: 8,
  },
  heading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  sub: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
  },
  card: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f0f4fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dde4f0',
    gap: 8,
  },
  rowText: {
    width: '100%',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  meta: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  mapsBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f4f8f',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  mapsBtnPressed: {
    opacity: 0.88,
  },
  mapsBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
