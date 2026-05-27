import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { appendDevLog } from '../utils/devLog';

export interface EventItem {
    id: string;
    time: string;
    title: string;
    isManual: boolean;
    isPhoto?: boolean;
    additional_info?: string;
    weather?: string;
    temperature?: string;
    mood?: MoodType;
    mood_source?: 'prompt' | 'manual';
    mood_answered_at?: number;
    mood_prompted_at?: number;
    mood_prompt_reason?: string;
    timestamp: number; // For slot calculation
    duration?: number; // In minutes
    endTime?: number;  // End timestamp
}

export interface ClipItem {
    id: string;
    text: string;
    title?: string;
    slotId: string; // e.g., "2026-02-01-Slot1"
    createdAt: number;
}

export type MoodType = 'positive' | 'calm' | 'stressed' | 'negative';

export interface StoryItem {
    id: string;
    text: string;
    date: string; // e.g., "2026-02-01"
    style: string;
    mood?: MoodType; // Emotional tone: positive, calm, stressed, negative
    createdAt: number;
}

export interface LocationDebugInfo {
    step: string;
    message: string;
    updatedAt: number | null;
    foregroundPermission: string;
    backgroundPermission: string;
    coords: string | null;
    lastRequestStatus: string;
    lastError: string | null;
}

interface StoreState {
    events: EventItem[];
    clips: ClipItem[];
    stories: StoryItem[]; // Saved stories
    currentStoryDraft: { text: string; style: string; date: string; mood?: MoodType } | null;
    isGeneratingStory: boolean;
    processedSlots: string[];
    lastCleanupDate: string;
    // User Profile
    userName: string;
    avatarUri: string | null;
    joinedDate: string; // ISO date string of first launch
    isTrackingEnabled: boolean;
    locationDebug: LocationDebugInfo;
    addEvent: (event: EventItem) => void;
    setEventMood: (
        id: string,
        mood: MoodType,
        metadata?: {
            source?: 'prompt' | 'manual';
            promptedAt?: number;
            answeredAt?: number;
            reason?: string;
        }
    ) => void;
    renameEvent: (id: string, newTitle: string) => void;
    deleteEvent: (id: string) => void;
    addClip: (clip: ClipItem) => void;
    updateClip: (id: string, text: string, title?: string) => void;
    deleteClip: (id: string) => void;
    markSlotProcessed: (slotId: string) => void;
    resetProcessedSlot: (slotId: string) => void;
    clearOldData: (todayStr: string) => void;
    setLastCleanupDate: (date: string) => void;
    // Story Actions
    setStoryDraft: (draft: { text: string; style: string; date: string; mood?: MoodType } | null) => void;
    updateStoryDraftText: (text: string) => void;
    addStory: (story: StoryItem) => void;
    deleteStory: (id: string) => void;
    setGeneratingStory: (val: boolean) => void;
    // User Profile Actions
    setUserName: (name: string) => void;
    setAvatarUri: (uri: string | null) => void;
    setTrackingEnabled: (val: boolean) => void;
    setLocationDebug: (patch: Partial<LocationDebugInfo>) => void;
    resetLocationDebug: () => void;
    updateEventDuration: (id: string, duration: number) => void;
    updateEventAutoDetails: (
        id: string,
        patch: Partial<Pick<EventItem, 'title' | 'additional_info' | 'weather' | 'temperature' | 'endTime'>>
    ) => void;
    _hasHydrated: boolean;
    setHasHydrated: (val: boolean) => void;
}

const initialLocationDebug: LocationDebugInfo = {
    step: 'idle',
    message: 'Location diagnostics have not run yet.',
    updatedAt: null,
    foregroundPermission: 'unknown',
    backgroundPermission: 'unknown',
    coords: null,
    lastRequestStatus: 'idle',
    lastError: null,
};

export const useStore = create<StoreState>()(
    persist(
        (set) => ({
            events: [],
            clips: [],
            stories: [],
            currentStoryDraft: null,
            isGeneratingStory: false,
            processedSlots: [],
            lastCleanupDate: '',
            // User Profile defaults
            userName: 'User',
            avatarUri: null,
            joinedDate: new Date().toISOString(),
            isTrackingEnabled: true,
            locationDebug: initialLocationDebug,
            addEvent: (event) => {
                void appendDevLog('event', 'add', {
                    id: event.id,
                    title: event.title,
                    timestamp: event.timestamp,
                    isManual: event.isManual,
                });
                set((state) => ({
                    events: [...state.events, event]
                }));
            },
            setEventMood: (id, mood, metadata) => set((state) => ({
                events: state.events.map((e) => (
                    e.id === id
                        ? {
                            ...e,
                            mood,
                            mood_source: metadata?.source || 'manual',
                            mood_prompted_at: metadata?.promptedAt ?? e.mood_prompted_at,
                            mood_answered_at: metadata?.answeredAt ?? Date.now(),
                            mood_prompt_reason: metadata?.reason ?? e.mood_prompt_reason,
                        }
                        : e
                ))
            })),
            renameEvent: (id, newTitle) => set((state) => ({
                events: state.events.map((e) => e.id === id ? { ...e, title: newTitle } : e)
            })),
            deleteEvent: (id) => {
                void appendDevLog('event', 'delete', { id });
                set((state) => ({
                    events: state.events.filter((e) => e.id !== id)
                }));
            },
            addClip: (clip) => {
                void appendDevLog('clip', 'add', {
                    id: clip.id,
                    slotId: clip.slotId,
                    title: clip.title || null,
                });
                set((state) => ({
                    clips: [clip, ...state.clips]
                }));
            },
            updateClip: (id, text, title) => {
                void appendDevLog('clip', 'update', {
                    id,
                    title: title || null,
                });
                set((state) => ({
                    clips: state.clips.map((c) => c.id === id ? { ...c, text, title: title || c.title } : c)
                }));
            },
            deleteClip: (id) => set((state) => {
                const clipToDelete = state.clips.find(c => c.id === id);
                return {
                    clips: state.clips.filter((c) => c.id !== id),
                    // Removed processedSlots logic so that deleting a clip does NOT cause
                    // the AI to instantly regenerate it next time the process runs.
                    processedSlots: state.processedSlots
                };
            }),
            markSlotProcessed: (slotId) => set((state) => ({
                processedSlots: [...state.processedSlots, slotId]
            })),
            resetProcessedSlot: (slotId) => set((state) => ({
                processedSlots: state.processedSlots.filter(s => s !== slotId)
            })),
            clearOldData: (todayStr) => set((state) => ({
                events: state.events.filter(e => {
                    // Fallback for missing timestamps (old events might not have it)
                    const ts = e.timestamp || parseInt(e.id, 10);
                    if (isNaN(ts)) return false; // Safety check
                    const d = new Date(ts);
                    const y = d.getFullYear();
                    const m = (d.getMonth() + 1).toString().padStart(2, '0');
                    const day = d.getDate().toString().padStart(2, '0');
                    const eventDate = `${y}-${m}-${day}`;
                    return eventDate === todayStr;
                }),
                clips: state.clips.filter(c => c.slotId.startsWith(todayStr)),
                processedSlots: state.processedSlots.filter(s => s.startsWith(todayStr))
            })),
            setLastCleanupDate: (date) => set({ lastCleanupDate: date }),
            setStoryDraft: (draft) => set({ currentStoryDraft: draft }),
            updateStoryDraftText: (text) => set((state) => ({
                currentStoryDraft: state.currentStoryDraft ? { ...state.currentStoryDraft, text } : null
            })),
            addStory: (story) => {
                void appendDevLog('story', 'add', {
                    id: story.id,
                    date: story.date,
                    style: story.style,
                    mood: story.mood || null,
                });
                set((state) => ({
                    stories: [story, ...state.stories],
                    currentStoryDraft: null // Clear draft on save
                }));
            },
            deleteStory: (id) => set((state) => ({
                stories: state.stories.filter((s) => s.id !== id)
            })),
            setGeneratingStory: (val) => set({ isGeneratingStory: val }),
            // User Profile Actions
            setUserName: (name) => set({ userName: name }),
            setAvatarUri: (uri) => set({ avatarUri: uri }),
            setTrackingEnabled: (val) => set({ isTrackingEnabled: val }),
            setLocationDebug: (patch) => set((state) => ({
                locationDebug: {
                    ...state.locationDebug,
                    ...patch,
                    updatedAt: Date.now(),
                }
            })),
            resetLocationDebug: () => set({ locationDebug: initialLocationDebug }),
            updateEventDuration: (id, duration) => {
                void appendDevLog('event', 'duration_update', { id, duration });
                set((state) => ({
                    events: state.events.map((e) => (
                        e.id === id ? { ...e, duration, endTime: Date.now() } : e
                    ))
                }));
            },
            updateEventAutoDetails: (id, patch) => {
                void appendDevLog('event', 'auto_details_update', { id, patch });
                set((state) => ({
                    events: state.events.map((e) => (
                        e.id === id ? { ...e, ...patch } : e
                    ))
                }));
            },
            _hasHydrated: false,
            setHasHydrated: (val) => set({ _hasHydrated: val }),
        }),
        {
            name: 'diary-storage-v3', // Version 3
            storage: createJSONStorage(() => AsyncStorage),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);
