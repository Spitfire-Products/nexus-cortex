/**
 * Shared Interactive Menu Types for Nexus Cortex
 *
 * These types define a UI-agnostic menu structure that can be rendered
 * by different CLI implementations:
 * - fuzzycortex (chalk-based terminal UI)
 * - neoncortex (Ink-based React terminal UI)
 * - cortexserver (HTTP API for web/mobile clients)
 *
 * The menu system supports:
 * - Multiple item types (toggle, select, number, text, action, info)
 * - Sectioned layouts with collapsible groups
 * - Hybrid save behavior (live updates for toggles, explicit save for text/numbers)
 * - Validation with error messages
 * - Keyboard shortcuts for actions
 *
 * @module ui/menu-types
 */

// ============================================
// Menu Item Types
// ============================================

/**
 * Available menu item types
 */
export type MenuItemType = 'toggle' | 'select' | 'number' | 'text' | 'action' | 'info';

/**
 * Base properties shared by all menu items
 */
export interface BaseMenuItem {
  /** Unique key for this item (maps to config key) */
  key: string;

  /** Display label shown to user */
  label: string;

  /** Optional description/help text */
  description?: string;

  /** Whether this item is disabled */
  disabled?: boolean;

  /** Whether changes should apply immediately (default: true for toggles/selects, false for text/numbers) */
  liveUpdate?: boolean;
}

/**
 * Toggle item - boolean on/off switch
 */
export interface ToggleMenuItem extends BaseMenuItem {
  type: 'toggle';
  value: boolean;
}

/**
 * Select item - dropdown/list selection from predefined choices
 */
export interface SelectMenuItem extends BaseMenuItem {
  type: 'select';
  value: string;
  choices: SelectChoice[];
}

/**
 * A choice option for select menus
 */
export interface SelectChoice {
  /** Display label */
  label: string;
  /** Value to store */
  value: string;
  /** Optional description for this choice */
  description?: string;
}

/**
 * Number item - numeric input with optional range constraints
 */
export interface NumberMenuItem extends BaseMenuItem {
  type: 'number';
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Text item - string input field
 */
export interface TextMenuItem extends BaseMenuItem {
  type: 'text';
  value: string;
  placeholder?: string;
  /** Whether to mask input (for passwords/secrets) */
  secret?: boolean;
  /** Multi-line text input */
  multiline?: boolean;
}

/**
 * Action item - clickable button that triggers a handler
 */
export interface ActionMenuItem extends BaseMenuItem {
  type: 'action';
  /** Label for the action button */
  actionLabel: string;
  /** Whether this is a destructive action (shows warning) */
  destructive?: boolean;
}

/**
 * Info item - read-only display of information
 */
export interface InfoMenuItem extends BaseMenuItem {
  type: 'info';
  value: string;
  /** Optional icon/emoji */
  icon?: string;
}

/**
 * Union type of all menu item types
 */
export type MenuItem =
  | ToggleMenuItem
  | SelectMenuItem
  | NumberMenuItem
  | TextMenuItem
  | ActionMenuItem
  | InfoMenuItem;

// ============================================
// Menu Structure Types
// ============================================

/**
 * A section groups related menu items together
 */
export interface MenuSection {
  /** Unique identifier for this section */
  id: string;

  /** Section title */
  title: string;

  /** Optional section description */
  description?: string;

  /** Items in this section */
  items: MenuItem[];

  /** Whether section starts collapsed */
  collapsed?: boolean;

  /** Icon/emoji for section header */
  icon?: string;
}

/**
 * A menu action (Save, Cancel, Reset, etc.)
 */
export interface MenuAction {
  /** Unique identifier */
  id: string;

  /** Display label */
  label: string;

  /** Keyboard shortcut hint (e.g., 'Enter', 'Esc', 'r') */
  shortcut?: string;

  /** Whether this is the primary/default action */
  primary?: boolean;

  /** Whether this is a destructive action */
  destructive?: boolean;
}

/**
 * Complete interactive menu definition
 */
export interface InteractiveMenuDefinition {
  /** Unique identifier for this menu */
  id: string;

  /** Menu title */
  title: string;

  /** Optional menu description */
  description?: string;

  /** Icon/emoji for menu header */
  icon?: string;

  /** Menu sections */
  sections: MenuSection[];

  /** Available actions (Save, Cancel, etc.) */
  actions: MenuAction[];

  /** Footer text (keyboard hints, etc.) */
  footer?: string;
}

// ============================================
// Menu Result Types
// ============================================

/**
 * Result from menu interaction
 */
export interface MenuResult {
  /** Action taken (save, cancel, reset, or custom action id) */
  action: 'save' | 'cancel' | 'reset' | string;

  /** Changed values (key -> new value) */
  changes: Record<string, unknown>;

  /** Whether any values were changed */
  hasChanges: boolean;
}

/**
 * Validation result for a single menu value
 */
export interface MenuValidationResult {
  /** Whether value is valid */
  valid: boolean;

  /** Error message if invalid */
  error?: string;
}

// ============================================
// Config Service Interface
// ============================================

/**
 * Generic configuration service interface
 * Implementations provide config read/write and menu generation
 *
 * @template T - The configuration type this service manages
 */
export interface ConfigService<T extends Record<string, unknown>> {
  /**
   * Get current configuration
   */
  getConfig(): T;

  /**
   * Update configuration (partial update)
   * @param config - Partial config to merge
   */
  setConfig(config: Partial<T>): Promise<void>;

  /**
   * Get a single config value
   * @param key - Config key
   */
  getValue<K extends keyof T>(key: K): T[K];

  /**
   * Set a single config value
   * @param key - Config key
   * @param value - New value
   */
  setValue<K extends keyof T>(key: K, value: T[K]): Promise<void>;

  /**
   * Get menu definition for this config
   */
  getMenuDefinition(): InteractiveMenuDefinition;

  /**
   * Validate a value for a given key
   * @param key - Config key
   * @param value - Value to validate
   */
  validateValue(key: string, value: unknown): MenuValidationResult;

  /**
   * Get default configuration
   */
  getDefaultConfig(): T;

  /**
   * Reset configuration to defaults
   */
  resetToDefaults(): Promise<void>;

  /**
   * Reload configuration from source (e.g., .env file)
   */
  reload(): void;
}

// ============================================
// Menu Event Types
// ============================================

/**
 * Event emitted when a menu item value changes
 */
export interface MenuItemChangeEvent {
  /** Item key */
  key: string;

  /** Previous value */
  previousValue: unknown;

  /** New value */
  newValue: unknown;

  /** Whether this was a live update (vs pending save) */
  isLiveUpdate: boolean;
}

/**
 * Event emitted when menu navigation changes
 */
export interface MenuNavigationEvent {
  /** Currently focused section */
  sectionId: string;

  /** Currently focused item key */
  itemKey: string;

  /** Navigation direction */
  direction: 'up' | 'down' | 'enter' | 'escape' | 'tab';
}

// ============================================
// Renderer Interface
// ============================================

/**
 * Interface for menu renderers (implemented by CLI UIs)
 */
export interface MenuRenderer {
  /**
   * Render the menu and return the result
   * @param definition - Menu definition to render
   * @param initialValues - Initial values for menu items
   * @param onLiveUpdate - Callback for live updates (toggles/selects)
   */
  render(
    definition: InteractiveMenuDefinition,
    initialValues: Record<string, unknown>,
    onLiveUpdate?: (key: string, value: unknown) => Promise<void>
  ): Promise<MenuResult>;
}

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for ToggleMenuItem
 */
export function isToggleItem(item: MenuItem): item is ToggleMenuItem {
  return item.type === 'toggle';
}

/**
 * Type guard for SelectMenuItem
 */
export function isSelectItem(item: MenuItem): item is SelectMenuItem {
  return item.type === 'select';
}

/**
 * Type guard for NumberMenuItem
 */
export function isNumberItem(item: MenuItem): item is NumberMenuItem {
  return item.type === 'number';
}

/**
 * Type guard for TextMenuItem
 */
export function isTextItem(item: MenuItem): item is TextMenuItem {
  return item.type === 'text';
}

/**
 * Type guard for ActionMenuItem
 */
export function isActionItem(item: MenuItem): item is ActionMenuItem {
  return item.type === 'action';
}

/**
 * Type guard for InfoMenuItem
 */
export function isInfoItem(item: MenuItem): item is InfoMenuItem {
  return item.type === 'info';
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get all items from a menu definition (flattened)
 */
export function getAllMenuItems(definition: InteractiveMenuDefinition): MenuItem[] {
  return definition.sections.flatMap(section => section.items);
}

/**
 * Find a menu item by key
 */
export function findMenuItem(definition: InteractiveMenuDefinition, key: string): MenuItem | undefined {
  for (const section of definition.sections) {
    const item = section.items.find(i => i.key === key);
    if (item) return item;
  }
  return undefined;
}

/**
 * Get section containing an item
 */
export function findItemSection(definition: InteractiveMenuDefinition, key: string): MenuSection | undefined {
  return definition.sections.find(section =>
    section.items.some(item => item.key === key)
  );
}

/**
 * Check if an item should live-update by default based on its type
 */
export function shouldLiveUpdate(item: MenuItem): boolean {
  // Explicit setting takes precedence
  if (item.liveUpdate !== undefined) {
    return item.liveUpdate;
  }

  // Default: toggles and selects update live, others require save
  switch (item.type) {
    case 'toggle':
    case 'select':
      return true;
    case 'number':
    case 'text':
      return false;
    case 'action':
    case 'info':
      return false;
    default:
      return false;
  }
}

/**
 * Create a standard set of menu actions (Save, Cancel, Reset)
 */
export function createStandardActions(options?: {
  includeSave?: boolean;
  includeCancel?: boolean;
  includeReset?: boolean;
}): MenuAction[] {
  const {
    includeSave = true,
    includeCancel = true,
    includeReset = true
  } = options || {};

  const actions: MenuAction[] = [];

  if (includeSave) {
    actions.push({
      id: 'save',
      label: 'Save',
      shortcut: 's',
      primary: true
    });
  }

  if (includeCancel) {
    actions.push({
      id: 'cancel',
      label: 'Cancel',
      shortcut: 'Esc'
    });
  }

  if (includeReset) {
    actions.push({
      id: 'reset',
      label: 'Reset to Defaults',
      shortcut: 'r',
      destructive: true
    });
  }

  return actions;
}
