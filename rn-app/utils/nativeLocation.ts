import { NativeModules, Platform } from 'react-native';

const { NativeLocationModule } = NativeModules;

/**
 * Location provider that uses Android's native LocationManager
 * instead of Google Play Services. Falls back to expo-location on iOS.
 *
 * This is needed for devices without Google Play Services
 * (e.g. Redmi 14C in mainland China).
 */

interface LocationCoords {
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  speed: number;
  heading: number;
}

interface LocationResult {
  coords: LocationCoords;
  timestamp: number;
  provider?: string;
}

interface ProviderInfo {
  gpsEnabled: boolean;
  networkEnabled: boolean;
  passiveEnabled: boolean;
  allProviders: string[];
}

/**
 * Get current position using Android system LocationManager.
 * On iOS, this will throw - use expo-location directly on iOS.
 */
export async function getCurrentPositionNative(): Promise<LocationResult> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeLocationModule is only available on Android');
  }

  if (!NativeLocationModule) {
    throw new Error(
      'NativeLocationModule is not available. Make sure the native module is properly linked.'
    );
  }

  return await NativeLocationModule.getCurrentPosition();
}

/**
 * Check if location services are enabled using native LocationManager.
 */
export async function isLocationEnabledNative(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeLocationModule is only available on Android');
  }

  if (!NativeLocationModule) {
    return false;
  }

  return await NativeLocationModule.isLocationEnabled();
}

/**
 * Get provider information for debugging.
 */
export async function getProviderInfoNative(): Promise<ProviderInfo> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeLocationModule is only available on Android');
  }

  if (!NativeLocationModule) {
    throw new Error('NativeLocationModule is not available');
  }

  return await NativeLocationModule.getProviderInfo();
}
