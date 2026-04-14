import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SETUP_STORAGE_KEY } from '@/constants/setup';

export default function Index() {
  const [ready, setReady] = useState<'loading' | 'setup' | 'app'>('loading');

  useEffect(() => {
    void AsyncStorage.getItem(SETUP_STORAGE_KEY).then((v) => {
      setReady(v === '1' ? 'app' : 'setup');
    });
  }, []);

  if (ready === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (ready === 'setup') {
    return <Redirect href="/setup" />;
  }

  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
