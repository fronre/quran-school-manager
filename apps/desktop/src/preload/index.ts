import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, IPC_ENVELOPE } from '../main/channels';

/** The renderer gets exactly one function, limited to the allow-listed channels. No Node, no ipcRenderer. */
contextBridge.exposeInMainWorld('mishkat', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!(CHANNELS as readonly string[]).includes(channel)) return Promise.reject(new Error('unknown_channel'));
    return ipcRenderer.invoke(IPC_ENVELOPE, channel, payload ?? {});
  },
});
