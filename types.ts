
export enum ActionType {
  LAUNCH_APP = 'LAUNCH_APP',
  CLOSE_APP = 'CLOSE_APP',
  FOCUS_WINDOW = 'FOCUS_WINDOW',
  HOTKEY = 'HOTKEY',
  MOUSE_CLICK = 'MOUSE_CLICK',
  OPEN_URL = 'OPEN_URL',
  COMMAND = 'COMMAND',
  MACRO = 'MACRO',
  WAIT = 'WAIT',
  KEYPRESS = 'KEYPRESS',
  VOLUME_SET = 'VOLUME_SET',
  VOLUME_MUTE = 'VOLUME_MUTE',
  MEDIA_PLAY_PAUSE = 'MEDIA_PLAY_PAUSE',
  MEDIA_NEXT = 'MEDIA_NEXT',
  MEDIA_PREV = 'MEDIA_PREV',
  SYSTEM_POWER = 'SYSTEM_POWER',
  SCREENSHOT = 'SCREENSHOT',
  CLIPBOARD_SET = 'CLIPBOARD_SET',
  CLIPBOARD_GET = 'CLIPBOARD_GET',
  WINDOW_MANAGE = 'WINDOW_MANAGE',
  MOUSE_MOVE = 'MOUSE_MOVE',
  MOUSE_SCROLL = 'MOUSE_SCROLL',
  TYPE_TEXT = 'TYPE_TEXT'
}

/** Action types arrive from the backend as strings; unknown ones must not
 *  break rendering. `string & {}` keeps ActionType autocompletion. */
export type ActionTypeValue = ActionType | (string & {});

export interface AutomationStep {
  id: string;
  type: ActionTypeValue;
  value: string;
  description: string;
}

export interface SavedMacro {
  id: string;
  name: string;
  steps: AutomationStep[];
}

export interface ControlButton {
  id: string;
  label: string;
  color: string;
  icon: string;
  steps: AutomationStep[];
}

export interface DashboardPage {
  id: string;
  name: string;
  buttons: ControlButton[];
}

export interface SystemStats {
  cpu: number;
  ram: number;
  battery: string | { percent: number; power_plugged: boolean; secsleft: any };
  volume?: number;
}

export interface AppState {
  currentPageId: string;
  pages: DashboardPage[];
  macros: SavedMacro[];
  isEditMode: boolean;
  isExecuting: boolean;
  pcIpAddress: string;
  connectionStatus: 'online' | 'offline' | 'checking' | 'connected' | 'disconnected' | 'connecting';
  lastExecutedAction?: string;
  systemStats?: SystemStats;
}
