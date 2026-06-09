/**
 * Artifact System Contracts
 * Complete type definitions for the dynamic artifact system
 */

// ============================================================================
// Core Artifact Types
// ============================================================================

export interface ArtifactDefinition {
  // Identity
  id: string;                              // Unique identifier
  type: ArtifactType;                      // Type of artifact
  version?: string;                        // Artifact version

  // Display
  title: string;                           // Display title
  description?: string;                    // Optional description
  icon?: string;                           // Emoji or icon identifier

  // Component
  component?: ComponentDefinition;         // React component definition
  data: ArtifactData;                     // Initial data
  schema?: DataSchema;                    // Data validation schema

  // Layout
  layout?: ArtifactLayout;                // Tmux layout configuration
  style?: ArtifactStyle;                  // Visual styling

  // Behavior
  interactive?: boolean;                   // Enable user interaction
  realtime?: boolean;                     // Enable real-time updates
  persistent?: boolean;                   // Persist across sessions
  autoRefresh?: number;                   // Auto-refresh interval (ms)

  // Metadata
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;                     // User or LLM
  tags?: string[];
  permissions?: ArtifactPermissions;
}

export enum ArtifactType {
  // Display artifacts
  DASHBOARD = 'dashboard',
  CHART = 'chart',
  TABLE = 'table',
  LIST = 'list',
  TREE = 'tree',
  GRAPH = 'graph',

  // Interactive artifacts
  FORM = 'form',
  TERMINAL = 'terminal',
  EDITOR = 'editor',
  REPL = 'repl',

  // Content artifacts
  MARKDOWN = 'markdown',
  CODE = 'code',
  LOG = 'log',
  JSON = 'json',

  // Custom
  CUSTOM = 'custom'
}

export interface ComponentDefinition {
  source: ComponentSource;
  template?: string;                      // Template name for builtin
  path?: string;                          // File path for file source
  code?: string;                          // Component code for inline
  props?: Record<string, any>;            // Default props
  dependencies?: string[];                // Required npm packages
  sandbox?: boolean;                      // Run in sandbox
}

export enum ComponentSource {
  BUILTIN = 'builtin',                    // Pre-built template
  FILE = 'file',                          // Load from file
  INLINE = 'inline',                      // Inline code
  REMOTE = 'remote',                      // Remote URL
  GENERATED = 'generated'                 // LLM generated
}

export interface ArtifactData {
  [key: string]: any;
}

export interface DataSchema {
  type: 'object' | 'array';
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  required?: string[];
}

export interface SchemaProperty {
  type: string;
  description?: string;
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

// ============================================================================
// Layout and Styling
// ============================================================================

export interface ArtifactLayout {
  // Position
  position: LayoutPosition;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right';

  // Size
  size?: string | LayoutSize;
  minSize?: string | number;
  maxSize?: string | number;

  // Split behavior
  split?: 'horizontal' | 'vertical';
  splitRatio?: number;                    // 0.0 to 1.0

  // Display
  focus?: boolean;                        // Auto-focus on creation
  modal?: boolean;                        // Modal overlay
  floating?: boolean;                     // Floating window
  fullscreen?: boolean;                   // Full screen mode

  // Tmux specific
  paneOptions?: TmuxPaneOptions;
}

export enum LayoutPosition {
  TOP = 'top',
  BOTTOM = 'bottom',
  LEFT = 'left',
  RIGHT = 'right',
  CENTER = 'center',
  FLOATING = 'floating',
  TAB = 'tab',
  REPLACE = 'replace'                     // Replace current pane
}

export interface LayoutSize {
  width?: string | number;
  height?: string | number;
  cols?: number;                          // Terminal columns
  rows?: number;                          // Terminal rows
}

export interface ArtifactStyle {
  theme?: string;                         // Theme name
  borderStyle?: BorderStyle;
  borderColor?: string;
  backgroundColor?: string;
  padding?: number | [number, number, number, number];
  margin?: number | [number, number, number, number];
  opacity?: number;
}

export enum BorderStyle {
  NONE = 'none',
  SINGLE = 'single',
  DOUBLE = 'double',
  ROUND = 'round',
  BOLD = 'bold',
  DOTTED = 'dotted'
}

// ============================================================================
// Lifecycle and State
// ============================================================================

export interface ArtifactLifecycle {
  // Creation
  onCreate?: (artifact: Artifact) => Promise<void>;
  onMount?: (artifact: Artifact) => Promise<void>;
  onReady?: (artifact: Artifact) => Promise<void>;

  // Updates
  onDataUpdate?: (artifact: Artifact, data: any, previous: any) => Promise<void>;
  onStateChange?: (artifact: Artifact, state: ArtifactState, previous: ArtifactState) => Promise<void>;
  onRefresh?: (artifact: Artifact) => Promise<void>;

  // Interaction
  onUserInput?: (artifact: Artifact, input: UserInput) => Promise<void>;
  onCommand?: (artifact: Artifact, command: string, args: any[]) => Promise<void>;
  onFocus?: (artifact: Artifact) => Promise<void>;
  onBlur?: (artifact: Artifact) => Promise<void>;

  // Errors
  onError?: (artifact: Artifact, error: Error) => Promise<void>;
  onRecover?: (artifact: Artifact) => Promise<void>;

  // Destruction
  onUnmount?: (artifact: Artifact) => Promise<void>;
  onDestroy?: (artifact: Artifact) => Promise<void>;
}

export enum ArtifactState {
  INITIALIZING = 'initializing',
  MOUNTING = 'mounting',
  READY = 'ready',
  UPDATING = 'updating',
  REFRESHING = 'refreshing',
  ERROR = 'error',
  SUSPENDED = 'suspended',
  UNMOUNTING = 'unmounting',
  DESTROYED = 'destroyed'
}

export interface Artifact {
  // Identity
  id: string;
  type: ArtifactType;
  version: string;

  // State
  state: ArtifactState;
  error?: Error;

  // Display
  title: string;
  description?: string;

  // Runtime
  paneId?: string;                        // Tmux pane ID
  processId?: number;                     // Node process ID
  port?: number;                          // Message bridge port

  // Data
  data: ArtifactData;
  previousData?: ArtifactData;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  statistics?: ArtifactStatistics;
}

export interface ArtifactStatistics {
  renderCount: number;
  updateCount: number;
  errorCount: number;
  messagesSent: number;
  messagesReceived: number;
  cpuUsage?: number;
  memoryUsage?: number;
  uptime: number;
}

// ============================================================================
// User Interaction
// ============================================================================

export interface UserInput {
  type: InputType;
  key?: string;
  value?: any;
  modifiers?: InputModifiers;
  position?: { x: number; y: number };
  timestamp: number;
}

export enum InputType {
  KEYBOARD = 'keyboard',
  MOUSE = 'mouse',
  COMMAND = 'command',
  GESTURE = 'gesture',
  VOICE = 'voice'
}

export interface InputModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface ArtifactPermissions {
  read?: boolean;
  write?: boolean;
  execute?: boolean;
  delete?: boolean;
  share?: boolean;
}

// ============================================================================
// Message Protocol
// ============================================================================

export interface ArtifactMessage {
  // Message identity
  id: string;                             // Unique message ID
  correlationId?: string;                 // For request-response
  sessionId?: string;                     // Session identifier

  // Routing
  artifactId: string;                     // Target artifact
  source: MessageSource;
  target?: MessageTarget;

  // Content
  type: MessageType;
  payload: any;
  metadata?: MessageMetadata;

  // Timing
  timestamp: number;
  expiresAt?: number;

  // Reliability
  requiresAck?: boolean;
  retryCount?: number;
  maxRetries?: number;
  timeout?: number;
}

export enum MessageType {
  // Lifecycle
  CREATE = 'create',
  MOUNT = 'mount',
  READY = 'ready',
  UNMOUNT = 'unmount',
  DESTROY = 'destroy',

  // Data
  DATA_UPDATE = 'data_update',
  DATA_REQUEST = 'data_request',
  DATA_RESPONSE = 'data_response',

  // State
  STATE_CHANGE = 'state_change',
  STATE_REQUEST = 'state_request',
  STATE_RESPONSE = 'state_response',

  // Interaction
  USER_INPUT = 'user_input',
  COMMAND = 'command',
  ACTION = 'action',

  // Control
  FOCUS = 'focus',
  BLUR = 'blur',
  RESIZE = 'resize',
  REFRESH = 'refresh',
  RESET = 'reset',

  // Communication
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  BROADCAST = 'broadcast',

  // System
  HEARTBEAT = 'heartbeat',
  ACK = 'ack',
  ERROR = 'error',
  LOG = 'log',
  METRICS = 'metrics'
}

export enum MessageSource {
  CLI = 'cli',
  ARTIFACT = 'artifact',
  SERVER = 'server',
  USER = 'user',
  LLM = 'llm',
  SYSTEM = 'system'
}

export enum MessageTarget {
  CLI = 'cli',
  ARTIFACT = 'artifact',
  SERVER = 'server',
  ALL = 'all',
  GROUP = 'group'
}

export interface MessageMetadata {
  priority?: 'low' | 'normal' | 'high' | 'critical';
  encrypted?: boolean;
  compressed?: boolean;
  version?: string;
  headers?: Record<string, string>;
}

// ============================================================================
// Tmux Integration
// ============================================================================

export interface TmuxManager {
  // Session management
  createSession(name: string, options?: SessionOptions): Promise<string>;
  attachSession(name: string): Promise<void>;
  detachSession(name: string): Promise<void>;
  listSessions(): Promise<TmuxSession[]>;
  killSession(name: string): Promise<void>;
  renameSession(oldName: string, newName: string): Promise<void>;

  // Window management
  createWindow(options: WindowOptions): Promise<string>;
  selectWindow(windowId: string): Promise<void>;
  listWindows(sessionName?: string): Promise<TmuxWindow[]>;
  killWindow(windowId: string): Promise<void>;

  // Pane management
  createPane(options: PaneOptions): Promise<string>;
  splitPane(paneId: string, options: SplitOptions): Promise<string>;
  selectPane(paneId: string): Promise<void>;
  resizePane(paneId: string, size: string | PaneSize): Promise<void>;
  swapPanes(pane1: string, pane2: string): Promise<void>;
  killPane(paneId: string): Promise<void>;
  listPanes(windowId?: string): Promise<TmuxPane[]>;

  // Command execution
  sendKeys(target: string, keys: string): Promise<void>;
  sendText(target: string, text: string): Promise<void>;
  runCommand(target: string, command: string): Promise<void>;
  captureOutput(target: string, lines?: number): Promise<string>;
  clearPane(paneId: string): Promise<void>;

  // Layout
  applyLayout(layout: string | LayoutPreset): Promise<void>;
  saveLayout(name?: string): Promise<string>;
  loadLayout(layout: string): Promise<void>;
  listLayouts(): Promise<string[]>;

  // Monitoring
  watchPane(paneId: string, callback: (output: string) => void): void;
  unwatchPane(paneId: string): void;
  getPaneInfo(paneId: string): Promise<TmuxPane>;
}

export interface SessionOptions {
  startDirectory?: string;
  windowName?: string;
  command?: string;
  detached?: boolean;
  environment?: Record<string, string>;
}

export interface WindowOptions {
  name: string;
  sessionName?: string;
  startDirectory?: string;
  command?: string;
  focus?: boolean;
}

export interface PaneOptions extends TmuxPaneOptions {
  title: string;
  command?: string;
  workingDir?: string;
  environment?: Record<string, string>;
  size?: string | PaneSize;
  position?: 'top' | 'bottom' | 'left' | 'right';
  targetPane?: string;                    // Target pane to split
}

export interface TmuxPaneOptions {
  remainOnExit?: boolean;
  synchronize?: boolean;
  monitor?: boolean;
  style?: string;
}

export interface SplitOptions {
  direction: 'horizontal' | 'vertical';
  size?: string | number;
  percent?: boolean;
  before?: boolean;                       // Insert before current pane
}

export interface PaneSize {
  width?: number;
  height?: number;
  cols?: number;
  rows?: number;
  percent?: number;
}

export enum LayoutPreset {
  EVEN_HORIZONTAL = 'even-horizontal',
  EVEN_VERTICAL = 'even-vertical',
  MAIN_HORIZONTAL = 'main-horizontal',
  MAIN_VERTICAL = 'main-vertical',
  TILED = 'tiled'
}

export interface TmuxSession {
  name: string;
  id: string;
  created: Date;
  attached: boolean;
  windows: number;
  panes: number;
  width: number;
  height: number;
  clients: number;
}

export interface TmuxWindow {
  id: string;
  index: number;
  name: string;
  active: boolean;
  panes: number;
  layout: string;
}

export interface TmuxPane {
  id: string;
  index: number;
  title?: string;
  active: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  command?: string;
  pid?: number;
}

// ============================================================================
// Component Registry
// ============================================================================

export interface ComponentRegistry {
  register(name: string, component: ComponentTemplate): void;
  unregister(name: string): void;
  get(name: string): ComponentTemplate | undefined;
  list(): string[];
  has(name: string): boolean;
  validate(component: ComponentTemplate): boolean;
}

export interface ComponentTemplate {
  name: string;
  type: ArtifactType;
  description?: string;
  version?: string;
  author?: string;
  component: Function | string;
  defaultProps?: Record<string, any>;
  propTypes?: Record<string, PropType>;
  dependencies?: string[];
  preview?: string;                       // Preview image/gif URL
}

export interface PropType {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function';
  required?: boolean;
  default?: any;
  description?: string;
  enum?: any[];
}

// ============================================================================
// Bridge and Communication
// ============================================================================

export interface MessageBridge {
  // Connection
  connect(port?: number): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Messaging
  send(message: ArtifactMessage): Promise<void>;
  broadcast(message: Omit<ArtifactMessage, 'artifactId'>): Promise<void>;
  request<T = any>(message: ArtifactMessage): Promise<T>;

  // Subscriptions
  subscribe(artifactId: string, types: MessageType[]): void;
  unsubscribe(artifactId: string, types?: MessageType[]): void;

  // Events
  on(event: string, handler: Function): void;
  off(event: string, handler?: Function): void;
  once(event: string, handler: Function): void;
  emit(event: string, ...args: any[]): void;

  // Management
  registerArtifact(artifact: Artifact): void;
  unregisterArtifact(artifactId: string): void;
  getConnectedArtifacts(): string[];
}

// ============================================================================
// Manager and Controller
// ============================================================================

export interface ArtifactManager {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Artifact management
  createArtifact(definition: ArtifactDefinition): Promise<Artifact>;
  updateArtifact(id: string, data: Partial<ArtifactData>): Promise<void>;
  destroyArtifact(id: string): Promise<void>;
  getArtifact(id: string): Artifact | undefined;
  listArtifacts(): Artifact[];

  // Batch operations
  createMultiple(definitions: ArtifactDefinition[]): Promise<Artifact[]>;
  updateMultiple(updates: Array<{ id: string; data: any }>): Promise<void>;
  destroyAll(): Promise<void>;

  // Layout management
  arrangeArtifacts(layout: string): Promise<void>;
  saveLayout(name: string): Promise<void>;
  loadLayout(name: string): Promise<void>;

  // Communication
  sendToArtifact(id: string, message: any): Promise<void>;
  broadcastToAll(message: any): Promise<void>;

  // Events
  on(event: ArtifactEvent, handler: Function): void;
  off(event: ArtifactEvent, handler?: Function): void;
}

export enum ArtifactEvent {
  CREATED = 'artifact:created',
  UPDATED = 'artifact:updated',
  DESTROYED = 'artifact:destroyed',
  STATE_CHANGED = 'artifact:state_changed',
  ERROR = 'artifact:error',
  MESSAGE = 'artifact:message'
}

// ============================================================================
// Security
// ============================================================================

export interface SecurityPolicy {
  // Sandboxing
  enableSandbox: boolean;
  sandboxOptions?: SandboxOptions;

  // Permissions
  defaultPermissions: ArtifactPermissions;
  requireAuthentication: boolean;

  // Validation
  validateMessages: boolean;
  validateComponents: boolean;
  maxMessageSize: number;
  maxDataSize: number;

  // Rate limiting
  rateLimits?: RateLimits;

  // Audit
  enableAudit: boolean;
  auditEvents: string[];
}

export interface SandboxOptions {
  timeout: number;                        // Max execution time
  memory: number;                         // Max memory usage
  allowedModules: string[];               // Allowed require() modules
  env: Record<string, string>;            // Environment variables
}

export interface RateLimits {
  messagesPerSecond: number;
  updatesPerSecond: number;
  maxConcurrentArtifacts: number;
}

// ============================================================================
// Export all types
// ============================================================================

export * from './artifact.contracts';