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
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
// --- КОНСТАНТЫ ---
const NOTES_KEY = 'cosmos-notes-v2';
const ATTACHMENTS_DIR = FileSystem.documentDirectory + 'cosmos-notes-attachments/';
const ATTACHMENTS_DB = 'cosmos-notes-files';
const ATTACHMENTS_STORE = 'files';

function openAttachmentsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENTS_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) {
        db.createObjectStore(ATTACHMENTS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveWebAttachment(key, file) {
  const db = await openAttachmentsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readwrite');
    transaction.objectStore(ATTACHMENTS_STORE).put(file, key);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getWebAttachment(key) {
  const db = await openAttachmentsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readonly');
    const request = transaction.objectStore(ATTACHMENTS_STORE).get(key);

    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function deleteWebAttachment(key) {
  const db = await openAttachmentsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readwrite');
    transaction.objectStore(ATTACHMENTS_STORE).delete(key);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}
async function addNoteAttachments(noteId, setNotes) {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const selectedFiles = result.assets.filter((file) => {
      const name = (file.name || '').toLowerCase();
      const mime = (file.mimeType || '').toLowerCase();

      return !mime.startsWith('image/') &&
        !/\.(jpg|jpeg|png|gif|webp|heic|bmp)$/i.test(name);
    });

    if (!selectedFiles.length) {
      Alert.alert('Файлы', 'Выбери документы, а не фотографии.');
      return;
    }

    const attachments = [];

    if (Platform.OS === 'web') {
      for (const file of selectedFiles) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const blob = file.file || await fetch(file.uri).then(response => {
          if (!response.ok) throw new Error('Не удалось прочитать файл');
          return response.blob();
        });

        await saveWebAttachment(id, blob);

        attachments.push({
          id,
          storageKey: id,
          name: file.name || 'Документ',
          mimeType: file.mimeType || blob.type || 'application/octet-stream',
          size: file.size || blob.size || 0,
          uri: `web:${id}`,
        });
      }
    } else {
      await FileSystem.makeDirectoryAsync(ATTACHMENTS_DIR, {
        intermediates: true,
      });

      for (const file of selectedFiles) {
        const safeName = (file.name || 'document').replace(/[\\/:*?"<>|]/g, '_');
        const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
        const destination = ATTACHMENTS_DIR + storedName;

        await FileSystem.copyAsync({
          from: file.uri,
          to: destination,
        });

        attachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || 'Документ',
          mimeType: file.mimeType || 'application/octet-stream',
          size: file.size || 0,
          uri: destination,
        });
      }
    }

    setNotes(prev =>
      prev.map(note =>
        note.id === noteId
          ? {
              ...note,
              attachments: [
                ...(Array.isArray(note.attachments) ? note.attachments : []),
                ...attachments,
              ],
              updatedAt: new Date().toISOString(),
            }
          : note
      )
    );

    Alert.alert('Готово', `Добавлено файлов: ${attachments.length}`);
  } catch (error) {
    console.warn('Ошибка добавления файлов:', error);
    Alert.alert('Ошибка', 'Не удалось прикрепить документы.');
  }
}
const DEEPSEEK_KEY = 'deepseek-last-url';
const CURRENCY_CACHE_KEY = 'cosmos-currency-cache-v1';
const CALENDAR_NOTES_KEY = 'cosmos-calendar-notes-v1';
const CALENDAR_REMINDERS_KEY = 'cosmos-calendar-reminders-v1';
// Показываем локальные уведомления календаря
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
function getLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const DEFAULT_CURRENCY = 'EUR';
const CURRENCIES = [
  'EUR', 'USD', 'RUB', 'GBP', 'CNY', 'JPY', 'CHF', 'CAD', 'AUD', 'INR', 'TRY', 'AED', 'PLN', 'CZK', 'KZT', 'UAH', 'GEL', 'THB', 'BRL', 'VND', 'IDR', 'SEK', 'NOK', 'DKK', 'HUF', 'RON',
];
const CURRENCY_NAMES = {
  EUR: 'Евро',
  USD: 'Доллар США',
  RUB: 'Российский рубль',
  GBP: 'Фунт стерлингов',
  CNY: 'Китайский юань',
  JPY: 'Японская иена',
  CHF: 'Швейцарский франк',
  CAD: 'Канадский доллар',
  AUD: 'Австралийский доллар',
  INR: 'Индийская рупия',
  TRY: 'Турецкая лира',
  AED: 'Дирхам ОАЭ',
  PLN: 'Польский злотый',
  CZK: 'Чешская крона',
  KZT: 'Казахстанский тенге',
  UAH: 'Украинская гривна',
  GEL: 'Грузинский лари',
  THB: 'Тайский бат',
  BRL: 'Бразильский реал',
  VND: 'Вьетнамский донг',
  IDR: 'Индонезийская рупия (Бали)',
  SEK: 'Шведская крона',
  NOK: 'Норвежская крона',
  DKK: 'Датская крона',
  HUF: 'Венгерский форинт',
  RON: 'Румынский лей',
};
// --- ГЕНЕРАТОР ЗВЁЗД ---
function createStars(count) {
  let seed = 274819;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  return Array.from({ length: count }, () => ({
    left: `${random() * 100}%`,
    top: `${random() * 100}%`,
    size: random() > 0.97 ? 3.2 : random() > 0.76 ? 2 : 1.2,
    opacity: 0.3 + random() * 0.7,
  }));
}
const stars = createStars(240);
function StarBackground() {
  return (
    <View pointerEvents="none" style={styles.stars}>
      <View style={styles.nebulaOne} />
      <View style={styles.nebulaTwo} />
      {stars.map((star, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            borderRadius: star.size,
            backgroundColor: '#FFFFFF',
            opacity: star.opacity,
          }}
        />
      ))}
    </View>
  );
}
// --- ОБЩАЯ КОСМИЧЕСКАЯ КНОПКА ---
function CosmicButton({
  title,
  icon,
  iconSize = 20,
  onPress,
  style,
  isRed,
  isSolidBlue,
  disabled,
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cosmicButton,
        isRed && styles.cosmicButtonRed,
        isSolidBlue && styles.cosmicButtonSolidBlue,
        disabled && { opacity: 0.45 },
        pressed && !disabled && styles.cosmicButtonPressed,
        style,
      ]}
    >
      {!isSolidBlue && <View pointerEvents="none" style={styles.cosmicInnerFrame} />}
      {icon ? (
        <Ionicons
          name={icon}
          size={iconSize}
          color={isSolidBlue ? '#FFF' : isRed ? '#FF9AA9' : '#BDEBFF'}
        />
      ) : null}
      {title ? (
        <Text
          style={[
            styles.cosmicButtonText,
            isRed && { color: '#FF9AA9' },
            isSolidBlue && { color: '#FFF' },
          ]}
        >
          {title}
        </Text>
      ) : null}
    </Pressable>
  );
}
// --- КВАДРАТНАЯ КНОПКА ИНСТРУМЕНТА ---
function ToolButton({ title, icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolButton,
        pressed && styles.cosmicButtonPressed,
      ]}
    >
      <View pointerEvents="none" style={styles.toolInnerFrame} />
      <Ionicons name={icon} size={30} color="#BDEBFF" />
      <Text style={styles.toolButtonText}>{title}</Text>
    </Pressable>
  );
}
// --- ФОРМАТИРОВАНИЕ ДАТЫ ---
function formatDate(value) {
  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch {
    return '';
  }
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
  const [notesLoadFailed, setNotesLoadFailed] = useState(false);
  const [deepSeekUrl, setDeepSeekUrl] = useState('https://chat.deepseek.com/');
  const [deepSeekUrlLoaded, setDeepSeekUrlLoaded] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [toolScreen, setToolScreen] = useState('tools');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  const [calendarNoteOpen, setCalendarNoteOpen] = useState(false);
  const [calendarNotes, setCalendarNotes] = useState({});
  const [calendarNotesLoaded, setCalendarNotesLoaded] = useState(false);
  const [calendarNotesLoadFailed, setCalendarNotesLoadFailed] = useState(false);
  const [calendarNoteText, setCalendarNoteText] = useState('');
  const [calendarReminders, setCalendarReminders] = useState({});
  const [calendarRemindersLoaded, setCalendarRemindersLoaded] = useState(false);
  const [calendarTimePickerVisible, setCalendarTimePickerVisible] = useState(false);
  const [pendingCalendarReminderText, setPendingCalendarReminderText] = useState('');
  const [unitCategory, setUnitCategory] = useState('length');
  const [unitValue, setUnitValue] = useState('1');
  const [unitFrom, setUnitFrom] = useState('km');
  const [unitTo, setUnitTo] = useState('m');
  const [currencyFrom, setCurrencyFrom] = useState('EUR');
  const [currencyTo, setCurrencyTo] = useState('USD');
  const [currencyAmount, setCurrencyAmount] = useState('1');
  const [currencyRates, setCurrencyRates] = useState(null);
  const [currencyDate, setCurrencyDate] = useState(null);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [currencyError, setCurrencyError] = useState('');
  const [currencyPicker, setCurrencyPicker] = useState(null);
  const [timerMinutes, setTimerMinutes] = useState('1');
  const [timerSeconds, setTimerSeconds] = useState('0');
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchStartedAt, setStopwatchStartedAt] = useState(null);
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const [timerTab, setTimerTab] = useState('timer');
  const [calculatorValue, setCalculatorValue] = useState('0');
  const deepSeekSaveTimerRef = useRef(null);
  const [reactionTargetId, setReactionTargetId] = useState(null);
  const noteSelectionRef = useRef({ start: 0, end: 0 });
  const noteLongPressTimerRef = useRef(null);
  const [noteSelection, setNoteSelection] = useState({ start: 0, end: 0 });
  const [notePaletteVisible, setNotePaletteVisible] = useState(false);
  const noteInputRef = useRef(null);
  const noteSaveTimer = useRef(null);
  const notesRef = useRef([]);
  const notesLoadedRef = useRef(false);
  const speechBaseTextRef = useRef('');
  const timerIntervalRef = useRef(null);
  const stopwatchIntervalRef = useRef(null);
  // --- ЗАГРУЗКА ЗАМЕТОК: НЕ ПЕРЕЗАПИСЫВАЕМ ПРИ ОШИБКЕ ---
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(NOTES_KEY)
      .then((raw) => {
        if (!mounted) return;
        let saved = [];
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            throw new Error('Некорректный формат заметок');
          }
          saved = parsed.filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.text === 'string'
          );
        }
        notesRef.current = saved;
        notesLoadedRef.current = true;
        setNotes(saved);
        setNotesLoaded(true);
      })
      .catch((error) => {
        console.warn('Не удалось загрузить заметки:', error);
        if (!mounted) return;
        // Не разрешаем автосохранению затереть старые данные.
        setNotesLoadFailed(true);
        setNotesLoaded(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  // --- АВТОСОХРАНЕНИЕ ЗАМЕТОК ---
  useEffect(() => {
    if (!notesLoaded || notesLoadFailed) return;
    notesRef.current = notes;
    if (noteSaveTimer.current) {
      clearTimeout(noteSaveTimer.current);
    }
    noteSaveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(NOTES_KEY, JSON.stringify(notes)).catch((error) => {
        console.warn('Не удалось сохранить заметки:', error);
      });
    }, 300);
    return () => {
      if (noteSaveTimer.current) {
        clearTimeout(noteSaveTimer.current);
      }
    };
  }, [notes, notesLoaded, notesLoadFailed]);
  // --- ЗАГРУЗКА ЗАМЕТОК КАЛЕНДАРЯ ---
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(CALENDAR_NOTES_KEY)
      .then((raw) => {
        if (!mounted) return;
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Некорректный формат заметок календаря');
        }
        setCalendarNotes(parsed);
        setCalendarNotesLoaded(true);
      })
      .catch((error) => {
        console.warn('Не удалось загрузить заметки календаря:', error);
        if (mounted) setCalendarNotesLoadFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  // --- ЗАГРУЗКА ПОСЛЕДНЕГО АДРЕСА DEEPSEEK ---
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(DEEPSEEK_KEY)
      .then((savedUrl) => {
        if (!mounted) return;
        if (
          savedUrl &&
          savedUrl.startsWith('https://chat.deepseek.com/')
        ) {
          setDeepSeekUrl(savedUrl);
        }
        setDeepSeekUrlLoaded(true);
      })
      .catch(() => {
        if (mounted) setDeepSeekUrlLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  // --- РАСПОЗНАВАНИЕ РЕЧИ ---
  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });
  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript;
    if (!transcript) return;
    const combined = speechBaseTextRef.current
      ? `${speechBaseTextRef.current}${speechBaseTextRef.current.endsWith(' ') ? '' : ' '}${transcript}`
      : transcript;
    setNoteText(combined);
    updateNoteText(combined);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false);
    console.warn('Ошибка распознавания речи:', event?.message || event?.error);
  });
  useEffect(() => {
    try {
      setSpeechAvailable(
        ExpoSpeechRecognitionModule.isRecognitionAvailable()
      );
    } catch {
      setSpeechAvailable(false);
    }
  }, []);
  // --- ЗАПОМИНАНИЕ DEEPSEEK ---
  const rememberDeepSeekUrl = (url) => {
    if (
      typeof url !== 'string' ||
      !url.startsWith('https://chat.deepseek.com/')
    ) {
      return;
    }
    setDeepSeekUrl(url);
    if (deepSeekSaveTimerRef.current) {
      clearTimeout(deepSeekSaveTimerRef.current);
    }
    deepSeekSaveTimerRef.current = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(
          DEEPSEEK_KEY,
          url
        );
      } catch (error) {
        console.warn('Не удалось сохранить ссылку DeepSeek:', error);
      }
    }, 500);
  };
  const createNote = () => {
    const now = new Date().toISOString();
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: '',
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    setSelectedNoteId(note.id);
    setNoteText('');
    noteSelectionRef.current = { start: 0, end: 0 };
    setReactionTargetId(null);
    setShowNotesList(false);
    setTimeout(() => noteInputRef.current?.focus(), 250);
  };
  // --- ИЗМЕНЕНИЕ ТЕКСТА ЗАМЕТКИ ---
  function updateNoteText(value) {
    setNoteText(value);
    if (!selectedNoteId) {
      const now = new Date().toISOString();
      const note = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: value,
        createdAt: now,
        updatedAt: now,
      };
      setNotes((prev) => [note, ...prev]);
      setSelectedNoteId(note.id);
      return;
    }
    setNotes((prev) =>
      prev.map((note) =>
        note.id === selectedNoteId
          ? { ...note, text: value, updatedAt: new Date().toISOString() }
          : note
      )
    );
  }
  // --- УДАЛЕНИЕ ЗАМЕТКИ ---
  // --- РЕАКЦИИ НА ЗАМЕТКИ ---
  const insertNoteSymbol = (symbol) => {
    const text = String(noteText || '');
    const selection = noteSelectionRef.current || {
      start: text.length,
      end: text.length
    };
    const start = Math.max(0, Math.min(selection.start, text.length));
    const end = Math.max(start, Math.min(selection.end, text.length));
    const nextText = text.slice(0, start) + symbol + text.slice(end);
    const nextPosition = start + symbol.length;
    const nextSelection = { start: nextPosition, end: nextPosition };
    noteSelectionRef.current = nextSelection;
    updateNoteText(nextText);
    setNotePaletteVisible(false);
    setTimeout(() => {
      noteInputRef.current?.focus();
      const input = noteInputRef.current;
      if (typeof input?.setNativeProps === 'function') {
        input.setNativeProps({ selection: nextSelection });
      } else if (typeof input?.setSelectionRange === 'function') {
        input.setSelectionRange(nextPosition, nextPosition);
      }
    }, 100);
  };
  const toggleNoteReaction = (noteId, emoji) => {
    const target = notes.find(note => note.id === noteId);
    if (!target) return;
    const current = Array.isArray(target.reactions) ? target.reactions : [];
    if (current.includes(emoji)) {
      setNotes(prev => prev.map(note =>
        note.id === noteId
          ? { ...note, reactions: current.filter(item => item !== emoji), updatedAt: new Date().toISOString() }
          : note
      ));
      return;
    }
    const text = String(target.text || '');
    const selection = selectedNoteId === noteId
      ? noteSelectionRef.current || { start: text.length, end: text.length }
      : { start: text.length, end: text.length };
    const start = Math.max(0, Math.min(selection.start, text.length));
    const end = Math.max(start, Math.min(selection.end, text.length));
    const nextText = text.slice(0, start) + emoji + text.slice(end);
    const nextPosition = start + emoji.length;
    setNotes(prev => prev.map(note =>
      note.id === noteId
        ? { ...note, text: nextText, reactions: [...current, emoji], updatedAt: new Date().toISOString() }
        : note
    ));
    if (selectedNoteId === noteId) {
      setNoteText(nextText);
      noteSelectionRef.current = { start: nextPosition, end: nextPosition };
    }
  };
  const deleteNote = (noteId) => {
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    if (selectedNoteId === noteId) {
      setSelectedNoteId(null);
      setNoteText('');
    }
  };
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(CALENDAR_REMINDERS_KEY)
      .then(raw => {
        if (!mounted) return;
        const parsed = raw ? JSON.parse(raw) : {};
        setCalendarReminders(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
        setCalendarRemindersLoaded(true);
      })
      .catch(error => {
        console.warn('Ошибка загрузки напоминаний:', error);
        if (mounted) setCalendarRemindersLoaded(true);
      });
    return () => { mounted = false; };
  }, []);
  
const scheduleCalendarReminder = async (dateKey, reminderText, scheduledDate) => {
  if (Platform.OS === 'web') {
    Alert.alert('Напоминания', 'Локальные уведомления доступны в установленной версии Android.');
    return false;
  }

  if (
    !(scheduledDate instanceof Date) ||
    Number.isNaN(scheduledDate.getTime()) ||
    scheduledDate <= new Date()
  ) {
    Alert.alert('Неверное время', 'Выбери время в будущем.');
    return false;
  }

  try {
    if (Platform.OS === 'android') {
      // Сначала создаём канал уведомлений
      await Notifications.setNotificationChannelAsync('calendar-reminders', {
        name: 'Напоминания календаря',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Проверяем разрешение на показ уведомлений
    let permission = await Notifications.getPermissionsAsync();

    if (!permission.granted) {
      permission = await Notifications.requestPermissionsAsync();
    }

    if (!permission.granted) {
      Alert.alert(
        'Нет разрешения',
        'Разреши Cosmos Notes отправлять уведомления в настройках телефона.'
      );
      return false;
    }

    // Проверяем разрешение на точное время Android
    if (Platform.OS === 'android') {
      let exactPermission = await Notifications.getExactAlarmPermissionsAsync();

      if (!exactPermission.granted) {
        exactPermission = await Notifications.requestExactAlarmPermissionsAsync();
      }

      if (!exactPermission.granted) {
        Alert.alert(
          'Нужен доступ к точным напоминаниям',
          'Разреши Cosmos Notes устанавливать будильники и напоминания в настройках Android.'
        );
        return false;
      }
    }

    const newId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Cosmos Notes',
        body: reminderText,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: scheduledDate,
        ...(Platform.OS === 'android'
          ? {
              channelId: 'calendar-reminders',
              delivery: 'alarmClock',
            }
          : {}),
      },
    });

    const previous = calendarReminders[dateKey];

    if (previous?.id) {
      try {
        await Notifications.cancelScheduledNotificationAsync(previous.id);
      } catch (error) {
        console.warn('Не удалось отменить прежнее уведомление:', error);
      }
    }

    const updated = {
      ...calendarReminders,
      [dateKey]: {
        id: newId,
        timestamp: scheduledDate.getTime(),
        time: scheduledDate.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
    };

    await AsyncStorage.setItem(
      CALENDAR_REMINDERS_KEY,
      JSON.stringify(updated)
    );

    setCalendarReminders(updated);
    return true;

  } catch (error) {
    console.error('Ошибка напоминания:', error);
    Alert.alert('Ошибка напоминания', String(error?.message || error));
    return false;
  }
};

  const cancelCalendarReminder = async (dateKey) => {
    const previous = calendarReminders[dateKey];
    if (!previous) return;
    if (Platform.OS !== 'web' && previous.id) {
      try {
        await Notifications.cancelScheduledNotificationAsync(previous.id);
      } catch (error) {
        console.warn('Ошибка отмены уведомления:', error);
      }
    }
    const updated = { ...calendarReminders };
    delete updated[dateKey];
    await AsyncStorage.setItem(CALENDAR_REMINDERS_KEY, JSON.stringify(updated));
    setCalendarReminders(updated);
  };
  const confirmCalendarAction = (title, message, onConfirm, confirmLabel) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
        onConfirm();
      }
      return;
    }
    Alert.alert(title, message, [
      { text: 'Нет', style: 'cancel' },
      { text: confirmLabel || 'Подтвердить', style: 'destructive', onPress: onConfirm },
    ]);
  };
  const askCalendarReminder = (text) => {
    if (!text?.trim()) return;

    if (Platform.OS === 'web') {
      const accepted = typeof window !== 'undefined' &&
        window.confirm('Создать напоминание для этой заметки?');

      if (accepted && typeof window !== 'undefined') {
        window.alert('Напоминания по времени доступны в установленной версии Android. Заметка сохранена.');
      }
      setCalendarNoteOpen(false);
      return;
    }

    setPendingCalendarReminderText(text.trim());
    Alert.alert('Напоминание', 'Создать напоминание для этой заметки?', [
      {
        text: 'Нет',
        style: 'cancel',
        onPress: () => setCalendarNoteOpen(false),
      },
      {
        text: 'Да',
        onPress: () => setCalendarTimePickerVisible(true),
      },
    ]);
  };
  const selectedNote = notes.find((note) => note.id === selectedNoteId);
  // --- ГОЛОСОВОЙ ВВОД ---
  const startVoiceInput = async () => {
    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Нет доступа к микрофону',
          'Разреши Cosmos Notes использовать микрофон в настройках телефона.'
        );
        return;
      }
      const available =
        ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        Alert.alert(
          'Распознавание речи недоступно',
          'Проверь подключение к интернету и наличие системного сервиса распознавания речи на телефоне.'
        );
        return;
      }
      speechBaseTextRef.current = noteText.trim();
      await ExpoSpeechRecognitionModule.start({
        lang: 'ru-RU',
        interimResults: false,
        continuous: false,
        maxAlternatives: 1,
      });
    } catch (error) {
      setIsListening(false);
      Alert.alert(
        'Не удалось включить микрофон',
        error?.message || 'Попробуй ещё раз.'
      );
    }
  };
  const stopVoiceInput = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch {
      setIsListening(false);
    }
  };
  // --- ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ ---
  const openTool = (name) => {
    Keyboard.dismiss();
    setToolScreen(name);
    setActiveScreen('tools');
  };
  const goBackToTools = () => {
    Keyboard.dismiss();
    setToolScreen('tools');
  };
  // --- КУРСЫ ВАЛЮТ: ЗАГРУЗКА КЭША ---
  const loadCurrencyCache = async () => {
    try {
      const raw = await AsyncStorage.getItem(CURRENCY_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || !cached.rates || !cached.date) return null;
      setCurrencyRates(cached.rates);
      setCurrencyDate(cached.date);
      return cached;
    } catch {
      return null;
    }
  };
  // --- КУРСЫ ВАЛЮТ: ЗАГРУЗКА ИЗ FRANKFURTER ---
  const refreshCurrencyRates = async () => {
    setCurrencyLoading(true);
    setCurrencyError('');
    try {
      const cached = await loadCurrencyCache();
      const response = await fetch(
        'https://api.frankfurter.dev/v2/rates?base=EUR'
      );
      if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Сервис не вернул курсы валют.');
      }
      const rates = { EUR: 1 };
      data.forEach((item) => {
        if (
          item &&
          typeof item.quote === 'string' &&
          Number.isFinite(Number(item.rate))
        ) {
          rates[item.quote] = Number(item.rate);
        }
      });
      const date = data.reduce((latest, item) => {
        return item.date && item.date > latest ? item.date : latest;
      }, '');
      if (!date || Object.keys(rates).length < 2) {
        throw new Error('Получены неполные данные о курсах.');
      }
      const cache = { rates, date };
      setCurrencyRates(rates);
      setCurrencyDate(date);
      await AsyncStorage.setItem(
        CURRENCY_CACHE_KEY,
        JSON.stringify(cache)
      );
      return cache;
    } catch (error) {
      if (!currencyRates) {
        await loadCurrencyCache();
      }
      setCurrencyError(
        'Не удалось обновить курсы. Если ранее они загружались, используется сохранённая версия.'
      );
      console.warn('Ошибка загрузки валют:', error);
    } finally {
      setCurrencyLoading(false);
    }
  };
  useEffect(() => {
    if (activeScreen === 'tools' && toolScreen === 'currency') {
      loadCurrencyCache().then(() => {
        refreshCurrencyRates();
      });
    }
  }, [activeScreen, toolScreen]);
  // --- ТАЙМЕР: ВОССТАНОВЛЕНИЕ ПО ВРЕМЕНИ ОКОНЧАНИЯ ---
  useEffect(() => {
    if (!timerRunning || !timerEndAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      setTimerRemaining(remaining);
      if (remaining <= 0) {
        setTimerRunning(false);
        setTimerEndAt(null);
        Alert.alert('Таймер', 'Время вышло!');
      }
    };
    update();
    timerIntervalRef.current = setInterval(update, 250);
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerRunning, timerEndAt]);
  // --- СЕКУНДОМЕР ---
  useEffect(() => {
    if (!stopwatchRunning || !stopwatchStartedAt) return;
    stopwatchIntervalRef.current = setInterval(() => {
      setStopwatchElapsed(
        Date.now() - stopwatchStartedAt
      );
    }, 50);
    return () => {
      if (stopwatchIntervalRef.current) clearInterval(stopwatchIntervalRef.current);
    };
  }, [stopwatchRunning, stopwatchStartedAt]);
  // --- ФОРМАТ ВРЕМЕНИ ---
  const formatClock = (milliseconds) => {
    const total = Math.max(0, Math.floor(milliseconds / 10));
    const centiseconds = total % 100;
    const seconds = Math.floor(total / 100) % 60;
    const minutes = Math.floor(total / 6000) % 60;
    const hours = Math.floor(total / 360000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  };
  // --- ЗАПУСК ТАЙМЕРА ---
  const startTimer = () => {
    const minutes = Math.max(0, Math.floor(Number(timerMinutes) || 0));
    const seconds = Math.max(
      0,
      Math.min(59, Math.floor(Number(timerSeconds) || 0))
    );
    const total = timerRemaining > 0
      ? timerRemaining
      : minutes * 60 + seconds;
    if (total <= 0) {
      Alert.alert('Таймер', 'Укажи время больше нуля.');
      return;
    }
    const endAt = Date.now() + total * 1000;
    setTimerRemaining(total);
    setTimerEndAt(endAt);
    setTimerRunning(true);
  };
  const stopTimer = () => {
    setTimerRunning(false);
    setTimerEndAt(null);
  };
  const resetTimer = () => {
    setTimerRunning(false);
    setTimerEndAt(null);
    setTimerRemaining(0);
  };
  // --- КАЛЬКУЛЯТОР ---
  const calculate = (expression) => {
    const source = String(expression)
      .replace(/×/g, '*')
      .replace(/÷/g, '/');
    if (!source.trim() || source.length > 200) {
      throw new Error('Недопустимое выражение');
    }
    let position = 0;
    const skipSpaces = () => {
      while (source[position] === ' ') position++;
    };
    const parseExpression = () => {
      let value = parseTerm();
      while (true) {
        skipSpaces();
        const operator = source[position];
        if (operator !== '+' && operator !== '-') break;
        position++;
        const rightStart = position;
        const right = parseTerm();
        const rightIsPercent = /%\s*$/.test(source.slice(rightStart, position));
        const adjustedRight = rightIsPercent
          ? value * right
          : right;
        value = operator === '+'
          ? value + adjustedRight
          : value - adjustedRight;
        if (!Number.isFinite(value)) {
          throw new Error('Некорректный результат');
        }
      }
      return value;
    };
    const parseTerm = () => {
      let value = parseUnary();
      while (true) {
        skipSpaces();
        const operator = source[position];
        if (operator !== '*' && operator !== '/') break;
        position++;
        const right = parseUnary();
        if (operator === '/' && right === 0) {
          throw new Error('Деление на ноль');
        }
        value = operator === '*' ? value * right : value / right;
        if (!Number.isFinite(value)) {
          throw new Error('Некорректный результат');
        }
      }
      return value;
    };
    const parseUnary = () => {
      skipSpaces();
      if (source[position] === '+') {
        position++;
        return parseUnary();
      }
      if (source[position] === '-') {
        position++;
        return -parseUnary();
      }
      return parsePrimary();
    };
    const parsePrimary = () => {
      skipSpaces();
      let value;
      if (source[position] === '(') {
        position++;
        value = parseExpression();
        skipSpaces();
        if (source[position] !== ')') {
          throw new Error('Не закрыта скобка');
        }
        position++;
      } else {
        const match = source.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
        if (!match) {
          throw new Error('Недопустимое выражение');
        }
        value = Number(match[0]);
        position += match[0].length;
      }
      skipSpaces();
      while (source[position] === '%') {
        value /= 100;
        position++;
        skipSpaces();
      }
      return value;
    };
    const result = parseExpression();
    skipSpaces();
    if (position !== source.length || !Number.isFinite(result)) {
      throw new Error('Недопустимое выражение');
    }
    return String(Number(result.toFixed(10)));
  };
  const pressCalculator = (value) => {
    if (value === 'C') {
      setCalculatorValue('0');
      return;
    }
    if (value === '⌫') {
      setCalculatorValue((prev) => prev.length > 1 ? prev.slice(0, -1) : '0');
      return;
    }
    if (value === '=') {
      try {
        setCalculatorValue(calculate(calculatorValue));
      } catch {
        Alert.alert('Калькулятор', 'Не удалось выполнить вычисление.');
      }
      return;
    }
    setCalculatorValue((prev) => prev === '0' ? value : prev + value);
  };
  // --- ГЛАВНЫЙ ЭКРАН ---
  if (activeScreen === 'start') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        <View style={styles.centerContainer}>
          <Image
            source={require('./assets/icon2.png')}
            style={{
              width: 220,
              height: 220,
              resizeMode: 'contain',
              marginBottom: 20,
            }}
          />
          <View style={styles.mainButtons}>
            <CosmicButton
              title="Заметки"
              icon="document-text-outline"
              onPress={() => setActiveScreen('notes')}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <CosmicButton
                  title="DeepSeek"
                  icon="planet-outline"
                  onPress={() => setActiveScreen('deepseek')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <CosmicButton
                  title="Яндекс Диск"
                  icon="cloud-outline"
                  iconSize={17}
                  onPress={() => Linking.openURL('https://disk.yandex.ru/').catch(() =>
                    Alert.alert('Яндекс Диск', 'Не удалось открыть Яндекс Диск.')
                  )}
                />
              </View>
            </View>
            <CosmicButton
              title="Инструменты"
              icon="grid-outline"
              onPress={() => {
                setToolScreen('tools');
                setActiveScreen('tools');
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }
  // --- ЭКРАН ЗАМЕТОК ---
  if (activeScreen === 'notes') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        <View style={styles.topNav}>
          <CosmicButton
            title="Назад"
            icon="arrow-back"
            onPress={() => {
              Keyboard.dismiss();
              setActiveScreen('start');
            }}
            style={{ flex: 1 }}
          />
          <View style={{ width: 10 }} />
          <CosmicButton
            title={showNotesList ? 'К редактору' : 'Все заметки'}
            icon={showNotesList ? 'create-outline' : 'list-outline'}
            onPress={() => {
              Keyboard.dismiss();
              setShowNotesList(!showNotesList);
              setReactionTargetId(null);
            }}
            style={{ flex: 1 }}
          />
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View style={styles.contentContainer}>
            <View style={styles.headerRow}>
              <CosmicButton
                title="Новая"
                icon="add-circle-outline"
                onPress={createNote}
                style={{ flex: 1, paddingHorizontal: 12 }}
              />
              <Pressable
                onPress={isListening ? stopVoiceInput : startVoiceInput}
                style={[
                  styles.micButton,
                  isListening && styles.micButtonActive,
                  { flex: 1 }
                ]}
              >
                <Ionicons
                  name={isListening ? 'stop' : 'mic-outline'}
                  size={22}
                  color={isListening ? '#FF9AA9' : '#BDEBFF'}
                />
                <Text style={styles.micButtonText}>
                  {isListening ? 'Остановить' : 'Голосовой ввод'}
                </Text>
              </Pressable>
            </View>
            {notesLoadFailed ? (
              <View style={styles.warningBox}>
                <Ionicons name="warning-outline" size={20} color="#FFD28A" />
                <Text style={styles.warningText}>
                  Не удалось прочитать сохранённые заметки. Автосохранение
                  временно отключено, чтобы не затереть прежние данные.
                </Text>
              </View>
            ) : null}
            {showNotesList ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {notes.length === 0 ? (
                  <Text style={styles.emptyText}>Пока нет заметок</Text>
                ) : null}
                {[...notes]
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt) - new Date(a.createdAt)
                  )
                  .map((note) => (
                    <View key={note.id} style={styles.noteCard}>
                      <Pressable
                        onPress={() => {
                          setSelectedNoteId(note.id);
                          setNoteText(note.text);
                          const end = (note.text || '').length;
                          noteSelectionRef.current = { start: end, end };
                          setReactionTargetId(null);
                          setShowNotesList(false);
                        }}
                        
                        style={{ flex: 1 }}
                      >
                        <Text style={styles.noteCardTitle}>
                          {note.text.trim().split('\n')[0].slice(0, 40) || 'Пустая заметка'}
                        </Text>
                        <Text style={styles.noteCardDate}>
                          {formatDate(note.createdAt)}
                        </Text>
                        <Text style={styles.noteCardPreview} numberOfLines={2}>
                          {note.text || 'Нет текста'}
                        </Text>
                      </Pressable>
                      <CosmicButton
                        title=""
                        icon="trash-outline"
                        isRed
                        onPress={() => deleteNote(note.id)}
                        style={{
                          width: 44,
                          height: 44,
                          paddingHorizontal: 0,
                          minHeight: 0,
                        }}
                      />
                    </View>
                  ))}
              </ScrollView>
            ) : (
              <View style={{ flex: 1, paddingBottom: 12 }}>
                {isListening ? (
                  <Text style={styles.listeningText}>
                    Слушаю… Говори после сигнала распознавания.
                  </Text>
                ) : null}
                <View style={styles.editorWrapper}>
                  <View
                    pointerEvents="none"
                    style={styles.cosmicInnerFrame}
                  />
                  {notePaletteVisible ? (
                    <View style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 8,
                      margin: 10,
                      padding: 10,
                      borderRadius: 14,
                      backgroundColor: 'rgba(7,20,48,0.96)',
                      borderWidth: 1,
                      borderColor: '#78CFFF'
                    }}>
                      {[
                        '✦', '✧', '✨', '💫', '🌟', '⭐', '🌠', '☄️',
                        '🌌', '🪐', '🌍', '🌎', '🌏', '🌙', '🌛', '🌞',
                        '🚀', '🛸', '🛰️', '👽', '👾', '🤖',
                        '🌈', '☀️', '🌤️', '⛅', '🌧️', '❄️', '🔥', '💧',
                        '🌊', '🌸', '🌺', '🌻', '🌹', '🌷', '🍀', '🌿',
                        '🌳', '🍁', '🍄', '🦋', '🐝', '🐬',
                        '😀', '😊', '😍', '🥰', '😘', '😎', '🤗', '😇',
                        '🤔', '😴', '🥳', '😂', '😌', '😉', '🤩', '🥹',
                        '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
                        '💖', '💕', '💞', '💗', '💝', '💘', '💌', '💐',
                        '⚡', '🔥', '💎', '🔮', '🧿', '♾️', '☯️', '🕉️',
                        '☮️', '❣️', '💯', '🎯', '🎁', '🏆', '🎨', '🎵'
                      ].map((symbol, index) => (
                        <Pressable
                          key={`${symbol}-${index}`}
                          onPress={() => insertNoteSymbol(symbol)}
                          style={{
                            minWidth: 38,
                            minHeight: 38,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 9,
                            backgroundColor: 'rgba(255,255,255,0.08)'
                          }}
                        >
                          <Text style={{ fontSize: 23 }}>{symbol}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <TextInput
                    ref={noteInputRef}
                    value={noteText}
                    onChangeText={updateNoteText}
                    onSelectionChange={({ nativeEvent }) => {
                      noteSelectionRef.current = nativeEvent.selection;
                      setNoteSelection(nativeEvent.selection);
                    }}
                    onBlur={(event) => {
                      const target = event.currentTarget || event.target;
                      if (typeof target?.selectionStart === 'number') {
                        const selection = {
                          start: target.selectionStart,
                          end: target.selectionEnd
                        };
                        noteSelectionRef.current = selection;
                        setNoteSelection(selection);
                      }
                    }}
                    onMouseUp={(event) => {
                      const target = event.currentTarget;
                      if (typeof target?.selectionStart === 'number') {
                        const selection = {
                          start: target.selectionStart,
                          end: target.selectionEnd
                        };
                        noteSelectionRef.current = selection;
                        setNoteSelection(selection);
                      }
                    }}
                    multiline
                    scrollEnabled
                    blurOnSubmit={false}
                    placeholder="Начни писать заметку…"
                    placeholderTextColor="#8B91A8"
                    style={styles.editorInput}
                    textAlignVertical="top"
                    keyboardAppearance="dark"
                  />
                </View>

                {(noteText.match(/https?:\/\/[^\s]+/g) || []).map((rawUrl, index) => {
                  const url = rawUrl.replace(/[),.!?;:]+$/, '');
                  return (
                    <Pressable
                      key={`${url}-${index}`}
                      onPress={() => Linking.openURL(url).catch(() =>
                        Alert.alert('Ссылка', 'Не удалось открыть ссылку.')
                      )}
                      style={{ marginTop: 8, paddingHorizontal: 4 }}
                    >
                      <Text style={{ color: '#78CFFF', textDecorationLine: 'underline' }}>
                        <Ionicons name="link-outline" size={14} color="#78CFFF" /> {url}
                      </Text>
                    </Pressable>
                  );
                })}

{selectedNote?.attachments?.length > 0 ? (
  <View style={{ marginTop: 12, gap: 8 }}>
    {selectedNote.attachments.map((file) => (
      <View
        key={file.id}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 10,
          borderRadius: 12,
          backgroundColor: 'rgba(80,150,210,0.12)',
          borderWidth: 1,
          borderColor: 'rgba(120,207,255,0.3)',
          gap: 10,
        }}
      >
        <Ionicons name="document-outline" size={22} color="#78CFFF" />
        <Text style={{ color: '#EAF5FF', flex: 1 }} numberOfLines={1}>
          {file.name}
        </Text>
        <Pressable
          onPress={async () => {
            try {
              if (Platform.OS === 'web') {
                const blob = await getWebAttachment(file.storageKey || file.id);
                if (!blob) throw new Error('Файл не найден в браузере');

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = file.name || 'Документ';
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              } else {
                await Sharing.shareAsync(file.uri, {
                  mimeType: file.mimeType,
                  dialogTitle: file.name,
                });
              }
            } catch (error) {
              console.warn('Ошибка открытия вложения:', error);
              Alert.alert('Ошибка', 'Не удалось открыть или скачать файл.');
            }
          }}
        >
          <Ionicons name="share-outline" size={23} color="#78CFFF" />
        </Pressable>
        <Pressable
          onPress={async () => {
            try {
              if (Platform.OS === 'web') {
                await deleteWebAttachment(file.storageKey || file.id);
              } else {
                await FileSystem.deleteAsync(file.uri, { idempotent: true });
              }

              setNotes(prev => prev.map(note =>
                note.id === selectedNote.id
                  ? {
                      ...note,
                      attachments: note.attachments.filter(item => item.id !== file.id),
                    }
                  : note
              ));
            } catch (error) {
              console.warn('Ошибка удаления вложения:', error);
              Alert.alert('Ошибка', 'Не удалось удалить файл.');
            }
          }}
        >
          <Ionicons name="close-circle-outline" size={23} color="#FF9AA9" />
        </Pressable>
      </View>
    ))}
  </View>
) : null}
                {selectedNote ? (
  <View style={{
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 18,
    marginTop: 10,
    marginBottom: 8,
  }}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Прикрепить файл"
      onPress={() => addNoteAttachments(selectedNote.id, setNotes)}
      style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(80,150,210,0.16)', borderWidth: 1, borderColor: '#78CFFF' }}
    >
      <Ionicons name="attach-outline" size={25} color="#78CFFF" />
    </Pressable>

    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Удалить заметку"
      onPress={() => deleteNote(selectedNote.id)}
      style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,100,130,0.12)', borderWidth: 1, borderColor: '#FF9AA9' }}
    >
      <Ionicons name="trash-outline" size={23} color="#FF9AA9" />
    </Pressable>

    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Реакция"
      onPress={() => setNotePaletteVisible(prev => !prev)}
      style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,210,100,0.12)', borderWidth: 1, borderColor: '#FFD66B' }}
    >
      <Ionicons name="star-outline" size={24} color="#FFD66B" />
    </Pressable>
  </View>
) : null}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }
  // --- РАЗДЕЛ ИНСТРУМЕНТОВ ---
  if (activeScreen === 'tools' && toolScreen === 'tools') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.contentContainer,
            { flexGrow: 1, paddingBottom: 30 },
          ]}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.screenTitle, { marginBottom: 20 }]}>
            Инструменты
          </Text>
          <View style={styles.toolsGrid}>
            <ToolButton
              title="Назад"
              icon="arrow-back"
              onPress={() => setActiveScreen('start')}
            />
            <ToolButton
              title="Календарь"
              icon="calendar-outline"
              onPress={() => openTool('calendar')}
            />
            <ToolButton
              title="Конвертер величин"
              icon="swap-horizontal-outline"
              onPress={() => openTool('units')}
            />
            <ToolButton
              title="Конвертер валют"
              icon="cash-outline"
              onPress={() => openTool('currency')}
            />
            <ToolButton
              title="Таймер и секундомер"
              icon="timer-outline"
              onPress={() => openTool('timer')}
            />
            <ToolButton
              title="Калькулятор"
              icon="calculator-outline"
              onPress={() => openTool('calculator')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
  // --- ОБЩАЯ ШАПКА ВНУТРЕННИХ ИНСТРУМЕНТОВ ---
  const toolTitles = {
    calendar: 'Календарь',
    units: 'Конвертер величин',
    currency: 'Конвертер валют',
    timer: 'Таймер и секундомер',
    calculator: 'Калькулятор',
  };
  const renderToolHeader = () => (
    <View style={styles.topNav}>
      <CosmicButton
        title="Назад"
        icon="arrow-back"
        onPress={goBackToTools}
        style={{ flex: 1 }}
      />
      <View style={{ width: 10 }} />
      <Text style={[styles.screenTitle, { flex: 2, textAlign: 'right' }]}>
        {toolTitles[toolScreen] || 'Инструменты'}
      </Text>
    </View>
  );
  // --- КАЛЕНДАРЬ ---
  if (activeScreen === 'tools' && toolScreen === 'calendar') {
    // ОТДЕЛЬНЫЙ ЭКРАН ЗАПИСИ
    if (calendarNoteOpen) {
      return (
        <SafeAreaView style={styles.safe}>
          <StatusBar barStyle="light-content" backgroundColor="#05091D" />
          <StarBackground />
          <View style={{ flex: 1, padding: 20 }}>
            <Pressable
              onPress={() => setCalendarNoteOpen(false)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
              }}
            >
              <Ionicons name="chevron-back" size={26} color="#BDEBFF" />
              <Text style={{ color: '#BDEBFF', fontSize: 16, marginLeft: 8 }}>
                Вернуться к календарю
              </Text>
            </Pressable>
            <View
              style={{
                marginTop: 24,
                padding: 18,
                borderRadius: 18,
                backgroundColor: 'rgba(7,20,48,0.92)',
                borderWidth: 1,
                borderColor: 'rgba(120,207,255,0.4)',
              }}
            >
              <Text style={{
                color: '#BDEBFF',
                fontSize: 20,
                fontWeight: '800',
              }}>
                Заметка
              </Text>
              <Text style={{
                color: '#FFFFFF',
                fontSize: 15,
                marginTop: 10,
                marginBottom: 16,
              }}>
                {selectedCalendarDate.toLocaleDateString('ru-RU', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
              <TextInput
                multiline
                value={calendarNoteText}
                onChangeText={setCalendarNoteText}
                editable={calendarNotesLoaded && !calendarNotesLoadFailed}
                placeholder="Напишите заметку..."
                placeholderTextColor="#8B91A8"
                textAlignVertical="top"
                style={{
                  minHeight: 190,
                  color: '#FFFFFF',
                  fontSize: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(120,207,255,0.35)',
                  borderRadius: 14,
                  padding: 14,
                  backgroundColor: 'rgba(3,10,30,0.65)',
                }}
              />
              <View style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 10,
                marginTop: 16,
              }}>
                <Pressable
                  disabled={!calendarNotesLoaded || calendarNotesLoadFailed}
                  accessibilityRole="button"
                  accessibilityLabel="Сохранить заметку"
                  onPress={async () => {
                    const key = getLocalDateKey(selectedCalendarDate);
                    const updated = { ...calendarNotes };
                    const text = calendarNoteText.trim();
                    if (text) {
                      updated[key] = text;
                    } else {
                      delete updated[key];
                    }
                    try {
                      await AsyncStorage.setItem(CALENDAR_NOTES_KEY, JSON.stringify(updated));
                      setCalendarNotes(updated);
                      if (!text) {
                        await cancelCalendarReminder(key);
                        setCalendarNoteOpen(false);
                        return;
                      }
                      askCalendarReminder(text);
                    } catch (error) {
                      console.warn('Ошибка сохранения заметки:', error);
                      Alert.alert('Ошибка', 'Не удалось сохранить заметку.');
                    }
                  }}
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#123C68',
                    borderWidth: 1,
                    borderColor: '#78CFFF',
                    opacity: calendarNotesLoaded && !calendarNotesLoadFailed ? 1 : 0.45,
                  }}
                >
                  <Ionicons name="save-outline" size={27} color="#BDEBFF" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Отменить напоминание"
                  onPress={() => {
                    const key = getLocalDateKey(selectedCalendarDate);
                    confirmCalendarAction(
                      'Напоминание',
                      'Отменить напоминание для этой даты?',
                      () => cancelCalendarReminder(key),
                      'Отменить'
                    );
                  }}
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#123C68',
                    borderWidth: 1,
                    borderColor: '#78CFFF',
                  }}
                >
                  <Ionicons name="notifications-off-outline" size={27} color="#BDEBFF" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Удалить заметку"
                  onPress={() => {
                    confirmCalendarAction(
                      'Удалить заметку?',
                      'Текст заметки и напоминание будут удалены.',
                      async () => {
                        const key = getLocalDateKey(selectedCalendarDate);
                        const updated = { ...calendarNotes };
                        delete updated[key];
                        try {
                          await AsyncStorage.setItem(CALENDAR_NOTES_KEY, JSON.stringify(updated));
                          setCalendarNotes(updated);
                          await cancelCalendarReminder(key);
                          setCalendarNoteText('');
                          setCalendarNoteOpen(false);
                        } catch (error) {
                          console.warn('Ошибка удаления заметки:', error);
                          Alert.alert('Ошибка', 'Не удалось удалить заметку.');
                        }
                      },
                      'Удалить'
                    );
                  }}
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#123C68',
                    borderWidth: 1,
                    borderColor: '#78CFFF',
                  }}
                >
                  <Ionicons name="trash-outline" size={27} color="#BDEBFF" />
                </Pressable>
              </View>
              {calendarTimePickerVisible && Platform.OS !== 'web' && (
                <DateTimePicker
                  value={new Date()}
                  mode="time"
                  display="default"
                  onChange={async (event, selectedTime) => {
                    if (event.type === 'dismissed' || !selectedTime) {
                      setCalendarTimePickerVisible(false);
                      setCalendarNoteOpen(false);
                      return;
                    }
                    setCalendarTimePickerVisible(false);
                    const scheduledDate = new Date(selectedCalendarDate);
                    scheduledDate.setHours(
                      selectedTime.getHours(),
                      selectedTime.getMinutes(),
                      0,
                      0
                    );
                    if (scheduledDate <= new Date()) {
                      Alert.alert(
                        'Время уже прошло',
                        'Выбери время в будущем.',
                        [{ text: 'Выбрать снова', onPress: () => setCalendarTimePickerVisible(true) }]
                      );
                      return;
                    }
                    await scheduleCalendarReminder(
                      getLocalDateKey(selectedCalendarDate),
                      pendingCalendarReminderText,
                      scheduledDate
                    );
                    setCalendarNoteOpen(false);
                  }}
                />
              )}
              {calendarNotesLoadFailed ? (
                <Text style={{ color: '#FF9B9B', marginTop: 12 }}>
                  Не удалось загрузить заметки. Сохранение отключено для защиты данных.
                </Text>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      );
    }
    // ОСНОВНОЙ ЭКРАН КАЛЕНДАРЯ
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const offset = (firstDay + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthNames = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
    ];
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const cells = [
      ...Array(offset).fill(null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        {renderToolHeader()}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.calendarMonthRow}>
            <CosmicButton
              icon="chevron-back"
              onPress={() => setCalendarDate(new Date(year, month - 1, 1))}
              style={styles.smallIconButton}
            />
            <Text style={styles.calendarMonthTitle}>
              {monthNames[month]} {year}
            </Text>
            <CosmicButton
              icon="chevron-forward"
              onPress={() => setCalendarDate(new Date(year, month + 1, 1))}
              style={styles.smallIconButton}
            />
          </View>
          <View style={styles.calendarGrid}>
            {weekDays.map((day) => (
              <View key={day} style={styles.calendarWeekCell}>
                <Text style={styles.calendarWeekText}>{day}</Text>
              </View>
            ))}
            {cells.map((day, index) => {
              if (!day) {
                return <View key={`empty-${index}`} style={styles.calendarDay} />;
              }
              const date = new Date(year, month, day);
              const dateKey = getLocalDateKey(date);
              const hasNote = Boolean(calendarNotes[dateKey]);
              const isSelected =
                selectedCalendarDate.getFullYear() === year &&
                selectedCalendarDate.getMonth() === month &&
                selectedCalendarDate.getDate() === day;
              const today = new Date();
              const isToday =
                today.getFullYear() === year &&
                today.getMonth() === month &&
                today.getDate() === day;
              return (
                <Pressable
                  key={`day-${day}`}
                  disabled={!calendarNotesLoaded || calendarNotesLoadFailed}
                  onPress={() => {
                    setSelectedCalendarDate(date);
                    setCalendarNoteText(calendarNotes[dateKey] || '');
                    setCalendarNoteOpen(true);
                  }}
                  style={[
                    styles.calendarDay,
                    isSelected && styles.calendarDaySelected,
                    isToday && !isSelected && styles.calendarDayToday,
                  ]}
                >
                  <Text
                    style={[
                      styles.calendarDayText,
                      isSelected && { color: '#FFFFFF', fontWeight: '800' },
                    ]}
                  >
                    {day}
                  </Text>
                  {hasNote ? (
                    <Text
                      numberOfLines={2}
                      ellipsizeMode="tail"
                      style={{
                        color: '#78CFFF',
                        fontSize: 8,
                        lineHeight: 10,
                        textAlign: 'center',
                        width: '100%',
                        marginTop: 3,
                        paddingHorizontal: 2,
                      }}
                    >
                      {calendarNotes[dateKey]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.calendarSelectedBox}>
            <Ionicons name="calendar" size={22} color="#BDEBFF" />
            <Text style={styles.calendarSelectedText}>
              Выбрано: {selectedCalendarDate.toLocaleDateString('ru-RU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </View>
          <Text style={{
            color: '#8B91A8',
            textAlign: 'center',
            marginTop: 14,
            fontSize: 13,
          }}>
            Нажмите на число, чтобы добавить или открыть заметку
          </Text>
          <CosmicButton
            title="Сегодня"
            icon="today-outline"
            onPress={() => {
              const today = new Date();
              setCalendarDate(today);
              setSelectedCalendarDate(today);
            }}
            style={{ marginTop: 18 }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }
  // --- КОНВЕРТЕР ВЕЛИЧИН ---
  if (activeScreen === 'tools' && toolScreen === 'units') {
    const unitGroups = {
      length: {
        title: 'Длина',
        units: [
          { id: 'mm', name: 'Миллиметры', short: 'мм', factor: 0.001 },
          { id: 'cm', name: 'Сантиметры', short: 'см', factor: 0.01 },
          { id: 'm', name: 'Метры', short: 'м', factor: 1 },
          { id: 'km', name: 'Километры', short: 'км', factor: 1000 },
          { id: 'inch', name: 'Дюймы', short: 'дюйм', factor: 0.0254 },
          { id: 'ft', name: 'Футы', short: 'фут', factor: 0.3048 },
          { id: 'mile', name: 'Мили', short: 'миля', factor: 1609.344 },
        ],
      },
      mass: {
        title: 'Масса',
        units: [
          { id: 'mg', name: 'Миллиграммы', short: 'мг', factor: 0.000001 },
          { id: 'g', name: 'Граммы', short: 'г', factor: 0.001 },
          { id: 'kg', name: 'Килограммы', short: 'кг', factor: 1 },
          { id: 't', name: 'Тонны', short: 'т', factor: 1000 },
          { id: 'lb', name: 'Фунты', short: 'фунт', factor: 0.45359237 },
        ],
      },
      volume: {
        title: 'Объём',
        units: [
          { id: 'ml', name: 'Миллилитры', short: 'мл', factor: 0.001 },
          { id: 'l', name: 'Литры', short: 'л', factor: 1 },
          { id: 'm3', name: 'Кубические метры', short: 'м³', factor: 1000 },
          { id: 'gal', name: 'Галлоны США', short: 'гал', factor: 3.785411784 },
        ],
      },
      temperature: {
        title: 'Температура',
        units: [
          { id: 'c', name: 'Цельсий', short: '°C' },
          { id: 'f', name: 'Фаренгейт', short: '°F' },
          { id: 'k', name: 'Кельвин', short: 'K' },
        ],
      },
    };
    const category = unitGroups[unitCategory] || unitGroups.length;
    const units = category.units;
    const fromIndex = Math.max(0, units.findIndex(item => item.id === unitFrom));
    const toIndex = Math.max(0, units.findIndex(item => item.id === unitTo));
    const fromUnit = units[fromIndex];
    const toUnit = units[toIndex];
    const numericValue = Number(String(unitValue).replace(',', '.'));
    let convertedValue = null;
    if (Number.isFinite(numericValue) && unitValue.trim() !== '') {
      if (unitCategory === 'temperature') {
        let celsius = numericValue;
        if (unitFrom === 'f') celsius = (numericValue - 32) * 5 / 9;
        if (unitFrom === 'k') celsius = numericValue - 273.15;
        if (unitTo === 'f') convertedValue = celsius * 9 / 5 + 32;
        else if (unitTo === 'k') convertedValue = celsius + 273.15;
        else convertedValue = celsius;
      } else {
        convertedValue = numericValue * fromUnit.factor / toUnit.factor;
      }
    }
    const resultText = convertedValue === null
      ? 'Введите число'
      : Number(convertedValue.toFixed(8)).toLocaleString('ru-RU', {
        maximumFractionDigits: 8,
      });
    const changeUnit = (side, direction) => {
      const currentIndex = side === 'from' ? fromIndex : toIndex;
      const nextIndex = (currentIndex + direction + units.length) % units.length;
      if (side === 'from') setUnitFrom(units[nextIndex].id);
      else setUnitTo(units[nextIndex].id);
    };
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        {renderToolHeader()}
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: 35,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{
            color: '#BDEBFF',
            fontSize: 22,
            fontWeight: '700',
            textAlign: 'center',
            marginBottom: 18,
          }}>
            Конвертер величин
          </Text>
          <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginBottom: 22,
          }}>
            {Object.entries(unitGroups).map(([key, item]) => (
              <Pressable
                key={key}
                onPress={() => {
                  setUnitCategory(key);
                  setUnitFrom(item.units[0].id);
                  setUnitTo(item.units[Math.min(1, item.units.length - 1)].id);
                }}
                style={{
                  backgroundColor: unitCategory === key ? '#164D70' : '#111A35',
                  borderWidth: 1,
                  borderColor: unitCategory === key ? '#53CFFF' : '#293957',
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 13,
                  margin: 4,
                }}
              >
                <Text style={{
                  color: unitCategory === key ? '#FFFFFF' : '#AAB6D0',
                  fontSize: 13,
                  fontWeight: '600',
                }}>
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{
            backgroundColor: '#101A35',
            borderWidth: 1,
            borderColor: '#29476B',
            borderRadius: 18,
            padding: 16,
            marginBottom: 14,
          }}>
            <Text style={{
              color: '#8B91A8',
              fontSize: 13,
              marginBottom: 9,
            }}>
              Исходное значение
            </Text>
            <TextInput
              value={unitValue}
              onChangeText={setUnitValue}
              keyboardType="decimal-pad"
              placeholder="Введите число"
              placeholderTextColor="#68758F"
              style={{
                color: '#FFFFFF',
                fontSize: 28,
                fontWeight: '600',
                borderBottomWidth: 1,
                borderBottomColor: '#355477',
                paddingVertical: 9,
                marginBottom: 13,
              }}
            />
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#8B91A8', fontSize: 12 }}>
                  Единица измерения
                </Text>
                <Text style={{
                  color: '#BDEBFF',
                  fontSize: 17,
                  fontWeight: '600',
                  marginTop: 5,
                }}>
                  {fromUnit.name} ({fromUnit.short})
                </Text>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Pressable
                  onPress={() => changeUnit('from', -1)}
                  style={{
                    backgroundColor: '#203A5C',
                    borderRadius: 10,
                    padding: 10,
                    marginLeft: 5,
                  }}
                >
                  <Ionicons name="chevron-back" size={20} color="#BDEBFF" />
                </Pressable>
                <Pressable
                  onPress={() => changeUnit('from', 1)}
                  style={{
                    backgroundColor: '#203A5C',
                    borderRadius: 10,
                    padding: 10,
                    marginLeft: 5,
                  }}
                >
                  <Ionicons name="chevron-forward" size={20} color="#BDEBFF" />
                </Pressable>
              </View>
            </View>
          </View>
          <View style={{ alignItems: 'center', marginVertical: 3 }}>
            <Ionicons name="arrow-down-circle" size={34} color="#53CFFF" />
          </View>
          <View style={{
            backgroundColor: '#101A35',
            borderWidth: 1,
            borderColor: '#347DA6',
            borderRadius: 18,
            padding: 16,
            marginTop: 8,
          }}>
            <Text style={{
              color: '#8B91A8',
              fontSize: 13,
              marginBottom: 9,
            }}>
              Результат
            </Text>
            <Text style={{
              color: '#53CFFF',
              fontSize: 30,
              fontWeight: '700',
              marginBottom: 15,
            }}>
              {resultText}
            </Text>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#8B91A8', fontSize: 12 }}>
                  Перевести в
                </Text>
                <Text style={{
                  color: '#BDEBFF',
                  fontSize: 17,
                  fontWeight: '600',
                  marginTop: 5,
                }}>
                  {toUnit.name} ({toUnit.short})
                </Text>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Pressable
                  onPress={() => changeUnit('to', -1)}
                  style={{
                    backgroundColor: '#203A5C',
                    borderRadius: 10,
                    padding: 10,
                    marginLeft: 5,
                  }}
                >
                  <Ionicons name="chevron-back" size={20} color="#BDEBFF" />
                </Pressable>
                <Pressable
                  onPress={() => changeUnit('to', 1)}
                  style={{
                    backgroundColor: '#203A5C',
                    borderRadius: 10,
                    padding: 10,
                    marginLeft: 5,
                  }}
                >
                  <Ionicons name="chevron-forward" size={20} color="#BDEBFF" />
                </Pressable>
              </View>
            </View>
          </View>
          <Pressable
            onPress={() => {
              setUnitFrom(unitTo);
              setUnitTo(unitFrom);
            }}
            style={{
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#173451',
              borderWidth: 1,
              borderColor: '#347DA6',
              borderRadius: 14,
              paddingVertical: 12,
              paddingHorizontal: 20,
              marginTop: 18,
            }}
          >
            <Ionicons name="swap-vertical" size={19} color="#53CFFF" />
            <Text style={{
              color: '#BDEBFF',
              fontSize: 14,
              fontWeight: '600',
              marginLeft: 8,
            }}>
              Поменять единицы местами
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
  // --- КОНВЕРТЕР ВАЛЮТ ---
  if (activeScreen === 'tools' && toolScreen === 'currency') {
    const amount = Number(String(currencyAmount).replace(',', '.'));
    const availableCurrencies = CURRENCIES
      .filter(code => CURRENCY_NAMES[code])
      .sort((a, b) =>
        CURRENCY_NAMES[a].localeCompare(CURRENCY_NAMES[b], 'ru')
      );
    const fromRate = currencyRates?.[currencyFrom];
    const toRate = currencyRates?.[currencyTo];
    const convertedCurrency =
      Number.isFinite(amount) && fromRate && toRate
        ? amount * toRate / fromRate
        : null;
    const selectionMode = currencyPicker || 'from';
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        {renderToolHeader()}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.toolScrollContent, { paddingBottom: 30 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{
            backgroundColor: 'rgba(12, 24, 55, 0.88)',
            borderWidth: 1,
            borderColor: 'rgba(120, 207, 255, 0.38)',
            borderRadius: 18,
            padding: 16,
            marginBottom: 14,
          }}>
            <Text style={{
              color: '#A9C9E8',
              fontSize: 13,
              fontWeight: '600',
              marginBottom: 10,
            }}>
              СУММА ДЛЯ ОБМЕНА
            </Text>
            <TextInput
              value={currencyAmount}
              onChangeText={setCurrencyAmount}
              keyboardType="decimal-pad"
              placeholder="Введите сумму"
              placeholderTextColor="#7185A8"
              style={{
                color: '#FFFFFF',
                fontSize: 30,
                fontWeight: '700',
                paddingVertical: 5,
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(120, 207, 255, 0.35)',
              }}
            />
          </View>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
          }}>
            <Pressable
              onPress={() => {
                setCurrencyFrom(currencyTo);
                setCurrencyTo(currencyFrom);
              }}
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                borderWidth: 1,
                borderColor: '#78CFFF',
                backgroundColor: 'rgba(35, 91, 139, 0.35)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="swap-horizontal" size={23} color="#78CFFF" />
            </Pressable>
            <Pressable
              onPress={() => setCurrencyPicker('from')}
              style={{ flex: 1 }}
            >
              <Text style={{ color: '#A9C9E8', fontSize: 12 }}>ИЗ ВАЛЮТЫ</Text>
              <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>
                {currencyFrom}
              </Text>
              <Text style={{ color: '#78CFFF', fontSize: 12 }}>
                {CURRENCY_NAMES[currencyFrom] || currencyFrom}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setCurrencyPicker('to')}
              style={{ flex: 1 }}
            >
              <Text style={{ color: '#A9C9E8', fontSize: 12 }}>В ВАЛЮТУ</Text>
              <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>
                {currencyTo}
              </Text>
              <Text style={{ color: '#78CFFF', fontSize: 12 }}>
                {CURRENCY_NAMES[currencyTo] || currencyTo}
              </Text>
            </Pressable>
          </View>
          <View style={{
            marginTop: 18,
            padding: 18,
            backgroundColor: 'rgba(12, 30, 65, 0.92)',
            borderWidth: 1,
            borderColor: 'rgba(120, 207, 255, 0.55)',
            borderRadius: 18,
            alignItems: 'center',
          }}>
            <Text style={{ color: '#A9C9E8', fontSize: 13, marginBottom: 10 }}>
              РЕЗУЛЬТАТ ОБМЕНА
            </Text>
            <Text style={{
              color: '#FFFFFF',
              fontSize: 29,
              fontWeight: '800',
              textAlign: 'center',
            }}>
              {convertedCurrency === null
                ? '—'
                : `${convertedCurrency.toLocaleString('ru-RU', {
                  maximumFractionDigits: 4,
                })} ${currencyTo}`}
            </Text>
            {fromRate && toRate ? (
              <Text style={{
                color: '#78CFFF',
                fontSize: 12,
                marginTop: 10,
                textAlign: 'center',
              }}>
                1 {currencyFrom} = {(toRate / fromRate).toLocaleString('ru-RU', {
                  maximumFractionDigits: 6,
                })} {currencyTo}
              </Text>
            ) : (
              <Text style={{ color: '#A9BBD4', fontSize: 12, marginTop: 10 }}>
                Ожидание данных о курсах
              </Text>
            )}
          </View>
          {currencyPicker ? (<>
            <Text style={{
              color: '#78CFFF',
              fontSize: 14,
              fontWeight: '700',
              marginBottom: 8,
            }}>
              СПИСОК ВАЛЮТ — {availableCurrencies.length}
            </Text>
            <View style={{
              backgroundColor: 'rgba(12, 24, 55, 0.88)',
              borderWidth: 1,
              borderColor: 'rgba(120, 207, 255, 0.3)',
              borderRadius: 14,
              overflow: 'hidden',
            }}>
              {availableCurrencies.map((code, index) => {
                const selected = selectionMode === 'from'
                  ? currencyFrom === code
                  : currencyTo === code;
                return (
                  <Pressable
                    key={`currency-row-${code}`}
                    onPress={() => {
                      if (selectionMode === 'from') {
                        setCurrencyFrom(code);
                      } else {
                        setCurrencyTo(code);
                      }
                      setCurrencyPicker(null);
                    }}
                    style={{
                      minHeight: 48,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: selected
                        ? 'rgba(65, 155, 220, 0.22)'
                        : 'transparent',
                      borderBottomWidth: index === availableCurrencies.length - 1 ? 0 : 1,
                      borderBottomColor: 'rgba(120, 207, 255, 0.13)',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{
                        color: selected ? '#78CFFF' : '#FFFFFF',
                        fontSize: 15,
                        fontWeight: '800',
                      }}>
                        {code}
                      </Text>
                      <Text style={{
                        color: '#A9BBD4',
                        fontSize: 12,
                        marginTop: 2,
                      }}>
                        {CURRENCY_NAMES[code] || 'Название не указано'}
                      </Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={21} color="#78CFFF" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
          ) : null}
          <CosmicButton
            title={currencyLoading ? 'Обновление...' : 'Обновить курсы'}
            icon="refresh-outline"
            onPress={refreshCurrencyRates}
            disabled={currencyLoading}
            style={{ marginTop: 16 }}
          />
          {currencyLoading ? (
            <ActivityIndicator
              color="#78CFFF"
              size="small"
              style={{ marginTop: 14 }}
            />
          ) : null}
          {currencyDate ? (
            <Text style={styles.currencyDate}>
              Дата курсов: {currencyDate}
            </Text>
          ) : null}
          {currencyError ? (
            <Text style={styles.warningText}>{currencyError}</Text>
          ) : null}
          <Text style={styles.currencyDisclaimer}>
            Справочные курсы Frankfurter. Они обновляются по рабочим дням
            и могут отличаться от курсов банков и обменных пунктов.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }
  // --- ТАЙМЕР И СЕКУНДОМЕР ---
  if (activeScreen === 'tools' && toolScreen === 'timer') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        {renderToolHeader()}
        <View style={styles.contentContainer}>
          <View style={styles.categoryRow}>
            <Pressable
              onPress={() => setTimerTab('timer')}
              style={[
                styles.categoryButton,
                timerTab === 'timer' && styles.categoryButtonActive,
              ]}
            >
              <Text style={styles.categoryButtonText}>Таймер</Text>
            </Pressable>
            <Pressable
              onPress={() => setTimerTab('stopwatch')}
              style={[
                styles.categoryButton,
                timerTab === 'stopwatch' && styles.categoryButtonActive,
              ]}
            >
              <Text style={styles.categoryButtonText}>Секундомер</Text>
            </Pressable>
          </View>
          {timerTab === 'timer' ? (
            <View style={styles.timerContent}>
              <Text style={styles.timerDisplay}>
                {formatClock(timerRemaining * 1000).slice(0, 8)}
              </Text>
              {!timerRunning ? (
                <View style={styles.timerInputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Минуты</Text>
                    <TextInput
                      value={timerMinutes}
                      onChangeText={setTimerMinutes}
                      keyboardType="number-pad"
                      style={styles.valueInput}
                      placeholder="Мин"
                      placeholderTextColor="#8B91A8"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Секунды</Text>
                    <TextInput
                      value={timerSeconds}
                      onChangeText={setTimerSeconds}
                      keyboardType="number-pad"
                      style={styles.valueInput}
                      placeholder="Сек"
                      placeholderTextColor="#8B91A8"
                    />
                  </View>
                </View>
              ) : (
                <Text style={styles.timerCaption}>Таймер запущен</Text>
              )}
              <View style={styles.timerButtons}>
                {!timerRunning ? (
                  <CosmicButton
                    title="Старт"
                    icon="play"
                    onPress={startTimer}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <CosmicButton
                    title="Пауза"
                    icon="pause"
                    onPress={stopTimer}
                    style={{ flex: 1 }}
                  />
                )}
                <CosmicButton
                  title="Сброс"
                  icon="refresh"
                  onPress={resetTimer}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <View style={styles.timerContent}>
              <Text style={styles.timerDisplay}>
                {formatClock(stopwatchElapsed)}
              </Text>
              <View style={styles.timerButtons}>
                {!stopwatchRunning ? (
                  <CosmicButton
                    title="Старт"
                    icon="play"
                    onPress={() => {
                      setStopwatchStartedAt(
                        Date.now() - stopwatchElapsed
                      );
                      setStopwatchRunning(true);
                    }}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <CosmicButton
                    title="Пауза"
                    icon="pause"
                    onPress={() => {
                      setStopwatchElapsed(
                        Date.now() - stopwatchStartedAt
                      );
                      setStopwatchRunning(false);
                      setStopwatchStartedAt(null);
                    }}
                    style={{ flex: 1 }}
                  />
                )}
                <CosmicButton
                  title="Сброс"
                  icon="refresh"
                  onPress={() => {
                    setStopwatchRunning(false);
                    setStopwatchStartedAt(null);
                    setStopwatchElapsed(0);
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }
  // --- КАЛЬКУЛЯТОР ---
  if (activeScreen === 'tools' && toolScreen === 'calculator') {
    const calculatorButtons = [
      ['C', '⌫', '%', '÷'],
      ['7', '8', '9', '×'],
      ['4', '5', '6', '-'],
      ['1', '2', '3', '+'],
      ['0', '.', '(', ')'],
      ['='],
    ];
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        {renderToolHeader()}
        <View style={styles.contentContainer}>
          <View style={styles.calculatorDisplay}>
            <Text style={styles.calculatorExpression} numberOfLines={2}>
              {calculatorValue}
            </Text>
          </View>
          <View style={styles.calculatorGrid}>
            {calculatorButtons.map((row, rowIndex) => (
              <View key={`calc-row-${rowIndex}`} style={styles.calculatorRow}>
                {row.map((button) => (
                  <Pressable
                    key={`calc-${button}`}
                    onPress={() => pressCalculator(button)}
                    style={({ pressed }) => [
                      styles.calculatorButton,
                      button === '=' && styles.calculatorEquals,
                      ['C', '⌫'].includes(button) && styles.calculatorSpecial,
                      pressed && styles.cosmicButtonPressed,
                      button === '=' && row.length === 1 && {
                        flex: 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.calculatorButtonText,
                        button === '=' && { color: '#FFFFFF' },
                      ]}
                    >
                      {button}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }
  // --- ЭКРАН DEEPSEEK ---
  if (activeScreen === 'deepseek') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#05091D" />
        <StarBackground />
        <View style={styles.topNav}>
          <CosmicButton
            title="Назад"
            icon="arrow-back"
            onPress={() => setActiveScreen('start')}
            style={{ flex: 1 }}
          />
          <View style={{ width: 10 }} />
          <CosmicButton
            title="Заметки"
            icon="document-text-outline"
            onPress={() => setActiveScreen('notes')}
            style={{ flex: 1 }}
          />
        </View>
        <View style={styles.contentContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.screenTitle}>DeepSeek</Text>
            <CosmicButton
              title="Открыть в браузере"
              onPress={() =>
                Linking.openURL('https://chat.deepseek.com/').catch(
                  (error) => console.warn('Не удалось открыть браузер', error)
                )
              }
              isSolidBlue
            />
          </View>
          <View style={styles.deepSeekWrapper}>
            <View pointerEvents="none" style={styles.cosmicInnerFrame} />
            {Platform.OS === 'web' ? (
              <View style={styles.webFallback}>
                <Text style={styles.webFallbackText}>
                  Веб-версия DeepSeek запрещает отображение внутри другого
                  сайта. Нажми кнопку выше, чтобы открыть чат в новой вкладке.
                </Text>
              </View>
            ) : (
              deepSeekUrlLoaded && (
                <WebView
                  source={{ uri: deepSeekUrl }}
                  style={{ flex: 1, backgroundColor: '#000' }}
                  javaScriptEnabled
                  domStorageEnabled
                  onNavigationStateChange={(navState) =>
                    rememberDeepSeekUrl(navState?.url)
                  }
                  startInLoadingState
                  renderLoading={() => (
                    <View style={styles.loading}>
                      <Text style={{ color: '#FFF' }}>Загрузка...</Text>
                    </View>
                  )}
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
  safe: {
    flex: 1,
    backgroundColor: '#05091D',
  },
  stars: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    zIndex: 0,
  },
  nebulaOne: {
    position: 'absolute',
    width: 270,
    height: 360,
    borderRadius: 180,
    top: '20%',
    left: '-35%',
    backgroundColor: '#24145C',
    opacity: 0.22,
    transform: [{ rotate: '35deg' }],
  },
  nebulaTwo: {
    position: 'absolute',
    width: 240,
    height: 300,
    borderRadius: 160,
    top: '48%',
    right: '-40%',
    backgroundColor: '#102F77',
    opacity: 0.18,
    transform: [{ rotate: '-35deg' }],
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  mainButtons: {
    width: '100%',
    paddingHorizontal: 30,
    gap: 16,
    marginTop: 10,
  },
  cosmicButton: {
    minHeight: 52,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 9,
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
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(189,235,255,0.38)',
    borderRadius: 5,
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
  topNav: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(73,120,210,0.35)',
    backgroundColor: 'rgba(5,9,29,0.88)',
    zIndex: 5,
    alignItems: 'center',
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
    zIndex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222A50',
  },
  screenTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  subHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  dateText: {
    color: '#9DA9D0',
    fontSize: 11,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  editorToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  editorHint: {
    color: '#A5AFD5',
    fontSize: 13,
    flex: 1,
  },
  micButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(7,20,48,0.94)',
  },
  micButtonActive: {
    borderColor: '#FF9AA9',
    backgroundColor: 'rgba(90,20,45,0.45)',
  },
  micButtonText: {
    color: '#DDF5FF',
    fontSize: 12,
    fontWeight: '700',
  },
  listeningText: {
    color: '#FFB6C1',
    fontSize: 12,
    marginBottom: 8,
  },
  editorWrapper: {
    flex: 1,
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 9,
    backgroundColor: 'rgba(7,20,48,0.28)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 4,
    overflow: 'hidden',
  },
  editorInput: {
    flex: 1,
    minHeight: 120,
    color: '#EAF3FF',
    fontSize: 16,
    lineHeight: 24,
    padding: 16,
    textAlignVertical: 'top',
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
    gap: 10,
  },
  noteCardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  noteCardDate: {
    color: '#A5AFD5',
    fontSize: 11,
    marginBottom: 6,
  },
  noteCardPreview: {
    color: '#B9C4E7',
    fontSize: 13,
  },
  emptyText: {
    color: '#A5AFD5',
    textAlign: 'center',
    marginTop: 40,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,210,138,0.5)',
    backgroundColor: 'rgba(90,60,20,0.25)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  warningText: {
    color: '#FFD28A',
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
    marginTop: 8,
  },
  // --- ИНСТРУМЕНТЫ ---
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 0,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  toolButton: {
    width: '48%',
    height: 112,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#78CFFF',
    backgroundColor: 'rgba(7,20,48,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 8,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 10,
    elevation: 6,
  },
  toolInnerFrame: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 5,
    bottom: 5,
    borderWidth: 1,
    borderColor: 'rgba(189,235,255,0.32)',
    borderRadius: 13,
  },
  toolButtonText: {
    color: '#DDF5FF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  toolScrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
  },
  smallIconButton: {
    width: 48,
    minHeight: 44,
    paddingHorizontal: 0,
  },
  // --- КАЛЕНДАРЬ ---
  calendarMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  calendarMonthTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(120,207,255,0.2)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  calendarWeekCell: {
    width: '14.2857%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(25,45,90,0.8)',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(120,207,255,0.2)',
  },
  calendarWeekText: {
    color: '#BDEBFF',
    fontSize: 12,
    fontWeight: '700',
  },
  calendarDay: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(120,207,255,0.2)',
  },
  calendarDaySelected: {
    backgroundColor: '#376BFF',
  },
  calendarDayToday: {
    backgroundColor: 'rgba(56,189,248,0.22)',
  },
  calendarDayText: {
    color: '#EAF3FF',
    fontSize: 14,
  },
  calendarSelectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    marginTop: 22,
    borderWidth: 1,
    borderColor: '#293765',
    borderRadius: 10,
    backgroundColor: 'rgba(20,35,75,0.65)',
  },
  calendarSelectedText: {
    color: '#DDF5FF',
    fontSize: 14,
    flex: 1,
  },
  // --- КОНВЕРТЕРЫ ---
  categoryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  categoryButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#45618E',
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: 'rgba(7,20,48,0.85)',
  },
  categoryButtonActive: {
    borderColor: '#78CFFF',
    backgroundColor: 'rgba(35,90,145,0.75)',
  },
  categoryButtonText: {
    color: '#B9C4E7',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  fieldLabel: {
    color: '#BDEBFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 8,
  },
  valueInput: {
    minHeight: 52,
    color: '#FFFFFF',
    fontSize: 18,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 9,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(7,20,48,0.85)',
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: '#45618E',
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: 'rgba(7,20,48,0.85)',
  },
  optionButtonActive: {
    borderColor: '#78CFFF',
    backgroundColor: 'rgba(35,90,145,0.8)',
  },
  optionText: {
    color: '#DDF5FF',
    fontSize: 12,
  },
  resultBox: {
    marginTop: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 12,
    backgroundColor: 'rgba(15,40,85,0.72)',
    alignItems: 'center',
  },
  resultCaption: {
    color: '#A5AFD5',
    fontSize: 13,
    textAlign: 'center',
  },
  resultValue: {
    color: '#FFFFFF',
    fontSize: 27,
    fontWeight: '800',
    textAlign: 'center',
    marginVertical: 10,
  },
  currencySwapRow: {
    alignItems: 'center',
    marginVertical: 14,
  },
  currencyDate: {
    color: '#A5AFD5',
    textAlign: 'center',
    fontSize: 12,
    marginTop: 12,
  },
  currencyDisclaimer: {
    color: '#8795BC',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 18,
  },
  // --- ТАЙМЕР И СЕКУНДОМЕР ---
  timerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 30,
  },
  timerDisplay: {
    color: '#FFFFFF',
    fontSize: 43,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginBottom: 28,
  },
  timerCaption: {
    color: '#A5AFD5',
    fontSize: 14,
    marginBottom: 20,
  },
  timerInputRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 24,
  },
  timerButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 10,
  },
  // --- КАЛЬКУЛЯТОР ---
  calculatorDisplay: {
    minHeight: 110,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 18,
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 12,
    backgroundColor: 'rgba(7,20,48,0.9)',
    marginBottom: 16,
  },
  calculatorExpression: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'right',
  },
  calculatorGrid: {
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  calculatorRow: {
    flexDirection: 'row',
    gap: 9,
    flex: 1,
    marginBottom: 9,
  },
  calculatorButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#78CFFF',
    borderRadius: 12,
    backgroundColor: 'rgba(7,20,48,0.94)',
  },
  calculatorSpecial: {
    borderColor: '#A5AFD5',
    backgroundColor: 'rgba(35,45,85,0.9)',
  },
  calculatorEquals: {
    borderColor: '#78CFFF',
    backgroundColor: '#376BFF',
  },
  calculatorButtonText: {
    color: '#DDF5FF',
    fontSize: 23,
    fontWeight: '700',
  },
  // --- DEEPSEEK ---
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
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#05091D',
  },
  webFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  webFallbackText: {
    color: '#B9C4E7',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
