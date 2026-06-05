/**
 * @file MetricsCard.tsx
 * @description Glassmorphism-style card for displaying a single metric.
 * Features a semi-transparent background and an animated number counter.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

/** Props for the MetricsCard component. */
export interface MetricsCardProps {
  /** Card title (e.g. "Enrolled Users"). */
  title: string;
  /** Primary value to display (numeric or string). */
  value: string | number;
  /** Optional smaller text below the value. */
  subtitle?: string;
  /** Emoji icon rendered at the top-left. */
  icon: string;
  /** Accent color used for the icon background and value text. */
  color: string;
}

/**
 * A premium glassmorphism-style card for displaying a key metric.
 *
 * The card fades-and-slides in on mount using React Native's Animated API.
 * If `value` is a number the component animates a count-up from 0.
 *
 * @example
 * ```tsx
 * <MetricsCard
 *   title="Enrolled Users"
 *   value={42}
 *   subtitle="Last enrolled 2h ago"
 *   icon="👤"
 *   color="#00D9FF"
 * />
 * ```
 */
export const MetricsCard: React.FC<MetricsCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const counterAnim = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = React.useState<string>(
    typeof value === 'number' ? '0' : String(value),
  );

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (typeof value === 'number') {
      counterAnim.setValue(0);
      const listener = counterAnim.addListener(({ value: v }) => {
        setDisplayValue(Math.round(v).toString());
      });

      Animated.timing(counterAnim, {
        toValue: value,
        duration: 800,
        useNativeDriver: false,
      }).start();

      return () => counterAnim.removeListener(listener);
    } else {
      setDisplayValue(String(value));
    }
  }, [value, counterAnim]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={[styles.iconContainer, { backgroundColor: `${color}20` }]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={[styles.value, { color }]}>{displayValue}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    padding: 16,
    margin: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  icon: {
    fontSize: 20,
  },
  title: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 2,
  },
});
