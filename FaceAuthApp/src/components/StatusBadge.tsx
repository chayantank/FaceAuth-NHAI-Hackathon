/**
 * @file StatusBadge.tsx
 * @description Reusable color-coded status badge with animated pulsing dot.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

/** Allowed status values for the badge. */
export type BadgeStatus = 'online' | 'offline' | 'loading' | 'ready' | 'error';

/** Props for the StatusBadge component. */
export interface StatusBadgeProps {
  /** Current status to display. */
  status: BadgeStatus;
  /** Text label shown beside the dot. */
  label: string;
}

/** Maps each status to its corresponding color. */
const STATUS_COLORS: Record<BadgeStatus, string> = {
  online: '#00E676',
  ready: '#00E676',
  offline: '#FF5252',
  error: '#FF5252',
  loading: '#FFB800',
};

/** Whether the dot should pulse for this status. */
const PULSING_STATUSES: Set<BadgeStatus> = new Set(['online', 'ready', 'loading']);

/**
 * A small badge that shows a colored dot and label text.
 *
 * Active statuses (`online`, `ready`, `loading`) display a pulsing
 * opacity animation on the dot. Inactive / error statuses show a static dot.
 *
 * @example
 * ```tsx
 * <StatusBadge status="online" label="Connected" />
 * ```
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (PULSING_STATUSES.has(status)) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  const dotColor = STATUS_COLORS[status];

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: dotColor, opacity: pulseAnim },
        ]}
      />
      <Text style={[styles.label, { color: dotColor }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
