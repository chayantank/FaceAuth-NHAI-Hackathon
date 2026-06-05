/**
 * FaceAuth — Offline Face Recognition & Liveness Detection
 *
 * Main application entry point.
 * Sets up navigation, theming, and global providers.
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';

import { AppNavigator } from './src/navigation/AppNavigator';
import { secureDB } from './src/storage/SecureDB';
import { syncManager } from './src/sync/SyncManager';

// ─── Dark Theme ──────────────────────────────────────────────────────────────

const FaceAuthDarkTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: '#00D9FF',
    background: '#0B1120',
    card: '#131B2E',
    text: '#FFFFFF',
    border: '#1E293B',
    notification: '#FFB800',
  },
};

// ─── App Component ───────────────────────────────────────────────────────────

function App(): React.JSX.Element {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      console.log('[App] Initializing...');

      // Initialize secure database
      await secureDB.initialize();
      console.log('[App] SecureDB initialized');

      // Initialize sync manager
      syncManager.initialize();
      console.log('[App] SyncManager initialized');

      // Note: ModelManager initialization happens on-demand in screens
      // to avoid blocking app startup

      setIsInitialized(true);
      console.log('[App] Initialization complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[App] Initialization failed:', message);
      setInitError(message);
    }
  };

  if (initError) {
    return (
      <SafeAreaProvider>
        <View style={styles.errorContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0B1120" />
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Initialization Failed</Text>
          <Text style={styles.errorMessage}>{initError}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!isInitialized) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0B1120" />
          <Text style={styles.loadingIcon}>🔐</Text>
          <Text style={styles.loadingTitle}>FaceAuth</Text>
          <Text style={styles.loadingSubtitle}>Initializing secure storage...</Text>
          <ActivityIndicator size="large" color="#00D9FF" style={styles.spinner} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0B1120" />
        <NavigationContainer theme={FaceAuthDarkTheme}>
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0B1120',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  loadingSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 24,
  },
  spinner: {
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#0B1120',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FF4444',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default App;
