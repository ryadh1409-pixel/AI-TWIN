import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { GeniusAvatar } from './GeniusAvatar';

export function ThinkingIndicator() {
  const dot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(dot, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [dot]);

  const d1 = dot.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0.35, 1, 0.35, 0.35, 0.35],
  });
  const d2 = dot.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0.35, 0.35, 1, 0.35, 0.35],
  });
  const d3 = dot.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0.35, 0.35, 0.35, 1, 0.35],
  });

  return (
    <View style={styles.row}>
      <GeniusAvatar mode="thinking" size={45} showLabel={false} />
      <View style={styles.textBlock}>
        <Text style={styles.thinkingTitle}>🧠 Thinking</Text>
        <View style={styles.dotsRow}>
          <Animated.Text style={[styles.dot, { opacity: d1 }]}>.</Animated.Text>
          <Animated.Text style={[styles.dot, { opacity: d2 }]}>.</Animated.Text>
          <Animated.Text style={[styles.dot, { opacity: d3 }]}>.</Animated.Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingLeft: 4,
    gap: 10,
  },
  textBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  thinkingTitle: {
    color: '#FF6B00',
    fontSize: 15,
    fontWeight: '700',
  },
  dotsRow: {
    flexDirection: 'row',
    marginLeft: 2,
  },
  dot: {
    color: '#FF8C3A',
    fontSize: 20,
    fontWeight: '900',
    width: 8,
  },
});
