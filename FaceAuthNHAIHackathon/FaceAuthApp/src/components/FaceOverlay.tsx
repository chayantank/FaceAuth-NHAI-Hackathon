/**
 * @file FaceOverlay.tsx
 * @description Camera overlay that draws a bounding box and landmark dots
 * on top of a detected face. Color changes by detection state with animated pulsing.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

/** Bounding box coordinates (normalised 0-1 or absolute px). */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single facial landmark point. */
export interface Landmark {
  x: number;
  y: number;
}

/** Current detection state used to drive overlay color. */
export type DetectionState = 'detecting' | 'matched' | 'rejected';

/** Props for the FaceOverlay component. */
export interface FaceOverlayProps {
  /** Bounding box of the detected face. If `null`, nothing is rendered. */
  boundingBox: BoundingBox | null;
  /** Array of up to 5 facial landmark points. */
  landmarks?: Landmark[];
  /** Detection state that controls the overlay color. */
  state: DetectionState;
}

/** Maps detection states to colors. */
const STATE_COLORS: Record<DetectionState, string> = {
  detecting: '#FFD600',
  matched: '#00E676',
  rejected: '#FF5252',
};

/**
 * Overlay component rendered on top of the camera preview.
 *
 * - Draws a bounding box around the detected face.
 * - Renders up to 5 landmark dots (e.g. eyes, nose, mouth corners).
 * - Border colour changes based on the current `state`.
 * - An animated opacity pulse draws attention to the bounding box.
 *
 * @example
 * ```tsx
 * <FaceOverlay
 *   boundingBox={{ x: 100, y: 120, width: 200, height: 250 }}
 *   landmarks={[{ x: 150, y: 180 }, { x: 250, y: 180 }]}
 *   state="detecting"
 * />
 * ```
 */
export const FaceOverlay: React.FC<FaceOverlayProps> = ({
  boundingBox,
  landmarks = [],
  state,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.5,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  if (!boundingBox) {
    return null;
  }

  const color = STATE_COLORS[state];

  return (
    <View style={styles.absoluteFill} pointerEvents="none">
      {/* Bounding box */}
      <Animated.View
        style={[
          styles.boundingBox,
          {
            left: boundingBox.x,
            top: boundingBox.y,
            width: boundingBox.width,
            height: boundingBox.height,
            borderColor: color,
            opacity: pulseAnim,
          },
        ]}
      >
        {/* Corner accents */}
        <View style={[styles.cornerTL, { borderColor: color }]} />
        <View style={[styles.cornerTR, { borderColor: color }]} />
        <View style={[styles.cornerBL, { borderColor: color }]} />
        <View style={[styles.cornerBR, { borderColor: color }]} />
      </Animated.View>

      {/* Landmark dots */}
      {landmarks.map((point, index) => (
        <View
          key={`lm-${index}`}
          style={[
            styles.landmark,
            {
              left: point.x - 4,
              top: point.y - 4,
              backgroundColor: color,
            },
          ]}
        />
      ))}
    </View>
  );
};

const CORNER_SIZE = 20;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  absoluteFill: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0,
  },
  boundingBox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  landmark: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cornerTL: {
    position: 'absolute',
    top: -1,
    left: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    position: 'absolute',
    bottom: -1,
    left: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 8,
  },
});
