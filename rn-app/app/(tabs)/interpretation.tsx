import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View, TextInput } from 'react-native';

import { useStore } from '../../store/useStore';
import { API_URL } from '../../constants/Config';
import { getLocalDateString } from '../../utils/date';
import { evaluateRecentClips } from '../../utils/clipLogic';
import { useState } from 'react';



export default function InterpretationLayer() {
  const {
    clips,
    events,
    updateClip,
    deleteClip,
    isGeneratingStory,
    setGeneratingStory,
    setStoryDraft
  } = useStore();
  const sortedClips = [...clips].sort((a, b) => a.createdAt - b.createdAt);

  const [isRefreshingClips, setIsRefreshingClips] = useState(false);

  const handleManualRefreshClips = async () => {
    setIsRefreshingClips(true);
    try {
      await evaluateRecentClips(true); // true means process current slot too
      Alert.alert("Success", "Checked for new events and updated clips!");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to refresh clips.");
    } finally {
      setIsRefreshingClips(false);
    }
  };

  const confirmDelete = (id: string) => {
    Alert.alert(
      "Delete Clip",
      "Are you sure you want to delete this memory clip?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteClip(id)
        }
      ]
    );
  };

  const handleGenerateStory = async () => {
    // Get all clips from today
    const today = getLocalDateString();
    const todayClips = clips
      .filter(c => c.slotId.startsWith(today))
      .sort((a, b) => a.createdAt - b.createdAt);

    if (todayClips.length === 0) {
      Alert.alert(
        "No Clips Today",
        "AI creates interpretation clips every 1 hours. Once you have at least one clip from today, you can generate your daily story!"
      );
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

    try {
      const response = await fetch(`${API_URL}/generate_story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: useStore.getState().userName,
          clips_text: clipsText,
          event_summaries: eventSummaries,
          style: "Classic"
        })
      });

      if (response.ok) {
        const data = await response.json();
        setStoryDraft({
          text: data.story_text,
          style: "Classic",
          date: today,
          mood: data.mood
        });
        Alert.alert("Success", "Your story draft has been generated! Check the Story tab.");
      } else {
        Alert.alert("Error", "Server failed to generate story.");
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to contact server.");
    } finally {
      setGeneratingStory(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>INTERPRETATION</Text>
        <Text style={styles.dateTitle}>Memories & Stories</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {sortedClips.map((clip) => (
          <View key={clip.id} style={styles.card}>
            {/* Slot Info Section */}
            <View style={styles.cardHeader}>
              <View style={styles.slotBadge}>
                <Text style={styles.slotText}>{clip.title || clip.slotId}</Text>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(clip.id)}>
                <Ionicons name="trash-outline" size={20} color="#999" />
              </TouchableOpacity>
            </View>

            {/* Editable Content Section */}
            <TextInput
              style={styles.clipTextInput}
              multiline
              value={clip.text}
              onChangeText={(newText) => updateClip(clip.id, newText)}
              scrollEnabled={false} // Let ScrollView handle it
            />

            <View style={styles.footerRow}>
              <Ionicons name="sparkles" size={12} color="#6366f1" />
              <Text style={styles.aiTag}>AI Reflective Clip</Text>
            </View>
          </View>
        ))}

        {sortedClips.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="hourglass-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>
              No clips yet. AI evaluates your events every hour to write your story.
            </Text>
          </View>
        )}

        {/* ALWAYS SHOW BUTTON FOR DISCOVERABILITY */}
        <TouchableOpacity
          style={[styles.refreshClipsBtn, isRefreshingClips && { opacity: 0.6 }]}
          onPress={handleManualRefreshClips}
          disabled={isRefreshingClips || isGeneratingStory}
        >
          <Ionicons name="refresh-circle" size={20} color="#000" />
          <Text style={styles.refreshClipsBtnText}>
            {isRefreshingClips ? "REFRESHING..." : "REFRESH CLIPS"}
          </Text>
        </TouchableOpacity>

        {/* ALWAYS SHOW BUTTON FOR DISCOVERABILITY */}
        <TouchableOpacity
          style={[styles.generateStoryBtn, isGeneratingStory && { opacity: 0.6 }]}
          onPress={handleGenerateStory}
          disabled={isGeneratingStory || isRefreshingClips}
        >
          <Ionicons name="sparkles" size={20} color="#fff" />
          <Text style={styles.generateStoryBtnText}>
            {isGeneratingStory ? "GENERATING STORY..." : "WRITE TODAY'S STORY"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E9EEF0' },
  header: { paddingTop: 60, paddingBottom: 20, alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 2, color: '#000' },
  dateTitle: { fontSize: 14, fontWeight: '500', color: '#666', marginTop: 4, textTransform: 'uppercase' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15
  },
  slotBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  slotText: {
    fontSize: 12,
    color: '#6366f1',
    fontWeight: '700',
  },
  clipTextInput: {
    fontSize: 16,
    color: '#444',
    lineHeight: 24,
    fontStyle: 'italic',
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    minHeight: 80,
    textAlignVertical: 'top'
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    justifyContent: 'flex-end'
  },
  aiTag: {
    fontSize: 10,
    color: '#A0A0A0',
    marginLeft: 4,
    textTransform: 'uppercase',
    fontWeight: '600'
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    paddingHorizontal: 40
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20,
    lineHeight: 20,
    fontSize: 14
  },
  generateStoryBtn: {
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 20,
    marginTop: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5
  },
  generateStoryBtnText: {
    color: '#fff',
    fontWeight: '900',
    marginLeft: 10,
    letterSpacing: 1
  },
  refreshClipsBtn: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 20,
    marginTop: 20,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#000',
    borderStyle: 'dashed',
  },
  refreshClipsBtnText: {
    color: '#000',
    fontWeight: '800',
    marginLeft: 10,
    letterSpacing: 1
  }
});
