/**
 * @file AppNavigator.tsx
 * @description Main stack navigator for the FaceAuth app.
 * Uses @react-navigation/native-stack for native performance.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '../screens/HomeScreen';
import { EnrollScreen } from '../screens/EnrollScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { SyncScreen } from '../screens/SyncScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

/** Parameter list for each screen in the main stack. */
export type RootStackParamList = {
  Home: undefined;
  Enroll: undefined;
  Authenticate: undefined;
  Sync: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Shared dark-themed header options applied to every screen. */
const DARK_HEADER_OPTIONS = {
  headerStyle: { backgroundColor: '#0B1120' },
  headerTintColor: '#FFFFFF',
  headerTitleStyle: {
    fontWeight: '600' as const,
    fontSize: 17,
  },
  headerShadowVisible: false,
};

/**
 * Root stack navigator for the FaceAuth application.
 *
 * Contains five screens:
 * - **Home** – main dashboard
 * - **Enroll** – face enrollment flow
 * - **Authenticate** – face authentication flow
 * - **Sync** – sync status & controls
 * - **Settings** – app configuration
 */
export const AppNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        ...DARK_HEADER_OPTIONS,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#0B1120' },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Enroll"
        component={EnrollScreen}
        options={{ title: 'Enroll New User' }}
      />
      <Stack.Screen
        name="Authenticate"
        component={AuthScreen}
        options={{ title: 'Authenticate' }}
      />
      <Stack.Screen
        name="Sync"
        component={SyncScreen}
        options={{ title: 'Sync Center' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Stack.Navigator>
  );
};
