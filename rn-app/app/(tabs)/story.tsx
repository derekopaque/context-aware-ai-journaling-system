import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../store/useStore';
import { API_URL } from '../../constants/Config';
import { getLocalDateString } from '../../utils/date';



type StyleType = 'Reflective' | 'Objective' | 'Emotional';
type MoodType = 'positive' | 'calm' | 'stressed' | 'negative';

const MOOD_COLORS: Record<MoodType, string> = {
    positive: '#FFD700',
    calm: '#A2D149',
    stressed: '#FFA500',
    negative: '#85929E',
};

const MOOD_LABELS: Record<MoodType, string> = {
    positive: 'Positive',
    calm: 'Calm',
    stressed: 'Stressed',
    negative: 'Negative',
};

export default function StoryLayer() {
  const {
    clips,
    events,
    stories,
    currentStoryDraft,
    isGeneratingStory,
    setStoryDraft,
    updateStoryDraftText,
    addStory,
    deleteStory,
    setGeneratingStory
  } = useStore();

  const [selectedStyle, setSelectedStyle] = useState<StyleType>('Reflective');
  const [showStylePicker, setShowStylePicker] = useState(false);

  const handleRegenerate = async (style: StyleType) => {
    const today = getLocalDateString();
    // Get all clips from today and sort them chronologically (Morning to Evening)
    const todayClips = clips
      .filter(c => c.slotId.startsWith(today))
      .sort((a, b) => a.createdAt - b.createdAt);
  
    if (todayClips.length === 0) {
      Alert.alert("No Clips", "No clips found for today to generate a story.");
      return;
    }
  
    const clipsText = todayClips.map(c => c.text).join("\n\n");
    const eventSummaries = events
      .filter(e => getLocalDateString(new Date(e.timestamp)) === today)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(e => {
        const parts = [`[${e.time}] ${e.title}`];
        if (e.duration && e.duration > 0) parts.push(`Duration: ${Math.round(e.duration)}m`);
        if (e.weather && e.weather !== 'Unknown') parts.push(`Weather: ${e.weather}, ${e.temperature}`);
        if (e.mood) parts.push(`Mood: ${e.mood}`);
        if (e.additional_info) parts.push(`Context: ${e.additional_info}`);
        return parts.join(' | ');
      })
      .join("\n");
    setGeneratingStory(true);
    setShowStylePicker(false); // Hide picker once confirmed

    try {
      const response = await fetch(`${API_URL}/generate_story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: useStore.getState().userName,
          clips_text: clipsText,
          event_summaries: eventSummaries,
          style
        })
      });

      if (response.ok) {
        const data = await response.json();
        setStoryDraft({
          text: data.story_text,
          style: style,
          date: today,
          mood: data.mood ?? undefined
        });
        setSelectedStyle(style);
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to regenerate story.");
    } finally {
      setGeneratingStory(false);
    }
  };

  const handleSave = () => {
    if (!currentStoryDraft) return;
    addStory({
      id: Date.now().toString(),
      text: currentStoryDraft.text,
      date: currentStoryDraft.date,
      style: currentStoryDraft.style,
      mood: currentStoryDraft.mood,
      createdAt: Date.now()
    });
    Alert.alert("Saved", "Your story has been saved to your journal.");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>STORY</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Draft Section */}
        {currentStoryDraft ? (
          <View style={styles.draftCard}>
            <View style={styles.cardHeader}>
              <View style={styles.draftBadge}><Text style={styles.draftBadgeText}>DRAFT</Text></View>
            </View>

            {/* Mood Selector Row */}
            <View style={styles.moodSelectorRow}>
              {(['positive', 'calm', 'stressed', 'negative'] as MoodType[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setStoryDraft({ ...currentStoryDraft, mood: m })}
                  style={[
                    styles.moodChip,
                    currentStoryDraft.mood === m && { backgroundColor: MOOD_COLORS[m], borderColor: MOOD_COLORS[m] }
                  ]}
                >
                  <Text style={[
                    styles.moodChipText,
                    currentStoryDraft.mood === m && { color: m === 'negative' ? '#fff' : '#000' }
                  ]}>
                    {MOOD_LABELS[m]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.storyInput}
              multiline
              value={currentStoryDraft.text}
              onChangeText={updateStoryDraftText}
              scrollEnabled={false}
            />

            {!showStylePicker ? (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.outlineBtn}
                  onPress={() => setShowStylePicker(true)}
                  disabled={isGeneratingStory}
                >
                  <Ionicons name="refresh-outline" size={18} color="#000" />
                  <Text style={styles.outlineBtnText}>REGENERATE</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.solidBtn}
                  onPress={handleSave}
                >
                  <Ionicons name="bookmark-outline" size={18} color="#fff" />
                  <Text style={styles.solidBtnText}>SAVE STORY</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.pickerSection}>
                <Text style={styles.pickerLabel}>Choose Style:</Text>
                <View style={styles.styleRow}>
                  {(['Reflective', 'Objective', 'Emotional'] as StyleType[]).map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setSelectedStyle(s)}
                      style={[styles.styleChip, selectedStyle === s && styles.styleChipActive]}
                    >
                      <Text style={[styles.styleChipText, selectedStyle === s && styles.styleChipTextActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.pickerActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowStylePicker(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={() => handleRegenerate(selectedStyle)}
                    disabled={isGeneratingStory}
                  >
                    <Text style={styles.confirmText}>{isGeneratingStory ? "Applying..." : "Confirm"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.noDraftCard}>
            <Ionicons name="create-outline" size={40} color="#ccc" />
            <Text style={styles.noDraftText}>Generate today&apos;s story from the Interpretation tab.</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E9EEF0' },
  header: { paddingTop: 60, paddingBottom: 20, alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 2, color: '#000' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 60 },

  draftCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  dateText: { fontSize: 13, fontWeight: '700', color: '#B0B0B0', textTransform: 'uppercase' },
  draftBadge: { backgroundColor: '#FFEE00', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  draftBadgeText: { fontSize: 10, fontWeight: '900', color: '#000' },
  moodText: { fontSize: 11, fontWeight: '800', marginTop: 2 },

  storyInput: {
    fontSize: 17,
    lineHeight: 26,
    color: '#1a1a1a',
    backgroundColor: '#F9FAFB',
    padding: 15,
    borderRadius: 16,
    minHeight: 150,
    textAlignVertical: 'top'
  },

  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  styleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#E0E0E0'
  },
  styleChipActive: { backgroundColor: '#000', borderColor: '#000' },
  styleChipText: { fontSize: 12, fontWeight: '600', color: '#666' },
  styleChipTextActive: { color: '#fff' },

  actionRow: { flexDirection: 'row', gap: 12, marginTop: 25 },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#000'
  },
  outlineBtnText: { color: '#000', fontWeight: '800', marginLeft: 8, fontSize: 13 },
  solidBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#000'
  },
  solidBtnText: { color: '#fff', fontWeight: '800', marginLeft: 8, fontSize: 13, letterSpacing: 1 },

  moodSelectorRow: { flexDirection: 'row', gap: 6, marginBottom: 15 },
  moodChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#fff'
  },
  moodChipText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },

  pickerSection: { marginTop: 20, backgroundColor: '#F9FAFB', padding: 15, borderRadius: 16 },
  pickerLabel: { fontSize: 12, fontWeight: '700', color: '#666', marginBottom: 10 },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 15, marginTop: 15 },
  confirmBtn: { backgroundColor: '#000', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelBtn: { paddingVertical: 8 },
  cancelText: { color: '#666', fontWeight: '600', fontSize: 14 },

  noDraftCard: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#fff',
    borderStyle: 'dashed'
  },
  noDraftText: { marginTop: 15, color: '#999', textAlign: 'center', lineHeight: 22 },

  historySection: { marginTop: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#666', letterSpacing: 1, marginBottom: 15 },
  savedCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2
  },
  savedDate: { fontSize: 12, fontWeight: '700', color: '#B0B0B0', marginBottom: 10 },
  savedText: { fontSize: 15, color: '#444', lineHeight: 22 },
  styleTag: { fontSize: 10, color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', marginTop: 12 },

  // Unused or merged styles safely kept below 
  storyCard: { backgroundColor: '#fff', borderRadius: 25, padding: 32, minHeight: 400, marginBottom: 30 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  mainTitle: { fontSize: 28, fontWeight: '800', color: '#1a1a1a', marginTop: 10 },
  titleDivider: { height: 4, backgroundColor: '#000', width: 35, marginTop: 15, marginBottom: 30 }
});
