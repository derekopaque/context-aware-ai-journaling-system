const { withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NATIVE_LOCATION_PACKAGE_KT = `package com.anonymous.rnapp

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class NativeLocationPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(NativeLocationModule(reactContext))
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

const NATIVE_LOCATION_MODULE_KT = `package com.anonymous.rnapp

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class NativeLocationModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "NativeLocationModule"

  @ReactMethod
  fun getCurrentPosition(promise: Promise) {
    if (!hasForegroundLocationPermission()) {
      promise.reject("PERMISSION_DENIED", "Location permission is not granted.")
      return
    }

    val locationManager =
      reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (locationManager == null) {
      promise.reject("LOCATION_MANAGER_UNAVAILABLE", "LocationManager is unavailable.")
      return
    }

    val providers = preferredProviders(locationManager)
    if (providers.isEmpty()) {
      promise.reject("PROVIDER_DISABLED", "No enabled location provider (gps/network).")
      return
    }

    val lastKnown = getBestLastKnownLocation(locationManager, providers)
    if (lastKnown != null) {
      promise.resolve(toLocationMap(lastKnown))
      return
    }

    val provider = providers.first()
    requestSingleLocationUpdate(locationManager, provider, promise)
  }

  @ReactMethod
  fun isLocationEnabled(promise: Promise) {
    val locationManager =
      reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (locationManager == null) {
      promise.resolve(false)
      return
    }
    val enabled =
      locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
      locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    promise.resolve(enabled)
  }

  @ReactMethod
  fun getProviderInfo(promise: Promise) {
    val locationManager =
      reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (locationManager == null) {
      promise.reject("LOCATION_MANAGER_UNAVAILABLE", "LocationManager is unavailable.")
      return
    }

    val map = Arguments.createMap()
    map.putBoolean("gpsEnabled", locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
    map.putBoolean("networkEnabled", locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
    map.putBoolean("passiveEnabled", locationManager.isProviderEnabled(LocationManager.PASSIVE_PROVIDER))
    val providers = Arguments.createArray()
    locationManager.allProviders.forEach { providers.pushString(it) }
    map.putArray("allProviders", providers)
    promise.resolve(map)
  }

  private fun preferredProviders(locationManager: LocationManager): List<String> {
    val providers = mutableListOf<String>()
    if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
      providers.add(LocationManager.GPS_PROVIDER)
    }
    if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
      providers.add(LocationManager.NETWORK_PROVIDER)
    }
    return providers
  }

  private fun hasForegroundLocationPermission(): Boolean {
    val fine = ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
    val coarse = ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.ACCESS_COARSE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
    return fine || coarse
  }

  private fun getBestLastKnownLocation(
    locationManager: LocationManager,
    providers: List<String>
  ): Location? {
    return providers
      .mapNotNull { provider ->
        try {
          locationManager.getLastKnownLocation(provider)
        } catch (_: SecurityException) {
          null
        }
      }
      .maxByOrNull { it.time }
  }

  private fun requestSingleLocationUpdate(
    locationManager: LocationManager,
    provider: String,
    promise: Promise
  ) {
    var resolved = false
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        if (resolved) return
        resolved = true
        promise.resolve(toLocationMap(location))
        runCatching { locationManager.removeUpdates(this) }
      }

      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) = Unit
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        locationManager.getCurrentLocation(provider, null, reactContext.mainExecutor) { location ->
          if (resolved) return@getCurrentLocation
          resolved = true
          if (location == null) {
            promise.reject("LOCATION_UNAVAILABLE", "Current location is unavailable.")
          } else {
            promise.resolve(toLocationMap(location))
          }
        }
      } else {
        locationManager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
      }
    } catch (se: SecurityException) {
      promise.reject("PERMISSION_DENIED", "Location permission is not granted.", se)
    } catch (e: Exception) {
      promise.reject("LOCATION_ERROR", "Failed to get location: " + e.message, e)
    }
  }

  private fun toLocationMap(location: Location): WritableMap {
    val coords = Arguments.createMap().apply {
      putDouble("latitude", location.latitude)
      putDouble("longitude", location.longitude)
      putDouble("altitude", location.altitude)
      putDouble("accuracy", location.accuracy.toDouble())
      putDouble("speed", location.speed.toDouble())
      putDouble("heading", location.bearing.toDouble())
    }

    return Arguments.createMap().apply {
      putMap("coords", coords)
      putDouble("timestamp", location.time.toDouble())
      putString("provider", location.provider)
    }
  }
}
`;

/**
 * Expo Config Plugin to register the NativeLocationModule
 */
const withNativeLocation = (config) => {
  // Always inject registration - we will create the files in withDangerousMod
  // 1. Inject registration into MainApplication.kt
  config = withMainApplication(config, (config) => {
    let content = config.modResults.contents;

    // Match common variants of the package list apply block
    const applyBlockRegex = /PackageList\(this\)\.packages\.apply\s*\{/g;
    
    // 1. Add Import
    if (!content.includes('import com.anonymous.rnapp.NativeLocationPackage')) {
      content = content.replace(
        /import com\.facebook\.react\.ReactPackage/,
        'import com.facebook.react.ReactPackage\nimport com.anonymous.rnapp.NativeLocationPackage'
      );
    }

    // 2. Add Registration
    if (!content.includes('add(NativeLocationPackage())')) {
      if (applyBlockRegex.test(content)) {
        console.log('[NativeLocationPlugin] Found apply block, injecting package...');
        content = content.replace(
          applyBlockRegex,
          'PackageList(this).packages.apply {\n              add(NativeLocationPackage())'
        );
      } else {
        // Fallback: If apply block is structured differently, try to find getPackages
        console.warn('[NativeLocationPlugin] Could not find exact apply block, trying fallback...');
        content = content.replace(
          /override fun getPackages\(\): List<ReactPackage> =/,
          'override fun getPackages(): List<ReactPackage> =\n            PackageList(this).packages.apply {\n              add(NativeLocationPackage())\n            }.let { it } //'
        );
      }
    }
    config.modResults.contents = content;
    return config;
  });

  // 2. Ensure the Kotlin files exist in the build directory
  // In some Expo versions, prebuild might clean the directory.
  // This hook ensures files are copied from our source locations.
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const packagePath = 'com/anonymous/rnapp';
      const androidSrcRoot = path.join(
        projectRoot,
        'android/app/src/main/java',
        packagePath
      );

      // Make sure directory exists
      if (!fs.existsSync(androidSrcRoot)) {
        fs.mkdirSync(androidSrcRoot, { recursive: true });
      }

      const packageFile = path.join(androidSrcRoot, 'NativeLocationPackage.kt');
      const moduleFile = path.join(androidSrcRoot, 'NativeLocationModule.kt');

      if (!fs.existsSync(packageFile)) {
        fs.writeFileSync(packageFile, NATIVE_LOCATION_PACKAGE_KT, 'utf8');
      }
      if (!fs.existsSync(moduleFile)) {
        fs.writeFileSync(moduleFile, NATIVE_LOCATION_MODULE_KT, 'utf8');
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withNativeLocation;
