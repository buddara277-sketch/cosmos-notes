import React, { useEffect, useRef, useState } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  StyleSheet, 
  Pressable, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform, 
  Keyboard, 
  StatusBar, 
  Linking,
  Image
} from 'react-native'; 
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// --- ГЕНЕРАТОР ЗВЕЗД (ФОН) ---
function createStars(count) {
  let seed = 274819;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  return Array.from({ length: count }, () => ({
    left: `${random() * 100}%`, top: `${random() * 100}%`,
    size: random() > 0.97 ? 3.2 : random() > 0.76 ? 2 : 1.2, opacity: 0.3 + random() * 0.7,
  }));
}
const stars = createStars(240);

function StarBackground() {
  return (
    <View pointerEvents="none" style={styles.stars}>
      <View style={styles.nebulaOne} />
      <View style={styles.nebulaTwo} />
      {stars.map((star, index) => (
        <View key={index} style={{ position: 'absolute', left: star.left, top: star.top, width: star.size, height: star.size, borderRadius: star.size, backgroundColor: '#FFFFFF', opacity: star.opacity }} />
      ))}
    </View>
  );
}

// --- КОМПОНЕНТ КНОПКИ В ЕДИНОМ СТИЛЕ ---
function CosmicButton({ title, icon, onPress, style, isRed, isSolidBlue }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cosmicButton,
        isRed && styles.cosmicButtonRed,
        isSolidBlue && styles.cosmicButtonSolidBlue,
        pressed && styles.cosmicButtonPressed,
        style
      ]}
    >
      {!isSolidBlue && <View pointerEvents="none" style={styles.cosmicInnerFrame} />}
      {icon && <Ionicons name={icon} size={20} color={isSolidBlue ? "#FFF" : isRed ? "#FF9AA9" : "#BDEBFF"} />}
      {title ? <Text style={[styles.cosmicButtonText, isRed && { color: '#FF9AA9' }, isSolidBlue && { color: '#FFF' }]}>{title}</Text> : null}
    </Pressable>
  );
}

// --- ГЛАВНЫЙ КОМПОНЕНТ ---
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MainApp />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function MainApp() {
  const [activeScreen, setActiveScreen] = useState('start');
  
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNotesList, setShowNotesList] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  
  const [deepSeekUrl, setDeepSeekUrl] = useState('https://chat.deepseek.com/');
  const [deepSeekUrlLoaded, setDeepSeekUrlLoaded] = useState(false);
  const deepSeekSaveTimerRef = useRef(null);
  const noteInputRef = useRef(null);
  const noteSaveTimer = useRef(null);
  const notesRef = useRef([]);

  useEffect(() => {
    AsyncStorage.getItem('cosmos-notes-v2').then((raw) => {
      const saved = raw ? JSON.parse(raw) : [];
      const safeSaved = Array.isArray(saved) ? saved : [];
      notesRef.current = safeSaved;
      setNotes(safeSaved);
      setNotesLoaded(true);
    }).catch(() => setNotesLoaded(true));
  }, []);

  useEffect(() => {
    if (!notesLoaded) return;
    notesRef.current = notes;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      AsyncStorage.setItem('cosmos-notes-v2', JSON.stringify(notes)).catch(() => {});
    }, 300);
  }, [notes, notesLoaded]);

  useEffect(() => {
    AsyncStorage.getItem('deepseek-last-url').then((savedUrl) => {
      if (savedUrl && savedUrl.startsWith('https://chat.deepseek.com/')) setDeepSeekUrl(savedUrl);
      setDeepSeekUrlLoaded(true);
    });
  }, []);

  const rememberDeepSeekUrl = (url) => {
    if (typeof url !== 'string' || !url.startsWith('https://chat.deepseek.com/')) return;
    setDeepSeekUrl(url);
    if (deepSeekSaveTimerRef.current) clearTimeout(deepSeekSaveTimerRef.current);
    deepSeekSaveTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem('deepseek-last-url', url).catch(() => {});
    }, 800);
  };

  const createNote = () => {
    const now = new Date().toISOString();
    const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: '', createdAt: now, updatedAt: now };
    setNotes((prev) => [note, ...prev]);
    setSelectedNoteId(note.id);
    setNoteText('');
    setShowNotesList(false);
    setTimeout(() => noteInputRef.current?.focus(), 200);
  };

  const updateNoteText = (value) => {
    setNoteText(value);
    if (!selectedNoteId) {
      const now = new Date().toISOString();
      const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: value, createdAt: now, updatedAt: now };
      setNotes((prev) => [note, ...prev]);
      setSelectedNoteId(note.id);
      return;
    }
    setNotes((prev) => prev.map((n) => n.id === selectedNoteId ? { ...n, text: value, updatedAt: new Date().toISOString() } : n));
  };

  // УДАЛЕНИЕ БЕЗ СИСТЕМНОГО ОКНА
  const deleteNote = (noteId) => {
    const nextNotes = notes.filter((n) => n.id !== noteId);
    setNotes(nextNotes);
    
    if (selectedNoteId === noteId) { 
      setSelectedNoteId(null); 
      setNoteText(''); 
    }
  };

  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  // 1. СТАРТОВЫЙ ЭКРАН
  if (activeScreen === 'start') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        <View style={styles.centerContainer}>
          
          <Image 
            source={require('./assets/icon.png')} 
            style={{ width: 220, height: 220, resizeMode: 'contain', marginBottom: 20 }} 
          />

          <View style={{ width: '100%', paddingHorizontal: 30, gap: 16, marginTop: 10 }}>
            <CosmicButton 
              title="DeepSeek" 
              icon="planet-outline" 
              onPress={() => setActiveScreen('deepseek')} 
            />
            <CosmicButton 
              title="Заметки" 
              icon="document-text-outline" 
              onPress={() => setActiveScreen('notes')} 
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // 2. ЭКРАН ЗАМЕТОК
  if (activeScreen === 'notes') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        
        <View style={styles.topNav}>
          <CosmicButton title="Назад" icon="arrow-back" onPress={() => setActiveScreen('start')} style={{ flex: 1 }} />
          <View style={{ width: 10 }} />
          <CosmicButton title="DeepSeek" icon="planet-outline" onPress={() => setActiveScreen('deepseek')} style={{ flex: 1 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.contentContainer}>
            
            <View style={styles.headerRow}>
              <Text style={styles.screenTitle}>Мои заметки</Text>
              <CosmicButton title="Новая" icon="add-circle-outline" onPress={createNote} style={{ paddingHorizontal: 16 }} />
            </View>

            <View style={styles.subHeaderRow}>
              <CosmicButton 
                title={showNotesList ? 'К редактору' : 'Все заметки'} 
                icon={showNotesList ? 'create-outline' : 'list-outline'} 
                onPress={() => { Keyboard.dismiss(); setShowNotesList(!showNotesList); }} 
                style={{ width: 170 }}
              />
              <Text style={styles.dateText}>
                {selectedNote ? `Создана: ${new Date(selectedNote.createdAt).toLocaleString('ru-RU')}` : 'Новая запись'}
              </Text>
            </View>

            {showNotesList ? (
              <ScrollView 
                style={{ flex: 1 }} 
                contentContainerStyle={{ paddingBottom: 20 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={true}
              >
                {notes.length === 0 ? <Text style={styles.emptyText}>Пока нет заметок</Text> : null}
                {notes.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(note => (
                  <View key={note.id} style={styles.noteCard}>
                    <Pressable 
                      onPress={() => { setSelectedNoteId(note.id); setNoteText(note.text); setShowNotesList(false); }} 
                      style={{ flex: 1 }}
                    >
                      <Text style={styles.noteCardTitle}>{note.text.trim().split('\n')[0].slice(0, 40) || 'Пустая заметка'}</Text>
                      <Text style={styles.noteCardDate}>{new Date(note.createdAt).toLocaleString('ru-RU')}</Text>
                      <Text style={styles.noteCardPreview} numberOfLines={2}>{note.text || 'Нет текста'}</Text>
                    </Pressable>
                    
                    <View style={{ zIndex: 10, elevation: 10 }}>
                      <CosmicButton 
                        title="" 
                        icon="trash-outline" 
                        isRed 
                        onPress={() => deleteNote(note.id)} 
                        style={{ width: 44, height: 44, paddingHorizontal: 0, minHeight: 0 }} 
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={{ flex: 1, paddingBottom: 20 }}>
                <View style={styles.editorWrapper}>
                  <View pointerEvents="none" style={styles.cosmicInnerFrame} />
                  <TextInput
                    ref={noteInputRef}
                    value={noteText}
                    onChangeText={updateNoteText}
                    multiline
                    placeholder="Начни писать заметку…"
                    placeholderTextColor="#8B91A8"
                    style={styles.editorInput}
                    textAlignVertical="top"
                  />
                </View>
                
                {selectedNote && (
                  <View style={{ alignItems: 'flex-end', marginTop: 12 }}>
                    <CosmicButton title="Удалить заметку" isRed onPress={() => deleteNote(selectedNote.id)} style={{ width: 180 }} />
                  </View>
                )}
              </View>
            )}

          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // 3. ЭКРАН DEEPSEEK
  if (activeScreen === 'deepseek') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        
        <View style={styles.topNav}>
          <CosmicButton title="Назад" icon="arrow-back" onPress={() => setActiveScreen('start')} style={{ flex: 1 }} />
          <View style={{ width: 10 }} />
          <CosmicButton title="Заметки" icon="document-text-outline" onPress={() => setActiveScreen('notes')} style={{ flex: 1 }} />
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.screenTitle}>DeepSeek</Text>
            <CosmicButton 
              title="Открыть в браузере" 
              onPress={() => Linking.openURL('https://chat.deepseek.com/')} 
              isSolidBlue={true}
            />
          </View>

          <View style={styles.deepSeekWrapper}>
            <View pointerEvents="none" style={styles.cosmicInnerFrame} />
            {Platform.OS === 'web' ? (
              <View style={styles.webFallback}>
                <Text style={styles.webFallbackText}>
                  Веб-версия DeepSeek запрещает отображение внутри другого сайта. Нажми кнопку выше, чтобы открыть чат в новой вкладке.
                </Text>
              </View>
            ) : (
              deepSeekUrlLoaded && (
                <WebView
                  source={{ uri: deepSeekUrl }}
                  style={{ flex: 1, backgroundColor: '#000' }}
                  javaScriptEnabled
                  domStorageEnabled
                  onNavigationStateChange={(navState) => rememberDeepSeekUrl(navState?.url)}
                  startInLoadingState
                  renderLoading={() => <View style={styles.loading}><Text style={{ color: '#FFF' }}>Загрузка...</Text></View>}
                />
              )
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

// --- СТИЛИ ---
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#05091D' },
  stars: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', zIndex: 0 },
  nebulaOne: { position: 'absolute', width: 270, height: 360, borderRadius: 180, top: '20%', left: '-35%', backgroundColor: '#24145C', opacity: 0.22, transform: [{ rotate: '35deg' }] },
  nebulaTwo: { position: 'absolute', width: 240, height: 300, borderRadius: 160, top: '48%', right: '-40%', backgroundColor: '#102F77', opacity: 0.18, transform: [{ rotate: '-35deg' }] },
  
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  appTitle: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', letterSpacing: 1 },
  appSubtitle: { color: '#A5AFD5', fontSize: 16, marginTop: 8 },

  cosmicButton: {
    minHeight: 52,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#78CFFF',
    backgroundColor: 'rgba(7,20,48,0.94)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 10,
    elevation: 6,
    overflow: 'hidden',
  },
  cosmicInnerFrame: {
    position: 'absolute',
    left: 4, right: 4, top: 4, bottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(189,235,255,0.38)',
    borderRadius: 4,
  },
  cosmicButtonText: {
    color: '#DDF5FF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  cosmicButtonPressed: {
    transform: [{ scale: 0.97 }],
    backgroundColor: 'rgba(24,70,112,0.98)',
    borderColor: '#D7F5FF',
  },
  cosmicButtonRed: {
    borderColor: '#FF9AA9',
    backgroundColor: 'rgba(90,20,45,0.35)',
    shadowColor: '#FF9AA9',
  },
  cosmicButtonSolidBlue: {
    backgroundColor: '#376BFF',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },

  topNav: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(73,120,210,0.35)', backgroundColor: 'rgba(5,9,29,0.88)', zIndex: 5 },
  contentContainer: { flex: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8, zIndex: 1 },
  
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#222A50' },
  screenTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  subHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  dateText: { color: '#9DA9D0', fontSize: 11 },

  editorWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 7,
    backgroundColor: 'rgba(7,20,48,0.28)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 4,
  },
  editorInput: {
    flex: 1,
    color: '#EAF3FF',
    fontSize: 16,
    lineHeight: 24,
    padding: 16,
  },

  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,35,75,0.9)',
    borderWidth: 1,
    borderColor: '#293765',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  noteCardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  noteCardDate: { color: '#A5AFD5', fontSize: 11, marginBottom: 6 },
  noteCardPreview: { color: '#B9C4E7', fontSize: 13 },
  emptyText: { color: '#A5AFD5', textAlign: 'center', marginTop: 40 },

  deepSeekWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 7,
    backgroundColor: 'rgba(7,20,48,0.28)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 14,
    overflow: 'hidden',
  },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#05091D' },
  webFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  webFallbackText: { color: '#B9C4E7', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});