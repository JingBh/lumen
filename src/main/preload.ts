import { contextBridge, ipcRenderer } from 'electron'

// The page talks to the host through two narrow doors: window messages (Lumen's host protocol) and a few named channels.
contextBridge.exposeInMainWorld('lumenHost', (msg: unknown) => ipcRenderer.send('lumen:host', msg))

contextBridge.exposeInMainWorld('lumenIpc', {
  on: (channel: 'load' | 'patch' | 'toast' | 'appearance', callback: (payload: unknown) => void) => {
    ipcRenderer.on(`lumen:${channel}`, (_event, payload) => callback(payload))
  },
  send: (channel: 'ready' | 'action' | 'menu', payload?: unknown) => ipcRenderer.send(`lumen:${channel}`, payload)
})
