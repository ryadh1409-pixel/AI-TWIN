import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

export type GeniusAvatarMode = 'breathing' | 'thinking' | 'speaking';

type Props = {
  mode: GeniusAvatarMode;
  size?: number;
  showLabel?: boolean;
};

export function GeniusAvatar({ mode, size = 45, showLabel = true }: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const speakGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    spin.stopAnimation();
    breathe.stopAnimation();
    speakGlow.stopAnimation();
    spin.setValue(0);
    breathe.setValue(0);
    speakGlow.setValue(0);

    if (mode === 'thinking') {
      const loop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 1400,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
      return () => loop.stop();
    }

    if (mode === 'breathing') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 1,
            duration: 2200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breathe, {
            toValue: 0,
            duration: 2200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }

    if (mode === 'speaking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(speakGlow, {
            toValue: 1,
            duration: 550,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(speakGlow, {
            toValue: 0,
            duration: 550,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }

    return undefined;
  }, [mode, spin, breathe, speakGlow]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const scale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  const speakScale = speakGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  const speakOpacity = speakGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  const innerTransform =
    mode === 'thinking'
      ? [{ rotate: rotation }]
      : mode === 'breathing'
        ? [{ scale }]
        : [{ scale: speakScale }];

  return (
    <View style={styles.column}>
      <View style={[styles.wrap, { width: size + 14, height: size + 14 }]}>
        {mode === 'speaking' ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.speakRing,
              {
                width: size + 14,
                height: size + 14,
                borderRadius: (size + 14) / 2,
                opacity: speakOpacity,
                transform: [{ scale: speakScale }],
              },
            ]}
          />
        ) : null}
        <Animated.View style={{ transform: innerTransform }}>
          <LinearGradient
            colors={['#FF6B00', '#FF8C3A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.gradient, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[styles.emoji, { fontSize: size * 0.42 }]}>🧠</Text>
          </LinearGradient>
        </Animated.View>
      </View>
      {showLabel ? <Text style={styles.label}>Genius AI</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
  },
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakRing: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: '#FF6B00',
    shadowColor: '#FF6B00',
    shadowOpacity: 0.95,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  gradient: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B00',
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  emoji: {},
  label: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '700',
    color: '#FF6B00',
    letterSpacing: 0.2,
  },
});
