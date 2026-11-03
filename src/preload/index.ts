import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type BootstrapInfo,
  type EnsureSessionRequest,
  type EnsureSessionResult,
  type SaveTabsRequest
} from '../shared/ipc'

const api = {
  bootstrap: (): Promise<BootstrapInfo> => ipcRenderer.invoke(IPC.bootstrap),

  pickProject: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickProject),

  ensureSession: (request: EnsureSessionRequest): Promise<EnsureSessionResult> =>
    ipcRenderer.invoke(IPC.ensureSession, request),

  replay: (tabId: string): Promise<string> => ipcRenderer.invoke(IPC.replaySession, tabId),

  closeTab: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC.closeTab, tabId),

  saveTabs: (request: SaveTabsRequest): Promise<boolean> => ipcRenderer.invoke(IPC.saveTabs, request),

  write: (tabId: string, data: string): void => {
    ipcRenderer.send(IPC.writeSession, tabId, data)
  },

  resize: (tabId: string, cols: number, rows: number): void => {
    ipcRenderer.send(IPC.resizeSession, tabId, cols, rows)
  },

  onData: (callback: (tabId: string, data: string) => void): (() => void) => {
    const listener = (_event: unknown, tabId: string, data: string): void => callback(tabId, data)
    ipcRenderer.on(IPC.sessionData, listener)
    return () => ipcRenderer.off(IPC.sessionData, listener)
  },

  onExit: (callback: (tabId: string, exitCode: number) => void): (() => void) => {
    const listener = (_event: unknown, tabId: string, exitCode: number): void =>
      callback(tabId, exitCode)
    ipcRenderer.on(IPC.sessionExit, listener)
    return () => ipcRenderer.off(IPC.sessionExit, listener)
  }
}

export type PiDesktopApi = typeof api

contextBridge.exposeInMainWorld('piDesktop', api)
