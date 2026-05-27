import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { API_URL } from '../../constants/Config';



import { useStore } from '../../store/useStore';

// Accessing the interface from the store file if needed, or letting type inference work.
// But the component uses explicit types in some places, so let's import it or just rely on the hook.
// The code I replaced above removed the usage of `EventItem` in `newEvent: EventItem` annotation?
// Ah, I removed the `const newEvent: EventItem =` line in the previous replacement and just passed object to `addEvent`.
// Only `events` usage might need type, but `useStore` types it.
// So I can remove the interface.

export default function EventLayer() {
  // Use global store
  const { events, addEvent, renameEvent, deleteEvent } = useStore();

  const [showInput, setShowInput] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [date, setDate] = useState(new Date()); // Back to Date object
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Rename Logic State
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [eventToRename, setEventToRename] = useState<{ id: string, title: string } | null>(null);
  const [tempRenameTitle, setTempRenameTitle] = useState('');

  // Photo Upload State
  const [uploadingSource, setUploadingSource] = useState<'camera' | 'library' | null>(null);

  const confirmDelete = (id: string) => {
    Alert.alert(
      "Delete Event",
      "Are you sure you want to remove this event from your log?",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteEvent(id)
        }
      ]
    );
  };

  const onTimeChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false); // Close modal on Android
    }
    if (selectedDate) {
      setDate(selectedDate);
    }
  };

  const getFormattedTime = () => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const addManualEvent = () => {
    if (manualTitle.trim() === '') {
      Alert.alert("Error", "Please enter both title and time.");
      return;
    }

    // Use derived string from date object
    const formattedTime = getFormattedTime();

    // Add to global store
    addEvent({
      id: Date.now().toString(),
      time: formattedTime,
      title: manualTitle,
      isManual: true,
      timestamp: date.getTime(), // Use the user-selected time!
    });

    setManualTitle('');
    setShowInput(false);
  };

  const handlePhotoEvent = async (source: 'camera' | 'library') => {
    try {
      let result;
      const options = {
        allowsEditing: true, // Enable editing to help reduce image resolution on device
        base64: true,
        exif: true,
        quality: 0.1,
      };

      if (source === 'camera') {
        const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
        if (!permissionResult.granted) {
          Alert.alert("Permission Required", "You need to allow camera access to take a photo.");
          return;
        }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permissionResult.granted) {
          Alert.alert("Permission Required", "You need to allow access to your photos to add an event from a photo.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          ...options,
          mediaTypes: ['images'],
        } as any);
      }

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      setUploadingSource(source);

      const asset = result.assets[0];
      const base64 = asset.base64;
      const exif = asset.exif;

      // Photo events should default to the capture/upload time, not manual picker state.
      const now = new Date();
      let eventTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      let eventTimestamp = now.getTime();

      if (exif) {
        // EXIF DateTime format usually like '2023:04:12 10:20:30'
        const dateTimeStr = exif.DateTimeOriginal || exif.DateTime;
        if (dateTimeStr) {
          const parts = dateTimeStr.split(' ');
          if (parts.length === 2) {
            const timePart = parts[1]; // '10:20:30'
            const timeParts = timePart.split(':');
            if (timeParts.length >= 2) {
              eventTime = `${timeParts[0]}:${timeParts[1]}`;
            }
            const datePart = parts[0].replace(/:/g, '-');
            const fullDate = new Date(`${datePart}T${timePart}`);
            if (!isNaN(fullDate.getTime())) {
              eventTimestamp = fullDate.getTime();
            }
          }
        }
      }

      const response = await fetch(`${API_URL}/analyze_photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          user_id: useStore.getState().userName,
          base64_image: base64 
        })
      });

      const data = await response.json();
      if (data.success && data.title) {
        addEvent({
          id: Date.now().toString(),
          time: eventTime,
          title: data.title,
          isManual: true,
          isPhoto: true,
          additional_info: data.description,
          timestamp: eventTimestamp,
        });
      } else {
        Alert.alert("Error", "Failed to analyze the photo.");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "An unexpected error occurred while analyzing the photo.");
    } finally {
      setUploadingSource(null);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>EVENT</Text>
        <Text style={styles.dateTitle}>{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {events.slice().sort((a, b) => a.timestamp - b.timestamp).map((event) => (
          <View key={event.id} style={styles.eventBox}>
            <Text style={styles.timeText}>{event.time}</Text>
              <View style={styles.eventRow}>
                <View style={styles.iconCircle}>
                  <Ionicons
                    name={event.isPhoto ? "image-outline" : (event.isManual ? "create-outline" : "location-outline")}
                    size={20}
                    color="black"
                  />
                </View>
                <View style={styles.textColumn}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  {event.weather && event.weather !== 'Unknown' && (
                    <View style={styles.weatherBadge}>
                      <Ionicons
                        name={event.weather.includes('雨') || event.weather.includes('Rain') ? "rainy-outline" : "sunny-outline"}
                        size={12}
                        color="#666"
                      />
                      <Text style={styles.weatherText}>{event.weather}, {event.temperature}°C</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      "Event Options",
                      "Choose an action",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Rename",
                          onPress: () => {
                            setEventToRename({ id: event.id, title: event.title });
                            setTempRenameTitle(event.title);
                            setIsRenameModalVisible(true);
                          }
                        },
                        { text: "Delete", style: "destructive", onPress: () => confirmDelete(event.id) }
                      ]
                    );
                  }}
                >
                  <Ionicons name="ellipsis-horizontal" size={22} color="#666" />
                </TouchableOpacity>
              </View>
            </View>
          ))}

        {/* Rename Modal */}
        {isRenameModalVisible && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalHeader}>Rename Event</Text>
              <TextInput
                style={styles.renameInput}
                value={tempRenameTitle}
                onChangeText={setTempRenameTitle}
                autoFocus
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => setIsRenameModalVisible(false)}
                  style={styles.modalCancelBtn}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    if (eventToRename) {
                      renameEvent(eventToRename.id, tempRenameTitle);
                    }
                    setIsRenameModalVisible(false);
                  }}
                  style={styles.modalConfirmBtn}
                >
                  <Text style={styles.modalConfirmText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {showInput ? (
          <View style={styles.inputCard}>
            <TextInput
              style={styles.inputField}
              placeholder="Event Title (e.g. Meeting)"
              placeholderTextColor="#666"
              value={manualTitle}
              onChangeText={setManualTitle}
            />

            <View style={styles.pickerContainer}>
              <Text style={styles.label}>Select Time:</Text>

              {/* iOS: Inline Spinner */}
              {Platform.OS === 'ios' && (
                <DateTimePicker
                  value={date}
                  mode="time"
                  display="spinner"
                  onChange={onTimeChange}
                  style={styles.timePicker}
                  textColor="#000000"
                />
              )}

              {/* Android: Button triggers Modal with Spinner style */}
              {Platform.OS === 'android' && (
                <View>
                  <TouchableOpacity
                    onPress={() => setShowTimePicker(true)}
                    style={styles.androidTimeBtn}
                  >
                    <Text style={styles.androidTimeText}>{getFormattedTime()}</Text>
                    <Ionicons name="time-outline" size={20} color="#000" />
                  </TouchableOpacity>

                  {showTimePicker && (
                    <DateTimePicker
                      value={date}
                      mode="time"
                      display="spinner"
                      onChange={onTimeChange}
                    />
                  )}
                </View>
              )}
            </View>

            <View style={styles.inputActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowInput(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={addManualEvent}>
                <Text style={styles.confirmBtnText}>Add Event</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <TouchableOpacity
              style={styles.addTriggerBtn}
              onPress={() => setShowInput(true)}
              disabled={uploadingSource !== null}
            >
              <Ionicons name="add-circle" size={24} color="black" />
              <Text style={styles.addTriggerText}>ADD MANUAL EVENT</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.addTriggerBtn, uploadingSource !== null && { opacity: 0.5 }]}
              onPress={() => handlePhotoEvent('camera')}
              disabled={uploadingSource !== null}
            >
              {uploadingSource === 'camera' ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="camera-outline" size={24} color="black" />
              )}
              <Text style={styles.addTriggerText}>
                {uploadingSource === 'camera' ? "ANALYZING PHOTO..." : "TAKE A PHOTO"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.addTriggerBtn, uploadingSource !== null && { opacity: 0.5 }]}
              onPress={() => handlePhotoEvent('library')}
              disabled={uploadingSource !== null}
            >
              {uploadingSource === 'library' ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="image-outline" size={24} color="black" />
              )}
              <Text style={styles.addTriggerText}>
                {uploadingSource === 'library' ? "ANALYZING PHOTO..." : "UPLOAD PHOTO"}
              </Text>
            </TouchableOpacity>
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
  dateTitle: {
    fontSize: 42,
    fontWeight: '300',
    color: '#333',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  scrollContent: { paddingHorizontal: 25, paddingBottom: 60 },
  eventBox: { marginBottom: 30 },
  timeText: {
    fontSize: 42,
    fontWeight: '300',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#333',
    marginBottom: 5
  },
  eventRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 15, backgroundColor: 'white' },
  textColumn: { flex: 1 },
  eventTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  weatherBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  weatherText: { fontSize: 12, color: '#666', marginLeft: 4, fontWeight: '500' },

  addTriggerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 20, borderWidth: 1, borderColor: '#000', borderStyle: 'dashed', borderRadius: 12, marginTop: 10 },
  addTriggerText: { marginLeft: 10, fontWeight: 'bold', letterSpacing: 1, color: '#000' },

  inputCard: { backgroundColor: '#fff', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: '#ccc', marginTop: 10 },
  inputField: { borderBottomWidth: 1, borderColor: '#000', paddingVertical: 10, marginBottom: 15, fontSize: 18, color: '#000' },

  pickerContainer: { marginBottom: 15, alignItems: 'center' },
  label: { fontSize: 16, color: '#000', fontWeight: '600', marginBottom: 5, alignSelf: 'flex-start' },
  timePicker: { width: '100%', height: 120 },

  inputActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  cancelBtn: { padding: 10, marginRight: 10 },
  cancelBtnText: { color: '#666', fontSize: 16 },
  confirmBtn: { backgroundColor: '#000', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  confirmBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  // New Styles for Android
  androidTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  androidTimeText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000'
  },
  // Modal Styles
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 25,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: '#000' },
  renameInput: {
    borderBottomWidth: 1,
    borderColor: '#000',
    fontSize: 18,
    paddingVertical: 10,
    marginBottom: 20,
    color: '#000'
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalCancelBtn: { padding: 10, marginRight: 15 },
  modalCancelText: { color: '#666', fontSize: 16 },
  modalConfirmBtn: { backgroundColor: '#000', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8 },
  modalConfirmText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
