import { API_URL } from '../constants/Config';
import { getLocalDateString } from './date';
import { appendDevLog } from './devLog';
import { useStore } from '../store/useStore';

export const getSlotId = (date: Date) => {
    const day = getLocalDateString(date);
    const hour = date.getHours();
    // Updated to 1-hour slots as per user request
    return `${day}-Slot${hour}`;
};

export const moodToLabel = (mood?: string): string | null => {
    if (!mood) return null;
    switch (mood) {
        case 'positive': return 'Positive';
        case 'calm': return 'Calm';
        case 'stressed': return 'Stressed';
        case 'negative': return 'Negative';
        default: return null;
    }
};

let isEvaluating = false;

/**
 * Evaluates pending slots and generates clips.
 * @param includeCurrent If true, it will also process the currently active slot (manual trigger).
 */
export const evaluateRecentClips = async (includeCurrent: boolean = false) => {
    if (isEvaluating) {
        console.log(`[Clip Eval] Skipped. Already evaluating.`);
        return;
    }
    isEvaluating = true;
    try {
        const now = new Date();
    const currentSlotId = getSlotId(now);
    const { processedSlots, events, addClip, updateClip, markSlotProcessed } = useStore.getState();

    // 1. Group events by their Slots
    const slotsMap: Record<string, typeof events> = {};
    events.forEach(e => {
        const ts = e.timestamp || parseInt(e.id, 10);
        if (isNaN(ts)) return;
        const slotId = getSlotId(new Date(ts));
        if (!slotsMap[slotId]) slotsMap[slotId] = [];
        slotsMap[slotId].push(e);
    });

    // 2. Find slots that are COMPLETED (not current) and NOT PROCESSED
    // If includeCurrent is true, we allow the current slot to be processed.
    const pendingSlots = Object.keys(slotsMap).filter(slotId =>
        (includeCurrent || slotId !== currentSlotId) && !processedSlots.includes(slotId)
    );

    if (pendingSlots.length === 0) {
        console.log(`[Clip Eval] No pending slots to process.`);
        void appendDevLog('clip', 'evaluate_skip', {
            includeCurrent,
            reason: 'no_pending_slots',
        });
        return;
    }

    console.log(`[Clip Eval] Pending Slots to process: ${pendingSlots.length}`, pendingSlots);
    void appendDevLog('clip', 'evaluate_start', {
        includeCurrent,
        pendingSlots,
        pendingCount: pendingSlots.length,
    });

    for (const slotId of pendingSlots) {
        const slotEvents = slotsMap[slotId];
        if (slotEvents.length === 0) {
            markSlotProcessed(slotId);
            continue;
        }

        console.log(`[Clip Eval] Processing Slot: ${slotId} with ${slotEvents.length} events...`);
        void appendDevLog('clip', 'slot_processing', {
            slotId,
            eventCount: slotEvents.length,
        });
        const summary = slotEvents.map(e => {
            let line = `[${e.time}] ${e.title}`;
            if (e.duration && e.duration > 0) {
                line += ` (Duration: ${Math.round(e.duration)}m)`;
            }
            if (e.weather && e.weather !== 'Unknown') {
                line += ` (Weather: ${e.weather}, ${e.temperature})`;
            }
            const moodLabel = moodToLabel(e.mood);
            if (moodLabel) {
                line += ` (Mood: ${moodLabel})`;
            }
            return line;
        }).join("; ");

        // Get the most recent clip for context
        const lastClip = useStore.getState().clips.length > 0 ? useStore.getState().clips[0] : null;

        try {
            void appendDevLog('api', 'generate_clip_request', {
                slotId,
                summary,
                previousClip: lastClip?.text || null,
            });
            const response = await fetch(`${API_URL}/generate_clip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: useStore.getState().userName,
                    events_summary: summary,
                    previous_clip: lastClip?.text
                })
            });

            if (response.ok) {
                const data = await response.json();
                void appendDevLog('api', 'generate_clip_response', {
                    slotId,
                    ok: true,
                    clipCount: Array.isArray(data?.clips) ? data.clips.length : 0,
                    data,
                });
                
                if (data.clips && Array.isArray(data.clips) && data.clips.length > 0) {
                    const existingClips = useStore.getState().clips
                        .filter(c => c.slotId === slotId)
                        .sort((a,b) => a.createdAt - b.createdAt);

                    data.clips.forEach((clip: any, index: number) => {
                        const existingClip = existingClips[index];

                        if (existingClip) {
                            console.log(`[Clip Eval] Updating existing clip[${index}] for slot: ${slotId}`);
                            updateClip(existingClip.id, clip.text, clip.title || existingClip.title);
                        } else if (index === 0 && clip.merge_with_previous && lastClip && lastClip.slotId !== slotId) {
                            console.log(`[Clip Eval] Merging with previous clip: ${lastClip.id}`);
                            updateClip(lastClip.id, clip.text, clip.title);
                        } else {
                            addClip({
                                id: `${Date.now()}-${index}`,
                                title: clip.title || "New Activity",
                                text: clip.text,
                                slotId: slotId,
                                createdAt: Date.now()
                            });
                        }
                    });

                    // Cleanup any extra clones if the LLM outputted fewer clips than previously existed
                    for (let i = data.clips.length; i < existingClips.length; i++) {
                        useStore.getState().deleteClip(existingClips[i].id);
                    }
                }
                // Only mark as processed if the API call was successful
                // AND it's not the currently active slot (so it can be re-evaluated as more events happen)
                if (slotId !== currentSlotId) {
                    markSlotProcessed(slotId);
                }
            } else {
                const errText = await response.text();
                void appendDevLog('api', 'generate_clip_response', {
                    slotId,
                    ok: false,
                    status: response.status,
                    errorText: errText,
                });
                console.error(`[Clip Eval] Server error for ${slotId}:`, response.status, errText);
            }
        } catch (err) {
            void appendDevLog('api', 'generate_clip_exception', {
                slotId,
                error: err instanceof Error ? err.message : String(err),
            });
            console.error(`[Clip Eval] Fetch failed for ${slotId}:`, err);
        }
    }
    } finally {
        isEvaluating = false;
    }
};
