
export enum ActionType {
  LAUNCH_APP = 'LAUNCH_APP',
  OPEN_URL = 'OPEN_URL',
  COMMAND = 'COMMAND',
  MACRO = 'MACRO'
}

export interface AutomationStep {
  id: string;
  type: ActionType;
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

export interface AppState {
  currentPageId: string;
  pages: DashboardPage[];
  macros: SavedMacro[];
  isEditMode: boolean;
  isExecuting: boolean;
  pcIpAddress: string;
  connectionStatus: 'online' | 'offline' | 'checking';
  lastExecutedAction?: string;
}
