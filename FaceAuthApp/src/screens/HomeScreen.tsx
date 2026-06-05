/**
 * @file HomeScreen.tsx
 * @description Main dashboard for FaceAuth. Displays stats cards, primary
 * action buttons, and navigation links with glassmorphism styling and
 * entrance animations.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/AppNavigator';
import { MetricsCard } from '../components/MetricsCard';
import { StatusBadge } from '../components/StatusBadge';
import { embeddingStore } from '../storage/EmbeddingStore';
import { secureDB } from '../storage/SecureDB';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** Theme colours used throughout the home screen. */
const COLORS = {
  bg: '#0B1120',
  accent: '#00D9FF',
  amber: '#FFB800',
  cardBg: 'rgba(255, 255, 255, 0.06)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.55)',
};

/**
 * Home dashboard screen.
 *
 * Renders four glassmorphism stats cards (enrolled users, last sync,
 * device status, model status), two prominent action buttons (Enroll,
 * Authenticate), and bottom navigation links (Sync Center, Settings).
 */
export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(false);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [lastSyncLabel, setLastSyncLabel] = useState('Never');

  // Refresh live stats whenever the screen gains focus
  const refreshStats = useCallback(() => {
    setEnrolledCount(embeddingStore.getCount());
    const lastSync = secureDB.getLastSyncTime();
    if (lastSync) {
      const d = new Date(lastSync);
      setLastSyncLabel(
        d.toLocaleString('en-IN', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        }),
      );
    } else {
      setLastSyncLabel('Never');
    }
  }, []);

  useEffect(() => {
    refreshStats();
    const unsubscribe = navigation.addListener('focus', refreshStats);
    return unsubscribe;
  }, [refreshStats, navigation]);

  // Entrance animations
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(-30)).current;
  const buttonsFade = useRef(new Animated.Value(0)).current;
  const buttonsSlide = useRef(new Animated.Value(40)).current;
  const footerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(150, [
      Animated.parallel([
        Animated.timing(headerFade, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(headerSlide, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(buttonsFade, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(buttonsSlide, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(footerFade, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [headerFade, headerSlide, buttonsFade, buttonsSlide, footerFade]);

  // Network status listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
    });
    return () => unsubscribe();
  }, []);

  const handleEnroll = useCallback(() => {
    navigation.navigate('Enroll');
  }, [navigation]);

  const handleAuthenticate = useCallback(() => {
    navigation.navigate('Authenticate');
  }, [navigation]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: headerFade,
              transform: [{ translateY: headerSlide }],
            },
          ]}
        >
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.appTitle}>FaceAuth</Text>
              <Text style={styles.appSubtitle}>
                Offline Face Recognition
              </Text>
            </View>
            <StatusBadge
              status={isOnline ? 'online' : 'offline'}
              label={isOnline ? 'Online' : 'Offline'}
            />
          </View>
        </Animated.View>

        {/* ── Stats Cards ─────────────────────────────────────── */}
        <View style={styles.cardsRow}>
          <MetricsCard
            title="Enrolled Users"
            value={enrolledCount}
            subtitle={enrolledCount === 0 ? 'No users yet' : `${enrolledCount} user${enrolledCount !== 1 ? 's' : ''} registered`}
            icon="👤"
            color={COLORS.accent}
          />
          <MetricsCard
            title="Last Sync"
            value={lastSyncLabel === 'Never' ? 'Never' : lastSyncLabel}
            subtitle={lastSyncLabel === 'Never' ? 'No sync history' : 'Synced to cloud'}
            icon="🔄"
            color={COLORS.amber}
          />
        </View>
        <View style={styles.cardsRow}>
          <MetricsCard
            title="Device Status"
            value={isOnline ? 'Online' : 'Offline'}
            subtitle={isOnline ? 'Connected to network' : 'No network'}
            icon="📡"
            color={isOnline ? '#00E676' : '#FF5252'}
          />
          <MetricsCard
            title="Model Status"
            value="Ready"
            subtitle="All models loaded"
            icon="🧠"
            color="#BB86FC"
          />
        </View>

        {/* ── Action Buttons ──────────────────────────────────── */}
        <Animated.View
          style={[
            styles.actionsContainer,
            {
              opacity: buttonsFade,
              transform: [{ translateY: buttonsSlide }],
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.actionButton, styles.enrollButton]}
            onPress={handleEnroll}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>➕</Text>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Enroll New User</Text>
              <Text style={styles.actionDescription}>
                Capture face for recognition
              </Text>
            </View>
            <Text style={styles.actionArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.authButton]}
            onPress={handleAuthenticate}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>🔐</Text>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Authenticate</Text>
              <Text style={styles.actionDescription}>
                Verify identity in real-time
              </Text>
            </View>
            <Text style={styles.actionArrow}>›</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Footer Links ────────────────────────────────────── */}
        <Animated.View
          style={[styles.footerLinks, { opacity: footerFade }]}
        >
          <TouchableOpacity
            style={styles.footerLink}
            onPress={() => navigation.navigate('Sync')}
            activeOpacity={0.7}
          >
            <Text style={styles.footerLinkIcon}>☁️</Text>
            <Text style={styles.footerLinkText}>Sync Center</Text>
          </TouchableOpacity>

          <View style={styles.footerDivider} />

          <TouchableOpacity
            style={styles.footerLink}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
          >
            <Text style={styles.footerLinkIcon}>⚙️</Text>
            <Text style={styles.footerLinkText}>Settings</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  /* Header */
  header: {
    marginTop: 16,
    marginBottom: 24,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  /* Cards */
  cardsRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 4,
  },
  /* Actions */
  actionsContainer: {
    marginTop: 20,
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  enrollButton: {
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    borderColor: 'rgba(0, 217, 255, 0.25)',
  },
  authButton: {
    backgroundColor: 'rgba(255, 184, 0, 0.08)',
    borderColor: 'rgba(255, 184, 0, 0.25)',
  },
  actionIcon: {
    fontSize: 28,
    marginRight: 14,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  actionDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  actionArrow: {
    fontSize: 28,
    fontWeight: '300',
    color: COLORS.textSecondary,
  },
  /* Footer Links */
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    padding: 16,
    borderRadius: 16,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  footerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footerLinkIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  footerLinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  footerDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
});
