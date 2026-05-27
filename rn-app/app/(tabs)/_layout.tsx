import { MaterialIcons } from '@expo/vector-icons';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import { Tabs } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { API_URL } from '../../constants/Config';
import { getLocalDateString } from '../../utils/date';
import { getCurrentPositionNative, getProviderInfoNative } from '../../utils/nativeLocation';
import { evaluateRecentClips } from '../../utils/clipLogic';
import { appendDevLog } from '../../utils/devLog';

import AsyncStorage from '@react-native-async-storage/async-storage';

// 1. Define the background task name
const BACKGROUND_LOCATION_TASK = 'background-location-task';

import { useStore } from '../../store/useStore';

// ──────────────────────────────────────────────────────────
// Concurrency lock: prevents overlapping checkAndFilterLocation
// ──────────────────────────────────────────────────────────
let isFilterRunning = false;

// ──────────────────────────────────────────────────────────
// Time-gate keys stored in AsyncStorage
// ──────────────────────────────────────────────────────────
const LAST_RUN_AT_KEY = 'last_run_at';              // throttle key for background schedule
const LAST_CONTEXT_KEY = 'last_context';             // semantic context string
const LAST_CONTEXT_SEEN_AT_KEY = 'last_context_seen_at'; // confirms scene is still active

// Throttle intervals (in ms)
const DAY_MIN_INTERVAL_MS = 12 * 60 * 1000;   // 12 min (lenient for Android scheduling)
const NIGHT_MIN_INTERVAL_MS = 50 * 60 * 1000;  // 50 min

/**
 * Returns true if enough time has passed since last_run_at
 * according to time-of-day rules.
 * @param isForegroundTrigger If true, bypass time gate entirely (user opened app).
 */
const passesTimeGate = async (isForegroundTrigger: boolean): Promise<boolean> => {
  if (isForegroundTrigger) return true; // user-initiated, always pass

  const lastRunRaw = await AsyncStorage.getItem(LAST_RUN_AT_KEY);
  if (!lastRunRaw) return true; // never run before

  const elapsed = Date.now() - parseInt(lastRunRaw, 10);
  const hour = new Date().getHours();
  const isNight = hour >= 22 || hour < 6;
  const minInterval = isNight ? NIGHT_MIN_INTERVAL_MS : DAY_MIN_INTERVAL_MS;

  if (elapsed < minInterval) {
    console.log(
      `[TimeGate] Throttled. Elapsed=${Math.round(elapsed / 1000)}s, ` +
      `min=${Math.round(minInterval / 1000)}s, night=${isNight}`
    );
    return false;
  }
  return true;
};

// ──────────────────────────────────────────────────────────
// Frontend duplicate guard:
// Checks if the latest auto-detected event is semantically
// the same place as the one the backend wants to create.
// ──────────────────────────────────────────────────────────
const isDuplicateOfLatestEvent = (newContext: string, newTitle: string): boolean => {
  const { events } = useStore.getState();
  // Only consider auto events from today
  const todayStr = getLocalDateString(new Date());
  const todayAutoEvents = events
    .filter(e => !e.isManual && !e.isPhoto)
    .filter(e => {
      const d = new Date(e.timestamp);
      return getLocalDateString(d) === todayStr;
    })
    .sort((a, b) => b.timestamp - a.timestamp); // newest first

  if (todayAutoEvents.length === 0) return false;

  const latest = todayAutoEvents[0];

  // Guard 1: exact title match
  if (latest.title.trim().toLowerCase() === newTitle.trim().toLowerCase()) {
    console.log(`[DuplicateGuard] Blocked: title "${newTitle}" matches latest event "${latest.title}"`);
    return true;
  }

  // Guard 2: context substring match (e.g. same POI in address)
  const latestCtx = (latest.additional_info || '').replace(/^Auto-detected at\s*/i, '').trim().toLowerCase();
  const incomingCtx = newContext.trim().toLowerCase();
  if (latestCtx && incomingCtx && (
    latestCtx === incomingCtx ||
    latestCtx.includes(incomingCtx) ||
    incomingCtx.includes(latestCtx)
  )) {
    console.log(`[DuplicateGuard] Blocked: context overlap. Latest="${latestCtx}", Incoming="${incomingCtx}"`);
    return true;
  }

  return false;
};

// ──────────────────────────────────────────────────────────
// Core location check + semantic filter
// ──────────────────────────────────────────────────────────
const checkAndFilterLocation = async (isForegroundTrigger: boolean = false) => {
  const { isTrackingEnabled, setLocationDebug } = useStore.getState();
  if (!isTrackingEnabled) {
    setLocationDebug({
      step: 'tracking_disabled',
      message: 'Location check skipped because tracking is turned off.',
      lastRequestStatus: 'skipped',
      lastError: null,
    });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  // Concurrency lock
  if (isFilterRunning) {
    console.log('[Location] checkAndFilterLocation already running, skipping.');
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
  isFilterRunning = true;

  try {
    // ── Time gate (background only) ──
    const allowed = await passesTimeGate(isForegroundTrigger);
    if (!allowed) {
      void appendDevLog('location', 'throttled', { isForegroundTrigger });
      setLocationDebug({
        step: 'throttled',
        message: 'Skipped: minimum interval not reached.',
        lastRequestStatus: 'throttled',
        lastError: null,
      });
      // Return NewData for keep-alive even when throttled
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    setLocationDebug({
      step: 'locating',
      message: 'Requesting a fresh GPS fix from the device.',
      lastRequestStatus: 'pending',
      lastError: null,
    });
    const now = new Date();

    // ── Get GPS ──
    let location: {
      coords: {
        latitude: number; longitude: number;
        altitude: number | null; accuracy: number | null;
        speed: number | null; heading: number | null;
      };
      timestamp: number;
      provider?: string;
    };

    if (Platform.OS === 'android') {
      console.log("[Location] Using Android native LocationManager (system provider)...");
      try {
        const providerInfo = await getProviderInfoNative();
        console.log("[Location] Provider info:", JSON.stringify(providerInfo));
      } catch (infoErr) {
        console.warn("[Location] Could not get provider info:", infoErr);
      }
      location = await getCurrentPositionNative();
      console.log(`[Location] Native provider used: ${location.provider}`);
    } else {
      console.log("[Location] Using expo-location (iOS)...");
      location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    }

    console.log(`[Location Check] Captured at ${now.toLocaleString()}:`, location.coords);
    setLocationDebug({
      step: 'location_acquired',
      message: 'Location acquired. Preparing request to /filter_location.',
      coords: `${location.coords.latitude.toFixed(5)}, ${location.coords.longitude.toFixed(5)}`,
      lastRequestStatus: 'ready',
      lastError: null,
    });

    // ── Record last_run_at for throttle ──
    await AsyncStorage.setItem(LAST_RUN_AT_KEY, String(Date.now()));

    // ── Semantic Filtering ──
    const lastContext = await AsyncStorage.getItem(LAST_CONTEXT_KEY);
    const lastContextSeenAt = await AsyncStorage.getItem(LAST_CONTEXT_SEEN_AT_KEY);

    try {
      setLocationDebug({
        step: 'requesting_filter',
        message: 'Sending coordinates to /filter_location.',
        lastRequestStatus: 'pending',
        lastError: null,
      });

      const response = await fetch(`${API_URL}/filter_location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lng: location.coords.longitude,
          lat: location.coords.latitude,
          previous_context: lastContext,
          previous_timestamp: lastContextSeenAt ? parseInt(lastContextSeenAt, 10) : null,
          user_id: useStore.getState().userName,
        })
      });

      if (!response.ok) {
        console.warn(`[Location Check] Server returned ${response.status}.`);
        setLocationDebug({
          step: 'request_failed',
          message: `Backend responded with HTTP ${response.status}.`,
          lastRequestStatus: `http_${response.status}`,
          lastError: `Request to /filter_location failed with status ${response.status}.`,
        });
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }

      const data = await response.json();
      console.log(
        `[Location Check] Result: should_create=${data?.should_create}, ` +
        `title=${data?.new_title}, weather=${data?.weather}`
      );

      const contextToSave = String(data.full_context || '');

      if (data?.should_create) {
        const newTitle = data.new_title || "New Location";

        // ── Frontend duplicate guard ──
        if (isDuplicateOfLatestEvent(contextToSave, newTitle)) {
          console.log(`[Semantic Filter] Frontend blocked duplicate: "${newTitle}"`);
          void appendDevLog('location', 'frontend_duplicate_blocked', {
            newTitle,
            context: contextToSave,
          });

          // Still update seen_at so backend knows we are still here
          await AsyncStorage.setItem(LAST_CONTEXT_SEEN_AT_KEY, String(Date.now()));

          setLocationDebug({
            step: 'duplicate_blocked',
            message: `Frontend blocked duplicate event: ${newTitle}`,
            lastRequestStatus: 'duplicate_blocked',
            lastError: null,
          });

          // Update duration on the latest matching event
          const { events, updateEventDuration } = useStore.getState();
          const todayStr = getLocalDateString(new Date());
          const latestAuto = events
            .filter(e => !e.isManual && !e.isPhoto)
            .filter(e => getLocalDateString(new Date(e.timestamp)) === todayStr)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          if (latestAuto) {
            const duration = (Date.now() - latestAuto.timestamp) / (1000 * 60);
            updateEventDuration(latestAuto.id, Math.round(duration));
          }
        } else {
          // ── Genuinely new location ──
          console.log(`[Semantic Filter] NEW EVENT DETECTED: ${newTitle}`);

          await AsyncStorage.setItem(LAST_CONTEXT_KEY, contextToSave);
          await AsyncStorage.setItem(LAST_CONTEXT_SEEN_AT_KEY, String(Date.now()));

          const hours = now.getHours().toString().padStart(2, '0');
          const minutes = now.getMinutes().toString().padStart(2, '0');

          useStore.getState().addEvent({
            id: Date.now().toString(),
            time: `${hours}:${minutes}`,
            title: newTitle,
            isManual: false,
            additional_info: `Auto-detected at ${contextToSave}`,
            weather: data.weather,
            temperature: data.temperature,
            timestamp: Date.now()
          });

          void appendDevLog('location', 'event_created', {
            title: newTitle,
            context: contextToSave,
          });

          setLocationDebug({
            step: 'event_created',
            message: `Created location event: ${newTitle}`,
            lastRequestStatus: 'created',
            lastError: null,
          });
        }
      } else {
        // ── Same scene confirmed ──
        // CRITICAL: Always update last_context_seen_at so the backend
        // knows this scene is still actively confirmed, even though
        // we are not creating a new event. This prevents the LLM from
        // seeing a stale timestamp and misinterpreting a long gap.
        await AsyncStorage.setItem(LAST_CONTEXT_SEEN_AT_KEY, String(Date.now()));
        // Also refresh the context string in case formatting changed
        if (contextToSave) {
          await AsyncStorage.setItem(LAST_CONTEXT_KEY, contextToSave);
        }

        // Update duration on the latest auto event
        const { events, updateEventDuration } = useStore.getState();
        const todayStr = getLocalDateString(new Date());
        const latestAuto = events
          .filter(e => !e.isManual && !e.isPhoto)
          .filter(e => getLocalDateString(new Date(e.timestamp)) === todayStr)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        if (latestAuto) {
          const duration = (Date.now() - latestAuto.timestamp) / (1000 * 60);
          updateEventDuration(latestAuto.id, Math.round(duration));
        }

        console.log(`[Semantic Filter] Same scene confirmed. Duration updated.`);
        setLocationDebug({
          step: 'no_event_created',
          message: 'Same scene confirmed. Duration updated.',
          lastRequestStatus: 'no_event',
          lastError: null,
        });
      }
    } catch (apiErr) {
      console.error("[Location Check] API Call failed:", apiErr);
      setLocationDebug({
        step: 'request_exception',
        message: 'Failed while calling /filter_location.',
        lastRequestStatus: 'exception',
        lastError: apiErr instanceof Error ? apiErr.message : String(apiErr),
      });
    }

    // ── Clip evaluation ──
    await evaluateRecentClips();

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error("[Location Check] Failed:", error);
    setLocationDebug({
      step: 'location_error',
      message: 'The app could not get the current device location.',
      lastRequestStatus: 'not_sent',
      lastError: error instanceof Error ? error.message : String(error),
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  } finally {
    isFilterRunning = false;
  }
};

// Helper to auto-generate story for YESTERDAY if it's midnight/next day
const checkAndGenerateMidnightStory = async () => {
  const { stories, clips, addStory } = useStore.getState();
  const now = new Date();
  const yesterday = getLocalDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  // If a story for yesterday already exists, skip
  if (stories.find(s => s.date === yesterday)) return;

  // Get all clips from yesterday
  const yesterdayClips = clips.filter(c => c.slotId.startsWith(yesterday));
  if (yesterdayClips.length === 0) return;

  console.log(`[Midnight Auto] Generating story for ${yesterday}...`);
  const clipsText = yesterdayClips.map(c => c.text).join("\n\n");

  try {
    const response = await fetch(`${API_URL}/generate_story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clips_text: clipsText,
        style: "Classic",
        user_id: useStore.getState().userName,
      })
    });

    if (response.ok) {
      const data = await response.json();
      addStory({
        id: `auto-${yesterday}`,
        text: data.story_text,
        date: yesterday,
        style: "Classic",
        createdAt: Date.now()
      });
      console.log(`[Midnight Auto] Successfully saved story for ${yesterday}`);
    }
  } catch (err) {
    console.error("[Midnight Auto] Failed:", err);
  }
};

const runDailyMaintenance = async () => {
  const { clearOldData, lastCleanupDate, setLastCleanupDate } = useStore.getState();
  const now = new Date();
  const today = getLocalDateString(now);

  if (lastCleanupDate !== today) {
    console.log(`[Maintenance] NEW DAY DETECTED (${today}). Running daily tasks...`);
    await checkAndGenerateMidnightStory();
    clearOldData(today);
    setLastCleanupDate(today);
  }
};

// 2. Define the background task
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async () => {
  const { isTrackingEnabled } = useStore.getState();
  if (!isTrackingEnabled) {
    console.log('[Background] Tracking is disabled by user, skipping...');
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
  const result = await checkAndFilterLocation(false); // background = not foreground
  await checkAndGenerateMidnightStory();
  return result;
});

export default function TabLayout() {
  const { _hasHydrated, isTrackingEnabled, setLocationDebug } = useStore();

  // 3. Register background fetch AND run once on open
  useEffect(() => {
    if (!_hasHydrated) {
      console.log("[TabLayout] Waiting for hydration...");
      return;
    }

    const registerTask = async () => {
      try {
        if (!isTrackingEnabled) {
          setLocationDebug({
            step: 'tracking_disabled',
            message: 'Tracking is off, so background location is not registered.',
            lastRequestStatus: 'skipped',
            lastError: null,
          });
          const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
          if (isRegistered) {
            await BackgroundFetch.unregisterTaskAsync(BACKGROUND_LOCATION_TASK);
            console.log('[TabLayout] Background task UNREGISTERED (user disabled tracking)');
          }
          return;
        }

        console.log("[TabLayout] Hydrated. Requesting Foreground Permissions...");
        const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
        setLocationDebug({
          step: 'foreground_permission_checked',
          message: `Foreground permission status: ${foregroundStatus}`,
          foregroundPermission: foregroundStatus,
          lastError: null,
        });

        if (foregroundStatus === 'granted') {
          console.log("[TabLayout] Foreground granted. Running initial check (foreground trigger)...");
          // User opened the app → foreground trigger, bypass time gate
          await checkAndFilterLocation(true);

          await runDailyMaintenance();

          console.log("[TabLayout] Requesting Background Permissions...");
          const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
          setLocationDebug({
            step: 'background_permission_checked',
            message: `Background permission status: ${backgroundStatus}`,
            backgroundPermission: backgroundStatus,
            lastError: null,
          });

          if (backgroundStatus === 'granted') {
            await BackgroundFetch.registerTaskAsync(BACKGROUND_LOCATION_TASK, {
              minimumInterval: 15 * 60, // 15 minutes
              stopOnTerminate: false,
              startOnBoot: true,
            });
            console.log("[TabLayout] Background Task Registered Successfully");
            setLocationDebug({
              step: 'background_registered',
              message: 'Background location task registered successfully.',
              backgroundPermission: backgroundStatus,
              lastError: null,
            });
          } else {
            console.log("[TabLayout] Background permission not granted.");
            setLocationDebug({
              step: 'background_permission_denied',
              message: 'Background permission was not granted.',
              backgroundPermission: backgroundStatus,
              lastRequestStatus: 'foreground_only',
              lastError: null,
            });
          }
        } else {
          console.log("[TabLayout] Foreground location permission not granted");
          setLocationDebug({
            step: 'foreground_permission_denied',
            message: 'Foreground location permission was not granted.',
            foregroundPermission: foregroundStatus,
            lastRequestStatus: 'not_sent',
            lastError: null,
          });
        }
      } catch (err) {
        console.error("[TabLayout] Task registration failed:", err);
        setLocationDebug({
          step: 'registration_error',
          message: 'Task registration failed before location requests could complete.',
          lastRequestStatus: 'not_sent',
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    };

    registerTask();
  }, [_hasHydrated, isTrackingEnabled, setLocationDebug]);

  // Foreground periodic check: respect time gate, no more aggressive 60s polling
  useEffect(() => {
    if (!_hasHydrated) return;

    // The time gate inside checkAndFilterLocation enforces the real 12/50 min minimum
    console.log("[TabLayout] Starting foreground periodic check (5min)...");
    const interval = setInterval(async () => {
      const { isTrackingEnabled } = useStore.getState();
      if (isTrackingEnabled) {
        console.log("[TabLayout] Foreground interval: checking location...");
        await checkAndFilterLocation(false); // periodic = not foreground trigger
      } else {
        console.log("[TabLayout] Foreground interval: tracking disabled, running clips only...");
        await evaluateRecentClips();
      }
      await runDailyMaintenance();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [_hasHydrated]);

  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: '#000',
      headerShown: false,
    }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Event',
          tabBarIcon: ({ color }) => <MaterialIcons name="sensors" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="interpretation"
        options={{
          title: 'Interpretation',
          tabBarIcon: ({ color }) => <MaterialIcons name="auto-awesome" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="story"
        options={{
          title: 'Story',
          tabBarIcon: ({ color }) => <MaterialIcons name="auto-stories" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="archive"
        options={{
          title: 'Archive',
          tabBarIcon: ({ color }) => <MaterialIcons name="history" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <MaterialIcons name="person" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
