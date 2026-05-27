import React, { useState } from 'react';
import {
    StyleSheet, Text, View, ScrollView, TouchableOpacity,
    Dimensions, Alert, TextInput, Modal, SafeAreaView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../store/useStore';
import type { MoodType, StoryItem } from '../../store/useStore';
import { getLocalDateString } from '../../utils/date';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = width / 7;

// Emotion heatmap color palette
const MOOD_COLORS: Record<MoodType, string> = {
    positive: '#FFD700',  // Warm yellow - happy, excited
    calm: '#A2D149',  // Grass green - relaxed, peaceful
    stressed: '#FFA500',  // Orange - busy, anxious
    negative: '#85929E',  // Slate blue - sad, lonely
};

const MOOD_LABELS: Record<MoodType, string> = {
    positive: 'Positive',
    calm: 'Calm',
    stressed: 'Stressed',
    negative: 'Negative',
};

// Returns a readable text color (dark/light) based on background
const getTextColorForMood = (mood: MoodType): string => {
    // positive (#FFD700) and calm (#A2D149) are bright — use dark text
    // stressed (#FFA500) is medium-bright — dark text
    // negative (#85929E) is medium-dark — use white text
    return mood === 'negative' ? '#fff' : '#1a1a1a';
};

export default function ArchiveLayer() {
    const { stories } = useStore();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDayStories, setSelectedDayStories] = useState<StoryItem[]>([]);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedDateStr, setSelectedDateStr] = useState('');

    // Calendar Logic
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const monthName = currentDate.toLocaleString('default', { month: 'long' });

    // Build a lookup: date -> first story's mood (for calendar)
    const storyByDate: Record<string, StoryItem[]> = {};
    stories.forEach(s => {
        if (!storyByDate[s.date]) storyByDate[s.date] = [];
        storyByDate[s.date].push(s);
    });

    const confirmDelete = (id: string) => {
        Alert.alert(
            'Delete Journal',
            'Are you sure you want to delete this story?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => useStore.getState().deleteStory(id)
                }
            ]
        );
    };

    const handleDayPress = (dateStr: string) => {
        const dayStories = storyByDate[dateStr];
        if (!dayStories || dayStories.length === 0) return;
        setSelectedDayStories(dayStories);
        setSelectedDateStr(dateStr);
        setModalVisible(true);
    };

    const renderCalendar = () => {
        const days = [];
        const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

        // Header row
        const headerRow = (
            <View key="header" style={styles.calendarRow}>
                {dayNames.map((d, i) => (
                    <Text key={`dayname-${i}`} style={styles.dayLabel}>{d}</Text>
                ))}
            </View>
        );
        days.push(headerRow);

        let currentDayRow: React.ReactNode[] = [];

        // Empty padding cells
        for (let i = 0; i < firstDay; i++) {
            currentDayRow.push(<View key={`empty-${i}`} style={styles.dayBox} />);
        }

        // Day cells
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
            const dayStories = storyByDate[dateStr];
            const hasStory = !!dayStories && dayStories.length > 0;
            const isToday = getLocalDateString() === dateStr;

            // Pick the mood of the first story saved that day
            const mood: MoodType | undefined = hasStory ? dayStories[0].mood : undefined;
            // Determine circle background color
            const circleBg = hasStory
                ? (mood ? MOOD_COLORS[mood] : '#2C2C2E')
                : undefined;
            // Determine text color: always ensure contrast
            let dotTextColor: string;
            if (!hasStory) {
                dotTextColor = isToday ? '#000' : '#333';
            } else {
                // If there's a mood, ensure we use a color that contrasts with the background
                // 'negative' is dark slate blue, use white. Others are bright/yellow/green, use dark.
                dotTextColor = (mood === 'negative') ? '#fff' : '#1a1a1a';
            }

            currentDayRow.push(
                <TouchableOpacity
                    key={d}
                    style={styles.dayBox}
                    onPress={() => handleDayPress(dateStr)}
                    activeOpacity={hasStory ? 0.7 : 1}
                >
                    <View style={[
                        styles.dateCircle,
                        isToday && !hasStory && styles.dateCircleToday,
                        circleBg ? { backgroundColor: circleBg } : null
                    ]}>
                        <Text 
                            numberOfLines={1}
                            style={[
                                styles.dateText,
                                { color: dotTextColor },
                                (hasStory || isToday) && { fontWeight: '700' }
                            ]}
                        >
                            {d}
                        </Text>
                    </View>
                </TouchableOpacity>
            );

            if ((d + firstDay) % 7 === 0 || d === daysInMonth) {
                if (d === daysInMonth && currentDayRow.length < 7) {
                    const remaining = 7 - currentDayRow.length;
                    for (let i = 0; i < remaining; i++) {
                        currentDayRow.push(<View key={`empty-end-${i}`} style={styles.dayBox} />);
                    }
                }
                days.push(
                    <View key={`row-${d}`} style={styles.calendarRow}>
                        {currentDayRow}
                    </View>
                );
                currentDayRow = [];
            }
        }
        return days;
    };

    const filteredStories = stories.filter(s =>
        s.text.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>ARCHIVE</Text>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Calendar Card */}
                <View style={styles.card}>
                    <View style={styles.calendarHeader}>
                        <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
                            <Ionicons name="chevron-back" size={20} color="#000" />
                        </TouchableOpacity>
                        <Text style={styles.monthTitle}>{monthName} {year}</Text>
                        <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
                            <Ionicons name="chevron-forward" size={20} color="#000" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.calendarGrid}>
                        {renderCalendar()}
                    </View>

                    {/* Mood Legend */}
                    <View style={styles.legend}>
                        {(Object.keys(MOOD_COLORS) as MoodType[]).map(mood => (
                            <View key={mood} style={styles.legendItem}>
                                <View style={[styles.legendDot, { backgroundColor: MOOD_COLORS[mood] }]} />
                                <Text style={styles.legendLabel}>{MOOD_LABELS[mood]}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                {/* Story History List */}
                <View style={styles.historySection}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>PAST JOURNALS</Text>
                        <View style={styles.searchBar}>
                            <Ionicons name="search" size={16} color="#999" style={styles.searchIcon} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search memories..."
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholderTextColor="#999"
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')}>
                                    <Ionicons name="close-circle" size={16} color="#999" />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {filteredStories.length === 0 ? (
                        <View style={styles.emptyBox}>
                            <Text style={styles.emptyText}>
                                {searchQuery ? 'No matching memories found.' : 'No saved stories yet.'}
                            </Text>
                        </View>
                    ) : (
                        filteredStories.map(story => {
                            const accentColor = story.mood ? MOOD_COLORS[story.mood] : '#E0E0E0';
                            return (
                                <View
                                    key={story.id}
                                    style={[styles.storyEntry, { borderLeftColor: accentColor }]}
                                >
                                    <View style={styles.entryHeader}>
                                        <View style={styles.entryMeta}>
                                            <Text style={styles.entryDate}>{story.date}</Text>
                                            <View style={styles.badgeRow}>
                                                <View style={styles.styleBadge}>
                                                    <Text style={styles.styleBadgeText}>{story.style}</Text>
                                                </View>
                                                {story.mood && (
                                                    <View style={[styles.moodBadge, { backgroundColor: MOOD_COLORS[story.mood] }]}>
                                                        <Text style={[
                                                            styles.moodBadgeText,
                                                            { color: getTextColorForMood(story.mood) }
                                                        ]}>
                                                            {MOOD_LABELS[story.mood]}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                        <TouchableOpacity onPress={() => confirmDelete(story.id)}>
                                            <Ionicons name="trash-outline" size={18} color="#ccc" />
                                        </TouchableOpacity>
                                    </View>
                                    <Text style={styles.entryText}>{story.text}</Text>
                                </View>
                            );
                        })
                    )}
                </View>
            </ScrollView>

            {/* Day Story Modal */}
            <Modal
                visible={modalVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <SafeAreaView style={styles.modalSheet}>
                        {/* Handle bar */}
                        <View style={styles.sheetHandle} />

                        <View style={styles.modalHeader}>
                            <View>
                                <Text style={styles.modalDate}>{selectedDateStr}</Text>
                                <Text style={styles.modalSubtitle}>
                                    {selectedDayStories.length} {selectedDayStories.length === 1 ? 'entry' : 'entries'}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.closeBtn}
                                onPress={() => setModalVisible(false)}
                            >
                                <Ionicons name="close" size={22} color="#333" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            contentContainerStyle={styles.modalScroll}
                            showsVerticalScrollIndicator={false}
                        >
                            {selectedDayStories.map((story, index) => {
                                const moodColor = story.mood ? MOOD_COLORS[story.mood] : '#E0E0E0';
                                return (
                                    <View key={story.id} style={styles.modalStoryCard}>
                                        {/* Mood accent strip */}
                                        <View style={[styles.moodStrip, { backgroundColor: moodColor }]}>
                                            {story.mood && (
                                                <Text style={[
                                                    styles.moodStripLabel,
                                                    { color: getTextColorForMood(story.mood) }
                                                ]}>
                                                    {MOOD_LABELS[story.mood].toUpperCase()}
                                                </Text>
                                            )}
                                        </View>
                                        <View style={styles.modalCardBody}>
                                            <View style={styles.modalCardTopRow}>
                                                <View style={styles.styleBadge}>
                                                    <Text style={styles.styleBadgeText}>{story.style}</Text>
                                                </View>
                                                <TouchableOpacity onPress={() => {
                                                    setModalVisible(false);
                                                    confirmDelete(story.id);
                                                }}>
                                                    <Ionicons name="trash-outline" size={16} color="#ccc" />
                                                </TouchableOpacity>
                                            </View>
                                            <Text style={styles.modalStoryText}>{story.text}</Text>
                                        </View>
                                    </View>
                                );
                            })}
                        </ScrollView>
                    </SafeAreaView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#E9EEF0' },
    header: { paddingTop: 60, paddingBottom: 10, alignItems: 'center' },
    headerTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 2, color: '#000' },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 60 },

    // Calendar Card
    card: {
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 20,
        marginBottom: 25,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
    },
    calendarHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        paddingHorizontal: 4,
    },
    navBtn: { padding: 6 },
    monthTitle: { fontSize: 17, fontWeight: '800', color: '#000', textTransform: 'uppercase', letterSpacing: 1 },
    calendarGrid: { width: '100%' },
    calendarRow: { flexDirection: 'row', marginBottom: 2 },
    dayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#BABABA', paddingBottom: 8 },
    dayBox: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
    dateCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    dateCircleToday: { borderWidth: 2, borderColor: '#1a1a1a' },
    dateText: { fontSize: 13, color: '#333', fontWeight: '400', textAlign: 'center' },

    // Legend
    legend: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 18,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendLabel: { fontSize: 10, fontWeight: '600', color: '#888' },

    // History Section
    historySection: { marginTop: 0 },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    sectionTitle: { fontSize: 12, fontWeight: '900', color: '#B0B0B0', letterSpacing: 1.5 },
    searchBar: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 36,
        marginLeft: 20,
    },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, fontSize: 14, color: '#000', padding: 0 },
    emptyBox: { padding: 30, alignItems: 'center' },
    emptyText: { color: '#999', fontSize: 14 },

    storyEntry: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 20,
        marginBottom: 14,
        borderLeftWidth: 4,
        borderLeftColor: '#E0E0E0',
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 2,
    },
    entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    entryMeta: { flex: 1, marginRight: 10 },
    entryDate: { fontSize: 13, fontWeight: '800', color: '#000', marginBottom: 6 },
    badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    styleBadge: { backgroundColor: '#F0F0F0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    styleBadgeText: { fontSize: 10, fontWeight: '700', color: '#666', textTransform: 'uppercase' },
    moodBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    moodBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
    entryText: { fontSize: 15, color: '#444', lineHeight: 23 },

    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
    },
    modalSheet: {
        backgroundColor: '#F4F6F8',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        maxHeight: '85%',
        paddingBottom: 10,
    },
    sheetHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#D0D0D0',
        borderRadius: 2,
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: 4,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 20,
        paddingTop: 12,
    },
    modalDate: { fontSize: 18, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
    modalSubtitle: { fontSize: 13, color: '#999', marginTop: 3, fontWeight: '500' },
    closeBtn: {
        padding: 6,
        backgroundColor: '#E8EAED',
        borderRadius: 20,
    },
    modalScroll: { paddingHorizontal: 20, paddingBottom: 30, paddingTop: 4 },
    modalStoryCard: {
        backgroundColor: '#fff',
        borderRadius: 20,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.07,
        shadowRadius: 10,
        elevation: 3,
    },
    moodStrip: {
        height: 36,
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    moodStripLabel: {
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1.2,
    },
    modalCardBody: { padding: 16 },
    modalCardTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    modalStoryText: { fontSize: 15, color: '#333', lineHeight: 24 },
});
