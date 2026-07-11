/**
 * InventoryScreen
 *
 * Project inventory module for mobile. Shows Items and Logs, supports receiving,
 * consumption, and defective/spoilage logs, and applies role-based edit/log rules.
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, apiFetch } from '../../lib/api';
import { getPermissions, type UserRole } from '../../constants/roles';
import { ACTION_TYPE_LABELS, ACTION_TYPE_COLORS } from '../../constants/constants';
import { useAppTheme } from '../../contexts/ThemeContext';
import BottomNavigationBar, { getBottomNavContentPadding, MainTab } from '../../components/BottomNavigationBar';
import { InventoryItemSkeleton, InventoryLogSkeleton } from '../../components/skeletons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { centeredContent } from '../../utils/responsive';
import { formatCurrencyPHP } from '../../utils/budget';
import { formatDisplayLabel } from '../../utils/display';
import { INACTIVE_PROJECT_INVENTORY_MESSAGE, isActiveProjectStatus } from '../../utils/projectProgress';
import { qaDebug } from '../../utils/qaDebug';
import SuccessModal from '../../components/SuccessModal';
import SystemBars from '../../components/SystemBars';

interface InventoryItem {
  id: number;
  project_id: number;
  item_name: string;
  category: string;
  quantity: number | string;
  critical_level: number | string;
  price: number | string;
  unit?: string;
}

interface InventoryLog {
  id: number;
  item_id: number;
  action_type: string;
  quantity: number | string;
  notes?: string | null;
  created_at: string;
  item_name: string;
  unit?: string | null;
  project_name?: string | null;
  location?: string | null;
  actor_name?: string | null;
}

interface Props {
  projectId: number;
  projectName?: string | null;
  projectLocation?: string | null;
  projectStatus?: string | null;
  onBack: () => void;
  userRole?: UserRole;
  activeMainTab?: MainTab;
  canViewHome?: boolean;
  unreadCount?: number;
  onNavigate?: (tab: MainTab) => void;
  showBottomNav?: boolean;
  highlightItemId?: number | null;
}

function parseInventoryNumber(value: number | string | null | undefined) {
  // Inventory values can arrive as strings from SQL/JSON; normalize before validation or display.
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function inventoryNumberInput(value: string) {
  return value.replace(/\D/g, '');
}

function displayInventoryNumber(value: number | string | null | undefined, fallback = '0') {
  const parsed = parseInventoryNumber(value);
  if (parsed === null) return fallback;
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function stockStatus(qty: number | string, critical: number | string): { label: string; bg: string } {
  const q = parseInventoryNumber(qty) ?? 0;
  const c = parseInventoryNumber(critical) ?? 0;
  if (q <= 0) return { label: 'Out of Stock', bg: '#FF6B6B' };
  if (q <= c) return { label: 'Low Stock', bg: '#FF9F43' };
  return { label: 'In Stock', bg: '#5DBF50' };
}

function normalizeCategoryName(cat: string) {
  const c = String(cat || '').trim().toLowerCase();
  if (c === 'equipment' || c === 'equipments') return 'equipment';
  if (c === 'tools' || c === 'others') return 'others';
  return c;
}

function formatCategory(cat: string) {
  const c = String(cat || '').trim().toLowerCase();
  if (c === 'materials') return 'Materials';
  if (c === 'equipment' || c === 'equipments') return 'Equipment';
  if (c === 'tools' || c === 'others') return 'Others';
  return cat;
}

const PREDEFINED_ITEMS: Record<string, string> = {
  Cement: 'Materials',
  'Extension Wire': 'Others',
  'Glass Panels': 'Materials',
  'Welding Machine': 'Equipment',
};

const LOCAL_ACTION_LABELS: Record<string, string> = {
  // "SPOILAGE" is stored as the system action but shown as "Defective" for users.
  RECEIVING: 'Receiving',
  CONSUMPTION: 'Consumption',
  SPOILAGE: 'Defective',
  ADJUSTMENT: 'Adjustment',
  add_item: 'Added',
  update_stock: 'Stock Updated',
  delete_item: 'Deleted',
  consume: 'Consumed',
  return: 'Returned',
  correction: 'Corrected',
};

const MOBILE_ACTION_TYPES = ['RECEIVING', 'CONSUMPTION', 'SPOILAGE'] as const;
// NOTE: Mobile inventory logs support Receiving, Consumption, and Defective (stored as SPOILAGE).
type MobileActionType = (typeof MOBILE_ACTION_TYPES)[number];

const INVENTORY_VIEW_ONLY_MESSAGE = 'You have view-only access to Inventory.';
const INVENTORY_NO_ACCESS_MESSAGE = 'You do not have permission to access Inventory.';

export default function InventoryScreen({
  projectId,
  projectName,
  projectLocation,
  projectStatus,
  onBack,
  userRole,
  activeMainTab = 'home',
  canViewHome = true,
  unreadCount = 0,
  onNavigate,
  showBottomNav = false,
  highlightItemId = null,
}: Props) {
  const perms = getPermissions(userRole);
  const canView = perms.canViewInventory;
  const canEdit = perms.canEditInventory;
  const canAdd = perms.canAddInventory;
  // Some field roles can log consumption for assigned inventory without full edit permission.
  const canLogUsage = perms.canLogInventoryUsage && !canEdit;
  const canRecordInventoryLog = canEdit || canLogUsage;
  const canWriteInventory = canEdit || canAdd || canLogUsage;
  const isProjectActive = projectStatus === undefined || projectStatus === null || isActiveProjectStatus(projectStatus);
  const canMutateInventory = canWriteInventory && isProjectActive;
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const screenContentStyle = centeredContent(width);
  const headerTopPadding = Math.max(insets.top + 10, Platform.OS === 'ios' ? 64 : 20);
  const bottomNavContentPadding = getBottomNavContentPadding(insets.bottom);
  const screenBottomPadding = 100 + insets.bottom;

  const [activeTab, setActiveTab] = useState<'items' | 'logs'>('items');
  // NOTE: Items and Logs are separated so stock levels and audit history stay easy to explain.
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedAction, setSelectedAction] = useState('all');
  const [showLogTypeDropdown, setShowLogTypeDropdown] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCategory, setAddCategory] = useState('Materials');
  const [addCritical, setAddCritical] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  // Transaction modal state
  const [showTransaction, setShowTransaction] = useState(false);
  const [txnItem, setTxnItem] = useState<InventoryItem | null>(null);
  const [txnAction, setTxnAction] = useState<MobileActionType>('RECEIVING');
  const [txnQty, setTxnQty] = useState('');
  const [txnNotes, setTxnNotes] = useState('');
  const [txnTaskId, setTxnTaskId] = useState('');
  const [projectTasks, setProjectTasks] = useState<{id: number; title: string}[]>([]);
  const [showAddLog, setShowAddLog] = useState(false);
  const [logItemId, setLogItemId] = useState('');
  const [logActionType, setLogActionType] = useState<MobileActionType>('RECEIVING');
  const [logQty, setLogQty] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [logTaskId, setLogTaskId] = useState('');

  // Success modal state
  const [successModal, setSuccessModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    buttonLabel: string;
    onPress: () => void;
  }>({ visible: false, title: '', message: '', buttonLabel: '', onPress: () => {} });

  const categories = ['All', 'Materials', 'Equipment', 'Others'];
  const actionTypes = ['all', ...MOBILE_ACTION_TYPES];

  const readErrorMessage = async (response: Response, fallback: string) => {
    const data = await response.json().catch(() => null);
    return data?.message || data?.error || fallback;
  };

  const fetchItems = async () => {
    const q = new URLSearchParams({
      projectId: String(projectId),
    });
    const response = await apiFetch(`${API_URL}/inventory?${q.toString()}`);
    if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load inventory items.'));
    return response.json();
  };

  const fetchLogs = async () => {
    const q = new URLSearchParams({
      projectId: String(projectId),
      search: search.trim(),
      actionType: selectedAction,
    });
    const response = await apiFetch(`${API_URL}/inventory/logs?${q.toString()}`);
    if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load inventory logs.'));
    return response.json();
  };

  const load = async (showSkeleton = true) => {
    qaDebug('Inventory permission result', { projectId, canView, canEdit, canLogUsage });
    if (!canView) return;
    setError(null);
    if (showSkeleton) setLoading(true);
    try {
      const [itemsData, logsData] = await Promise.all([fetchItems(), fetchLogs()]);
      setItems(Array.isArray(itemsData) ? itemsData : []);
      setLogs(Array.isArray(logsData) ? logsData : []);
      qaDebug('Inventory loaded', {
        projectId,
        itemCount: Array.isArray(itemsData) ? itemsData.length : 0,
        logCount: Array.isArray(logsData) ? logsData.length : 0,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not load inventory data.');
    } finally {
      if (showSkeleton) setLoading(false);
    }
  };

  const refresh = async () => {
    if (!canView) return;
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      setRefreshing(false);
    }
  };

  const safeProjectTasks = Array.isArray(projectTasks) ? projectTasks : [];
  const displayProjectName = projectName || 'Current Project';
  const displayProjectLocation = projectLocation || 'No location set';
  const displayActorName = 'Current user';

  // Fetch tasks for CONSUMPTION task-linking
  const fetchTasks = async () => {
    if (!canView) return;
    try {
      const res = await apiFetch(`${API_URL}/tasks/project/${projectId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to fetch project tasks.');
      }
      const nextTasks = Array.isArray(data) ? data : [];

      setProjectTasks(Array.isArray(nextTasks) ? nextTasks : []);
    } catch (err) {
      console.warn('Failed to fetch tasks for linking:', err);
      setProjectTasks([]);
    }
  };

  useEffect(() => {
    if (!canView) return;
    load();
    fetchTasks();
  }, [canView, projectId, selectedAction]);

  useEffect(() => {
    if (!canView) {
      Alert.alert('Access denied', INVENTORY_NO_ACCESS_MESSAGE, [
        { text: 'OK', onPress: onBack },
      ]);
    }
  }, [canView, onBack]);

  useEffect(() => {
    if (highlightItemId) {
      setActiveTab('items');
    }
  }, [highlightItemId]);

  const resetAddItemForm = () => {
    setAddName('');
    setAddCategory('Materials');
    setAddCritical('');
    setAddPrice('');
    setShowCategoryDropdown(false);
  };

  const resetTransactionForm = () => {
    setTxnItem(null);
    setTxnAction(canLogUsage ? 'CONSUMPTION' : 'RECEIVING');
    setTxnQty('');
    setTxnNotes('');
    setTxnTaskId('');
  };

  const resetAddLogForm = () => {
    setLogItemId('');
    setLogActionType(canLogUsage ? 'CONSUMPTION' : 'RECEIVING');
    setLogQty('');
    setLogNotes('');
    setLogTaskId('');
  };

  const hasAddItemDraft = () =>
    Boolean(
      addName.trim() ||
      addCritical.trim() ||
      addPrice.trim() ||
      addCategory !== 'Materials'
    );

  const hasTransactionDraft = () =>
    Boolean(txnItem || txnAction !== 'RECEIVING' || txnQty.trim() || txnNotes.trim() || txnTaskId);

  const hasAddLogDraft = () =>
    Boolean(logItemId || logActionType !== 'RECEIVING' || logQty.trim() || logNotes.trim() || logTaskId);

  const confirmDiscard = (hasDraft: boolean, onDiscard: () => void) => {
    if (!hasDraft) {
      onDiscard();
      return;
    }

    Alert.alert(
      'Discard changes?',
      'Your entered inventory details will not be saved.',
      [
        { text: 'Continue Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onDiscard },
      ]
    );
  };

  const showViewOnlyMessage = () => {
    Alert.alert('View only', INVENTORY_VIEW_ONLY_MESSAGE);
  };

  const blockInventoryWrite = () => {
    Alert.alert(
      isProjectActive ? 'Access denied' : 'Project not active',
      isProjectActive
        ? canView ? INVENTORY_VIEW_ONLY_MESSAGE : INVENTORY_NO_ACCESS_MESSAGE
        : INACTIVE_PROJECT_INVENTORY_MESSAGE
    );
    return false;
  };

  const ensureCanAddInventory = () => (canAdd && isProjectActive ? true : blockInventoryWrite());
  const ensureCanEditInventory = () => (canEdit && isProjectActive ? true : blockInventoryWrite());
  const ensureCanRecordInventoryLog = (action: MobileActionType) => {
    // NOTE: Usage-only roles may record Consumption, but cannot receive, spoil, or edit stock.
    if (!isProjectActive) return blockInventoryWrite();
    if (canEdit) return true;
    if (canLogUsage && action === 'CONSUMPTION') return true;
    return blockInventoryWrite();
  };

  const closeAddItemModal = () => {
    confirmDiscard(hasAddItemDraft(), () => {
      setShowAdd(false);
      resetAddItemForm();
    });
  };

  const closeTransactionModal = () => {
    confirmDiscard(hasTransactionDraft(), () => {
      setShowTransaction(false);
      resetTransactionForm();
    });
  };

  const closeAddLogModal = () => {
    confirmDiscard(hasAddLogDraft(), () => {
      setShowAddLog(false);
      resetAddLogForm();
    });
  };

  const getTransactionConfirmation = (action: MobileActionType) => {
    switch (action) {
      case 'CONSUMPTION':
        return {
          title: 'Confirm inventory log?',
          message: 'This will permanently reduce stock and link the log to the selected task. Inventory logs cannot be edited after saving, so please check that the item, quantity, and notes are correct.',
        };
      case 'SPOILAGE':
        return {
          title: 'Confirm inventory log?',
          message: 'This will permanently reduce stock for defective items. Inventory logs cannot be edited after saving, so please check that the item, quantity, and notes are correct.',
        };
      default:
        return {
          title: 'Confirm inventory log?',
          message: 'This will permanently increase stock. Inventory logs cannot be edited after saving, so please check that the item, quantity, and notes are correct.',
        };
    }
  };

  const submitAdd = async () => {
    if (!ensureCanAddInventory()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          itemName: addName,
          category: addCategory,
          quantity: 0,
          criticalLevel: parseInventoryNumber(addCritical) ?? 0,
          price: parseInventoryNumber(addPrice) ?? 0,
          unit: 'pcs',
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Unable to add inventory item.'));
      setShowAdd(false);
      resetAddItemForm();
      await load();
      setSuccessModal({
        visible: true,
        title: 'Item added!',
        message: "Item is now visible in this project's inventory.",
        buttonLabel: 'Back to Inventory',
        onPress: () => {
          setSuccessModal((prev) => ({ ...prev, visible: false }));
          setActiveTab('items');
        },
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to add item.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!ensureCanAddInventory()) return;
    if (!addName.trim()) return Alert.alert('Required', 'Item name is required.');
    
    const crit = parseInventoryNumber(addCritical);
    if (crit === null || crit < 0) return Alert.alert('Required', 'Minimum stock must be a non-negative number.');
    
    const price = parseInventoryNumber(addPrice);
    if (price === null || price < 0) return Alert.alert('Required', 'Price must be a non-negative number.');

    Alert.alert(
      'Confirm inventory item?',
      'Please review the details before saving.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm Save', onPress: submitAdd },
      ]
    );
  };

  // ── Phase 2: Record Transaction (replaces direct stock edits) ──
  const submitTransaction = async () => {
    if (!ensureCanRecordInventoryLog(txnAction)) return;
    if (!txnItem) return;
    const completeTransactionFlow = async () => {
      setShowTransaction(false);
      resetTransactionForm();
      await load().catch(() => undefined);
      setSuccessModal({
        visible: true,
        title: 'Log added!',
        message: 'Inventory log has been recorded successfully.',
        buttonLabel: 'Back to Logs',
        onPress: () => {
          setSuccessModal((prev) => ({ ...prev, visible: false }));
          setActiveTab('logs');
        },
      });
    };
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/inventory/${txnItem.id}/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: txnAction,
          quantity: parseInventoryNumber(txnQty) ?? 0,
          reference_task_id: txnAction === 'CONSUMPTION' ? txnTaskId : undefined,
          notes: txnNotes || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Material usage could not be recorded. Please try again.'));
      }
      const result = await res.json().catch(() => null);
      if (result?.success === false) throw new Error(result.message || 'Material usage could not be recorded. Please try again.');
      await completeTransactionFlow();
    } catch (err: any) {
      console.warn('INVENTORY_CONSUMPTION_ERROR:', err?.message || err);
      Alert.alert('Could not record usage', err?.message || 'Material usage could not be recorded. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTransaction = async () => {
    // NOTE: Consumption logs require a task link so material usage is traceable to work performed.
    if (!ensureCanRecordInventoryLog(txnAction)) return;
    if (!txnItem) return;
    const qty = parseInventoryNumber(txnQty);
    if (!qty || qty <= 0) return Alert.alert('Required', 'Quantity must be greater than 0.');
    if (txnItem.unit === 'pcs' && !Number.isInteger(qty)) return Alert.alert('Invalid quantity', 'Pieces must be entered as a whole number.');
    if (qty > (parseInventoryNumber(txnItem.quantity) ?? 0)) return Alert.alert('Insufficient stock', 'Quantity cannot exceed current stock.');
    if (txnAction === 'CONSUMPTION' && !txnTaskId) {
      return Alert.alert('Task Required', 'You must select a task for material consumption.');
    }

    const confirmation = getTransactionConfirmation(txnAction);
    Alert.alert(confirmation.title, confirmation.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm Save', onPress: submitTransaction },
    ]);
  };

  const handleDelete = (id: number) => {
    if (!ensureCanEditInventory()) return;
    Alert.alert('Delete Item', 'Delete this inventory item?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(`${API_URL}/inventory/${id}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) throw new Error(await readErrorMessage(res, 'Delete failed.'));
            Alert.alert('Success', 'Inventory item deleted.');
            await load();
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to delete item.');
          }
        },
      },
    ]);
  };

  const submitAddLog = async () => {
    if (!ensureCanRecordInventoryLog(logActionType)) return;
    const completeAddLogFlow = async () => {
      setShowAddLog(false);
      resetAddLogForm();
      await load().catch(() => undefined);
      setSuccessModal({
        visible: true,
        title: 'Log added!',
        message: 'Inventory log has been recorded successfully.',
        buttonLabel: 'Back to Logs',
        onPress: () => {
          setSuccessModal((prev) => ({ ...prev, visible: false }));
          setActiveTab('logs');
        },
      });
    };
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/inventory/${logItemId}/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: logActionType,
          quantity: parseInventoryNumber(logQty) ?? 0,
          reference_task_id: logActionType === 'CONSUMPTION' ? logTaskId : undefined,
          notes: logNotes || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Material usage could not be recorded. Please try again.'));
      }
      const result = await res.json().catch(() => null);
      if (result?.success === false) throw new Error(result.message || 'Material usage could not be recorded. Please try again.');
      await completeAddLogFlow();
    } catch (err: any) {
      console.warn('INVENTORY_LOG_ERROR:', err?.message || err);
      Alert.alert('Could not record usage', err?.message || 'Material usage could not be recorded. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLog = async () => {
    if (!ensureCanRecordInventoryLog(logActionType)) return;
    if (!logItemId || !logQty) {
      return Alert.alert('Required', 'Please select item and quantity.');
    }
    const qty = parseInventoryNumber(logQty);
    if (!qty || qty <= 0) return Alert.alert('Required', 'Quantity must be greater than 0.');
    const selectedLogItem = items.find((item) => String(item.id) === String(logItemId));
    if (selectedLogItem?.unit === 'pcs' && !Number.isInteger(qty)) return Alert.alert('Invalid quantity', 'Pieces must be entered as a whole number.');
    if (selectedLogItem && qty > (parseInventoryNumber(selectedLogItem.quantity) ?? 0)) return Alert.alert('Insufficient stock', 'Quantity cannot exceed current stock.');
    if (logActionType === 'CONSUMPTION' && !logTaskId) {
      return Alert.alert('Task Required', 'You must select a task for material consumption.');
    }

    const confirmation = getTransactionConfirmation(logActionType);
    Alert.alert(confirmation.title, confirmation.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm Save', onPress: submitAddLog },
    ]);
  };

  const filteredItems = useMemo(
    () =>
      items
        .filter((i) => selectedCategory === 'All' || normalizeCategoryName(i.category || '') === normalizeCategoryName(selectedCategory))
        .filter((i) => i.item_name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => Number(b.id) - Number(a.id)),
    [items, selectedCategory, search]
  );

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (!search.trim()) return true;
      return l.item_name?.toLowerCase().includes(search.toLowerCase());
    });
  }, [logs, search]);

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    backgroundColor: theme.input,
    fontSize: 14,
    color: theme.text,
    marginBottom: 10,
  } as const;
  const availableActionTypes = canLogUsage ? (['CONSUMPTION'] as const) : MOBILE_ACTION_TYPES;

  if (!canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: theme.background }}>
        <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
        <Ionicons name="lock-closed-outline" size={42} color={theme.textMuted} />
        <Text className="mt-4 text-center text-[16px] font-semibold" style={{ color: theme.text }}>
          {INVENTORY_NO_ACCESS_MESSAGE}
        </Text>
        <TouchableOpacity onPress={onBack} className="mt-5 rounded-xl px-5 py-3" style={{ backgroundColor: theme.primary }}>
          <Text className="font-semibold text-white">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <SystemBars
        backgroundColor={theme.background}
        navigationBarColor={showBottomNav ? theme.tabBar : theme.background}
        navigationBarStyle={showBottomNav ? (isDark ? 'light' : 'dark') : undefined}
        style={isDark ? 'light' : 'dark'}
      />
      <View
        className="flex-row items-center pb-3"
        style={[screenContentStyle, { paddingTop: headerTopPadding }]}>
        <TouchableOpacity onPress={onBack} className="mr-3 -ml-2 h-10 w-8 items-center justify-center">
          <Ionicons name="caret-back-outline" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text className="text-[28px] font-bold" style={{ color: theme.primary }}>Inventory</Text>
        {!canMutateInventory && (
          <View className="ml-3 rounded-full px-2.5 py-1" style={{ backgroundColor: theme.primaryLight }}>
            <Text className="text-[10px] font-bold uppercase" style={{ color: theme.primary }}>
              {isProjectActive ? 'View only' : 'Read only'}
            </Text>
          </View>
        )}
        {canLogUsage && (
          <View className="ml-3 rounded-full px-2.5 py-1" style={{ backgroundColor: theme.primaryLight }}>
            <Text className="text-[10px] font-bold" style={{ color: theme.primary }}>Usage only</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={refresh}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: theme.input }}
          accessibilityLabel="Refresh"
        >
          <Ionicons name="refresh" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      <View className="pb-2" style={screenContentStyle}>
        {!isProjectActive && (
          <View className="mb-2 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.warning || theme.border }}>
            <Text className="text-[12px] font-semibold leading-5" style={{ color: theme.textSecondary }}>
              {INACTIVE_PROJECT_INVENTORY_MESSAGE}
            </Text>
          </View>
        )}

        <View className="mb-1.5 flex-row rounded-full border p-1" style={{ backgroundColor: theme.input, borderColor: theme.border }}>
          <TouchableOpacity
            className="flex-1 rounded-full py-1.5"
            style={{ backgroundColor: activeTab === 'items' ? theme.primary : 'transparent' }}
            onPress={() => setActiveTab('items')}>
            <Text className="text-center text-[13px] font-semibold" style={{ color: activeTab === 'items' ? '#FFFFFF' : theme.textSecondary }}>Items</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 rounded-full py-1.5"
            style={{ backgroundColor: activeTab === 'logs' ? theme.primary : 'transparent' }}
            onPress={() => setActiveTab('logs')}>
            <Text className="text-center text-[13px] font-semibold" style={{ color: activeTab === 'logs' ? '#FFFFFF' : theme.textSecondary }}>Logs</Text>
          </TouchableOpacity>
        </View>

        <View className="mb-1.5 flex-row items-center rounded-xl border px-3" style={{ backgroundColor: theme.input, borderColor: theme.border }}>
          <Ionicons name="search" size={15} color={theme.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={activeTab === 'items' ? 'Search item name...' : 'Search log item...'}
            placeholderTextColor={theme.textMuted}
            className="ml-2 h-10 flex-1 text-[13px]"
            style={{ color: theme.text }}
          />
        </View>

        {activeTab === 'items' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat}
                onPress={() => setSelectedCategory(cat)}
                className="mr-2 rounded-full border px-4 py-2"
                style={{ backgroundColor: selectedCategory === cat ? theme.primary : theme.surface, borderColor: selectedCategory === cat ? theme.primary : theme.border }}>
                <Text className="text-[12px] font-semibold" style={{ color: selectedCategory === cat ? '#FFFFFF' : theme.textSecondary }}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={{ zIndex: 1000 }}>
            <TouchableOpacity
              onPress={() => setShowLogTypeDropdown((prev) => !prev)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                height: 42,
                backgroundColor: theme.input,
                marginBottom: 4,
              }}
            >
              <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '600' }}>Log Type: </Text>
              <Text style={{ color: theme.text, fontSize: 13, flex: 1 }}>
                {selectedAction === 'all' ? 'All Actions' : LOCAL_ACTION_LABELS[selectedAction] || selectedAction}
              </Text>
              <Ionicons name={showLogTypeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textSecondary} />
            </TouchableOpacity>

            {showLogTypeDropdown && (
               <View
                 className="mb-2 rounded-lg border overflow-hidden"
                 style={{
                   borderColor: theme.border,
                   backgroundColor: theme.elevated,
                   shadowColor: theme.shadow,
                   shadowOffset: { width: 0, height: 2 },
                   shadowOpacity: 0.1,
                   shadowRadius: 4,
                   elevation: 3,
                 }}
               >
                {[
                  { label: 'All Actions', value: 'all' },
                  { label: 'Receiving', value: 'RECEIVING' },
                  { label: 'Consumption', value: 'CONSUMPTION' },
                  { label: 'Defective', value: 'SPOILAGE' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => {
                      setSelectedAction(opt.value);
                      setShowLogTypeDropdown(false);
                    }}
                    className="border-b px-3 py-2.5 flex-row items-center justify-between"
                    style={{
                      borderBottomColor: theme.border,
                      backgroundColor: selectedAction === opt.value ? theme.primaryLight : 'transparent',
                    }}
                  >
                    <Text style={{
                      color: selectedAction === opt.value ? theme.primary : theme.text,
                      fontWeight: selectedAction === opt.value ? 'bold' : 'normal',
                    }}>
                      {opt.label}
                    </Text>
                    {selectedAction === opt.value && (
                      <Ionicons name="checkmark" size={16} color={theme.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {canAdd && isProjectActive && activeTab === 'items' && (
        <View style={screenContentStyle}>
          <TouchableOpacity onPress={() => { if (ensureCanAddInventory()) setShowAdd(true); }} className="mb-3 h-[48px] items-center justify-center rounded-[12px]" style={{ backgroundColor: theme.primary }}>
            <Text className="text-[15px] font-bold text-white">Add Inventory Item</Text>
          </TouchableOpacity>
        </View>
      )}
      {canRecordInventoryLog && isProjectActive && activeTab === 'logs' && (
        <View style={screenContentStyle}>
          <TouchableOpacity
            onPress={() => {
              const nextAction = canLogUsage ? 'CONSUMPTION' : logActionType;
              if (!ensureCanRecordInventoryLog(nextAction)) return;
              if (canLogUsage) setLogActionType('CONSUMPTION');
              setShowAddLog(true);
            }}
            className="mb-2 h-[40px] items-center justify-center rounded-[10px]"
            style={{ backgroundColor: theme.primaryPressed }}>
            <Text className="text-[13px] font-bold text-white">{canLogUsage ? 'Record Material Usage' : 'Add Log Entry'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ScrollView
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={{ paddingBottom: showBottomNav ? bottomNavContentPadding : screenBottomPadding }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              colors={[theme.primary]}
              tintColor={theme.primary}
            />
          }
        >
          <View style={screenContentStyle}>
          {activeTab === 'items'
            ? Array.from({ length: 5 }).map((_, index) => <InventoryItemSkeleton key={index} />)
            : Array.from({ length: 4 }).map((_, index) => <InventoryLogSkeleton key={index} />)}
          </View>
        </ScrollView>
      ) : error ? (
        <View className="mt-12 items-center px-8">
          <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
          <Text className="mt-3 text-center" style={{ color: theme.textSecondary }}>{error}</Text>
          <TouchableOpacity onPress={() => load()} className="mt-4 rounded-lg px-4 py-2" style={{ backgroundColor: theme.primary }}>
            <Text className="font-semibold text-white">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={{ paddingBottom: showBottomNav ? bottomNavContentPadding : screenBottomPadding }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              colors={[theme.primary]}
              tintColor={theme.primary}
            />
          }
        >
          <View style={screenContentStyle}>

          {activeTab === 'items' &&
            (filteredItems.length === 0 ? (
              <View className="mt-14 items-center">
                <Ionicons name="cube-outline" size={38} color={theme.textMuted} />
                <Text className="mt-2" style={{ color: theme.textMuted }}>No inventory items found.</Text>
              </View>
            ) : (
              filteredItems.map((item) => {
                const status = stockStatus(item.quantity, item.critical_level);
                const isHighlighted = String(item.id) === String(highlightItemId);
                return (
                  <TouchableOpacity
                    key={item.id}
                    className="mb-3 rounded-2xl border p-4"
                    style={{
                      backgroundColor: isHighlighted ? theme.primaryLight : theme.surface,
                      borderColor: isHighlighted ? theme.warning : theme.border,
                      shadowColor: theme.shadow,
                      shadowOpacity: 0.05,
                      shadowRadius: 8,
                      elevation: 2,
                    }}
                    onPress={() => {
                      if (!canRecordInventoryLog || !isProjectActive) {
                        if (!canWriteInventory) showViewOnlyMessage();
                        if (canWriteInventory && !isProjectActive) blockInventoryWrite();
                        return;
                      }
                      if (canLogUsage) {
                        setTxnItem(item);
                        setTxnAction('CONSUMPTION');
                        setTxnQty('');
                        setTxnNotes('');
                        setTxnTaskId('');
                        setShowTransaction(true);
                        return;
                      }
                      Alert.alert(item.item_name, 'Choose action', [
                        { text: 'Record Transaction', onPress: () => { setTxnItem(item); setTxnAction('RECEIVING'); setTxnQty(''); setTxnNotes(''); setTxnTaskId(''); setShowTransaction(true); } },
                        { text: 'Delete', style: 'destructive', onPress: () => handleDelete(item.id) },
                        { text: 'Cancel', style: 'cancel' },
                      ]);
                    }}>
                    <View className="mb-2 flex-row items-start justify-between">
                      <Text className="mr-2 flex-1 text-[16px] font-bold" style={{ color: theme.text }} numberOfLines={2}>{item.item_name}</Text>
                      <View className="rounded-full px-2 py-1" style={{ backgroundColor: status.bg }}>
                        <Text className="text-[10px] font-semibold text-white">{status.label}</Text>
                      </View>
                    </View>
                    <Text className="text-[12px]" style={{ color: theme.textMuted }}>{formatCategory(item.category)}</Text>
                    <View className="mt-2 flex-row justify-between">
                      <Text className="text-[13px]" style={{ color: theme.textSecondary }}>Qty: <Text className="font-semibold">{displayInventoryNumber(item.quantity)} {item.unit || 'pcs'}</Text></Text>
                      <Text className="text-[13px]" style={{ color: theme.textSecondary }}>Min Stock: <Text className="font-semibold">{displayInventoryNumber(item.critical_level)}</Text></Text>
                    </View>
                    <Text className="mt-1 text-[13px]" style={{ color: theme.textSecondary }}>Price: <Text className="font-semibold">{formatCurrencyPHP(item.price)}</Text></Text>
                  </TouchableOpacity>
                );
              })
            ))}

          {activeTab === 'logs' &&
            (filteredLogs.length === 0 ? (
              <View className="mt-14 items-center">
                <Ionicons name="document-text-outline" size={38} color={theme.textMuted} />
                <Text className="mt-2 text-center text-[14px]" style={{ color: theme.textMuted }}>
                  {selectedAction === 'all'
                    ? 'No inventory logs yet.'
                    : selectedAction === 'RECEIVING'
                    ? 'No inventory logs for Receiving.'
                    : selectedAction === 'CONSUMPTION'
                    ? 'No inventory logs for Consumption.'
                    : selectedAction === 'SPOILAGE'
                    ? 'No inventory logs for Defective.'
                    : 'No inventory logs found.'}
                </Text>
              </View>
            ) : (
              <View className="ml-2">
                {filteredLogs.map((log, idx) => {
                  const type = (log.action_type || '').toLowerCase();
                  let meta = { icon: 'receipt-outline', color: '#7370FF', bg: '#F0EFFF', prefix: '' };
                  
                  if (type.includes('receiving') || type.includes('add')) {
                    meta = { icon: 'download-outline', color: '#5DBF50', bg: '#E8F5E9', prefix: '+' };
                  } else if (type.includes('consumption') || type.includes('consume')) {
                    meta = { icon: 'exit-outline', color: '#FF9F43', bg: '#FFF3E0', prefix: '-' };
                  } else if (type.includes('spoilage') || type.includes('delete')) {
                    meta = { icon: 'trash-outline', color: '#FF6B6B', bg: '#FFEBEE', prefix: '-' };
                  } else if (type.includes('return')) {
                    meta = { icon: 'refresh-outline', color: '#4dabf7', bg: '#e7f5ff', prefix: '+' };
                  }

                  return (
                    <View key={log.id} className="flex-row">
                      {/* Timeline column */}
                      <View className="mr-4 items-center">
                        <View 
                          className="h-10 w-10 items-center justify-center rounded-full" 
                          style={{ backgroundColor: meta.bg }}
                        >
                          <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                        </View>
                        {idx !== filteredLogs.length - 1 && (
                          <View className="w-[2px] flex-1" style={{ backgroundColor: theme.border }} />
                        )}
                      </View>

                      {/* Content column */}
                      <View className="flex-1 pb-8">
                        <View 
                          className="rounded-2xl p-4" 
                          style={{ backgroundColor: theme.surface, shadowColor: theme.shadow, shadowOpacity: 0.04, shadowRadius: 10, elevation: 2 }}
                        >
                          <View className="mb-2 flex-row items-center justify-between">
                            <Text className="flex-1 text-[16px] font-bold" style={{ color: theme.text }} numberOfLines={1}>
                              {log.item_name}
                            </Text>
                            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: meta.bg }}>
                              <Text className="text-[10px] font-bold" style={{ color: meta.color }}>
                                {meta.prefix}{displayInventoryNumber(log.quantity)} {log.unit || 'pcs'}
                              </Text>
                            </View>
                          </View>

                          <View className="mb-3 space-y-2">
                            <View className="mb-1 min-w-0 flex-1 flex-row items-center pr-2">
                              <Ionicons name="business-outline" size={14} color={theme.primary} />
                              <Text className="ml-2 flex-1 text-[12px]" style={{ color: theme.textSecondary }}>
                                <Text className="font-semibold" style={{ color: theme.text }}>Project: </Text>
                                {log.project_name || displayProjectName}
                              </Text>
                            </View>
                            <View className="flex-row items-center">
                              <Ionicons name="location-outline" size={14} color={theme.primary} />
                              <Text className="ml-2 flex-1 text-[12px]" style={{ color: theme.textSecondary }}>
                                <Text className="font-semibold" style={{ color: theme.text }}>Location: </Text>
                                {log.location || displayProjectLocation}
                              </Text>
                            </View>
                            <View className="flex-row items-center">
                              <Ionicons name="person-outline" size={14} color={theme.primary} />
                              <Text className="ml-2 text-[12px]" style={{ color: theme.textSecondary }}>
                                <Text className="font-semibold" style={{ color: theme.text }}>By: </Text>
                                {log.actor_name || displayActorName}
                              </Text>
                            </View>
                          </View>

                          <View className="flex-row flex-wrap items-center justify-between border-t pt-3" style={{ borderColor: theme.border }}>
                            <View className="flex-row items-center">
                              <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
                              <Text className="ml-1 flex-1 text-[11px] font-medium" style={{ color: theme.textMuted }} numberOfLines={2}>
                                {new Date(log.created_at).toLocaleDateString()} • {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </Text>
                            </View>
                            <View className="mb-1 rounded-md px-2 py-1" style={{ backgroundColor: theme.input }}>
                              <Text className="text-[9px] font-bold" style={{ color: theme.textMuted }} numberOfLines={1}>
                                {LOCAL_ACTION_LABELS[log.action_type] || formatDisplayLabel(log.action_type, 'Activity')}
                              </Text>
                            </View>
                          </View>

                          {!!log.notes && (
                            <View className="mt-3 rounded-lg border-l-2 p-2" style={{ backgroundColor: theme.input, borderColor: theme.border }}>
                              <Text className="text-[11px] italic" style={{ color: theme.textSecondary }}>"{log.notes}"</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
        <Modal visible={showAdd && canAdd && isProjectActive} transparent animationType="slide" onRequestClose={closeAddItemModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
            className="flex-1 justify-center px-6"
            style={{ backgroundColor: theme.overlay }}>
            <TouchableOpacity activeOpacity={1} onPress={closeAddItemModal} className="absolute inset-0" />
            <TouchableWithoutFeedback>
              <View className="max-h-[86%] w-full rounded-3xl" style={{ backgroundColor: theme.elevated, maxWidth: 560, alignSelf: 'center' }}>
                 <View className="flex-row items-center justify-between border-b px-6 py-4" style={{ borderColor: theme.border }}>
                  <Text className="text-[18px] font-bold" style={{ color: theme.primary }}>Add a new item</Text>
                  <TouchableOpacity onPress={closeAddItemModal} className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: theme.input }}>
                    <Ionicons name="close" size={20} color={theme.text} />
                  </TouchableOpacity>
                </View>
                <ScrollView className="px-6 pt-5" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
                  <Text className="mb-1.5 text-[14px] font-bold" style={{ color: theme.text }}>Item Name</Text>
                  <TextInput
                    value={addName}
                    onChangeText={setAddName}
                    style={inputStyle}
                    placeholder="Enter the title of the item here"
                    placeholderTextColor={theme.textMuted}
                  />

                  <Text className="mb-1.5 text-[14px] font-bold" style={{ color: theme.text }}>Category</Text>
                  <TouchableOpacity
                    onPress={() => setShowCategoryDropdown((prev) => !prev)}
                    style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                    className="flex-row items-center justify-between"
                  >
                    <Text style={{ color: theme.text }}>{addCategory}</Text>
                    <Ionicons name={showCategoryDropdown ? "chevron-up" : "chevron-down"} size={18} color={theme.textSecondary} />
                  </TouchableOpacity>

                  {showCategoryDropdown && (
                    <View className="mb-3 overflow-hidden rounded-xl border" style={{ borderColor: theme.border, backgroundColor: theme.surface }}>
                      {['Materials', 'Equipment', 'Others'].map((cat) => (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => {
                            setAddCategory(cat);
                            setShowCategoryDropdown(false);
                          }}
                          className="border-b px-4 py-3"
                          style={{ borderBottomColor: theme.border, backgroundColor: addCategory === cat ? theme.primaryLight : 'transparent' }}
                        >
                          <Text style={{ color: addCategory === cat ? theme.primary : theme.text }}>{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text className="mb-1.5 text-[14px] font-bold" style={{ color: theme.text }}>Minimum Stock</Text>
                  <TextInput
                    value={addCritical}
                    onChangeText={(value) => setAddCritical(inventoryNumberInput(value))}
                    style={inputStyle}
                    placeholder="e.g. 5"
                    keyboardType="numeric"
                    placeholderTextColor={theme.textMuted}
                  />

                  <Text className="mb-1.5 text-[14px] font-bold" style={{ color: theme.text }}>Price</Text>
                  <TextInput
                    value={addPrice}
                    onChangeText={(value) => setAddPrice(inventoryNumberInput(value))}
                    style={inputStyle}
                    placeholder="0.00"
                    keyboardType="numeric"
                    placeholderTextColor={theme.textMuted}
                  />
                </ScrollView>
                <View className="border-t px-6 pb-6 pt-4" style={{ borderColor: theme.border }}>
                  <TouchableOpacity onPress={handleAdd} disabled={saving} className="h-12 items-center justify-center rounded-xl" style={{ backgroundColor: theme.primary }}>
                    {saving ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">Save</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={showTransaction && canRecordInventoryLog && isProjectActive} transparent animationType="slide" onRequestClose={closeTransactionModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
            className="flex-1 justify-center px-6"
            style={{ backgroundColor: theme.overlay }}>
            <TouchableOpacity activeOpacity={1} onPress={closeTransactionModal} className="absolute inset-0" />
            <TouchableWithoutFeedback>
            <View className="max-h-[86%] w-full rounded-3xl p-6" style={{ backgroundColor: theme.elevated, maxWidth: 560, alignSelf: 'center' }}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              <View className="mb-4 flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-[18px] font-bold" style={{ color: theme.primary }}>Record Transaction</Text>
                  <Text className="mt-2 rounded-xl border px-3 py-2 text-[12px] leading-5" style={{ color: theme.textMuted, backgroundColor: theme.input, borderColor: theme.border }}>
                    Inventory logs are permanent once saved and cannot be edited. Please review everything before confirming.
                  </Text>
                </View>
                <TouchableOpacity onPress={closeTransactionModal} className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: theme.input }}>
                  <Ionicons name="close" size={20} color={theme.text} />
                </TouchableOpacity>
              </View>
              <Text className="mb-3 text-center text-[13px]" style={{ color: theme.textSecondary }}>{txnItem?.item_name}</Text>
              <Text className="mb-1 text-[12px]" style={{ color: theme.textSecondary }}>Action Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                {availableActionTypes.map((a) => (
                  <TouchableOpacity key={a} onPress={() => { setTxnAction(a); if (a !== 'CONSUMPTION') setTxnTaskId(''); }}
                    className="mr-2 rounded-full px-3 py-2"
                    style={{ backgroundColor: txnAction === a ? theme.primaryLight : theme.input }}>
                    <Text className="text-[12px] font-semibold" style={{ color: txnAction === a ? theme.primary : theme.textSecondary }}>{LOCAL_ACTION_LABELS[a]}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput value={txnQty} onChangeText={(value) => setTxnQty(inventoryNumberInput(value))} style={inputStyle} keyboardType="decimal-pad" placeholder="Quantity (must be > 0)" placeholderTextColor={theme.textMuted} />
              {txnAction === 'CONSUMPTION' && (
                <View className="mb-3">
                  <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.warning }}>⚠ Task Required for Consumption</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {safeProjectTasks.map((t) => (
                      <TouchableOpacity key={t.id} onPress={() => setTxnTaskId(String(t.id))}
                        className="mr-2 rounded-full px-3 py-2"
                        style={{ backgroundColor: txnTaskId === String(t.id) ? theme.primaryLight : theme.input }}>
                        <Text className="text-[12px]" style={{ color: txnTaskId === String(t.id) ? theme.primary : theme.textSecondary }}>{t.title}</Text>
                      </TouchableOpacity>
                    ))}
                    {safeProjectTasks.length === 0 && <Text className="text-[12px]" style={{ color: theme.textMuted }}>No tasks found for this project.</Text>}
                  </ScrollView>
                </View>
              )}
              <TextInput value={txnNotes} onChangeText={setTxnNotes} style={inputStyle} placeholder="Notes (optional)" placeholderTextColor={theme.textMuted} />
              <TouchableOpacity onPress={handleTransaction} disabled={saving} className="mt-2 h-12 items-center justify-center rounded-xl" style={{ backgroundColor: ACTION_TYPE_COLORS[txnAction] }}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">Submit {LOCAL_ACTION_LABELS[txnAction]}</Text>}
              </TouchableOpacity>
              </ScrollView>
            </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={showAddLog && canRecordInventoryLog && isProjectActive} transparent animationType="fade" onRequestClose={closeAddLogModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
            className="flex-1 items-center justify-center px-6"
            style={{ backgroundColor: theme.overlay }}>
            <TouchableOpacity activeOpacity={1} onPress={closeAddLogModal} className="absolute inset-0" />
            <TouchableWithoutFeedback>
            <View className="max-h-[86%] w-full rounded-3xl p-6" style={{ backgroundColor: theme.elevated, maxWidth: 560, alignSelf: 'center' }}>
              <View className="mb-4 flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-[18px] font-bold" style={{ color: theme.primary }}>Add Inventory Log</Text>
                  <Text className="mt-2 rounded-xl border px-3 py-2 text-[12px] leading-5" style={{ color: theme.textMuted, backgroundColor: theme.input, borderColor: theme.border }}>
                    Inventory logs are permanent once saved and cannot be edited. Please review everything before confirming.
                  </Text>
                </View>
                <TouchableOpacity onPress={closeAddLogModal} className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: theme.input }}>
                  <Ionicons name="close" size={20} color={theme.text} />
                </TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              <Text className="mb-1 text-[12px]" style={{ color: theme.textSecondary }}>Item</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
                {items.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => setLogItemId(String(item.id))}
                    className="mr-2 rounded-full px-3 py-2"
                    style={{ backgroundColor: logItemId === String(item.id) ? theme.primaryLight : theme.input }}>
                    <Text style={{ color: logItemId === String(item.id) ? theme.primary : theme.textSecondary }}>{item.item_name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text className="mb-1 text-[12px]" style={{ color: theme.textSecondary }}>Action Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
                {availableActionTypes.map((action) => (
                  <TouchableOpacity
                    key={action}
                    onPress={() => { setLogActionType(action); if (action !== 'CONSUMPTION') setLogTaskId(''); }}
                    className="mr-2 rounded-full px-3 py-2"
                    style={{ backgroundColor: logActionType === action ? theme.primaryLight : theme.input }}>
                    <Text className="text-[12px]" style={{ color: logActionType === action ? theme.primary : theme.textSecondary }}>{LOCAL_ACTION_LABELS[action]}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {logActionType === 'CONSUMPTION' && (
                <View className="mb-2">
                  <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.warning }}>⚠ Select Task</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {safeProjectTasks.map((t) => (
                      <TouchableOpacity key={t.id} onPress={() => setLogTaskId(String(t.id))}
                        className="mr-2 rounded-full px-3 py-2"
                        style={{ backgroundColor: logTaskId === String(t.id) ? theme.primaryLight : theme.input }}>
                        <Text className="text-[12px]" style={{ color: logTaskId === String(t.id) ? theme.primary : theme.textSecondary }}>{t.title}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              <TextInput value={logQty} onChangeText={(value) => setLogQty(inventoryNumberInput(value))} style={inputStyle} keyboardType="decimal-pad" placeholder="Quantity" placeholderTextColor={theme.textMuted} />
              <TextInput value={logNotes} onChangeText={setLogNotes} style={inputStyle} placeholder="Remarks / notes" placeholderTextColor={theme.textMuted} />
              </ScrollView>
              <TouchableOpacity onPress={handleAddLog} disabled={saving} className="h-12 items-center justify-center rounded-xl" style={{ backgroundColor: theme.primary }}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">Review & Save Log</Text>}
              </TouchableOpacity>
            </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>
      <SuccessModal
        visible={successModal.visible}
        title={successModal.title}
        message={successModal.message}
        buttonLabel={successModal.buttonLabel}
        onPress={successModal.onPress}
      />
      {showBottomNav && onNavigate && (
        <BottomNavigationBar
          activeTab={activeMainTab}
          onTabPress={onNavigate}
          canViewHome={canViewHome}
          unreadCount={unreadCount}
        />
      )}
    </View>
  );
}
