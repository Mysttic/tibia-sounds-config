'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Jedyny most miedzy rendererem a systemem plikow.
 * Renderer nie ma dostepu do node - wszystko idzie przez te metody.
 */
contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('app:init'),
  getState: () => ipcRenderer.invoke('app:state'),
  acceptWarning: () => ipcRenderer.invoke('app:acceptWarning'),
  detectFfmpeg: () => ipcRenderer.invoke('app:detectFfmpeg'),

  pickClient: () => ipcRenderer.invoke('client:pick'),
  refresh: () => ipcRenderer.invoke('catalog:refresh'),
  isClientRunning: () => ipcRenderer.invoke('client:running'),

  pickAudioFile: () => ipcRenderer.invoke('audio:pick'),
  replaceSound: (soundId, srcPath, quality) =>
    ipcRenderer.invoke('sound:replace', { soundId, srcPath, quality }),
  muteSound: (soundId) => ipcRenderer.invoke('sound:mute', { soundId }),
  resetSound: (soundId) => ipcRenderer.invoke('sound:reset', { soundId }),
  reapplyAll: () => ipcRenderer.invoke('profile:reapply'),
  exportProfile: () => ipcRenderer.invoke('profile:export'),
  importProfile: () => ipcRenderer.invoke('profile:import'),

  /** Wyglad: 'system' | 'light' | 'dark'. */
  setTheme: (source) => ipcRenderer.invoke('app:setTheme', { source }),

  /** Tylko tryb deweloperski - w wersji spakowanej handler nie istnieje. */
  captureWindow: (outPath) => ipcRenderer.invoke('debug:capture', { outPath }),

  /**
   * Generowanie dzwieku. Klucz API idzie w jedna strone - do procesu glownego,
   * ktory go szyfruje. Renderer nigdy nie dostaje go z powrotem, moze jedynie
   * zapytac przez genProviders(), czy klucz jest ustawiony.
   */
  genProviders: () => ipcRenderer.invoke('gen:providers'),
  genSetKey: (providerId, key) => ipcRenderer.invoke('gen:setKey', { providerId, key }),
  genClearKey: (providerId) => ipcRenderer.invoke('gen:clearKey', { providerId }),
  genGenerate: (providerId, prompt, options) =>
    ipcRenderer.invoke('gen:generate', { providerId, prompt, options }),

  /** Zestawy dzwiekow: gotowe uklady wyciszen i podmian, wybierane z listy. */
  presetList: () => ipcRenderer.invoke('preset:list'),
  presetPlan: (id) => ipcRenderer.invoke('preset:plan', { id }),
  presetApply: (id) => ipcRenderer.invoke('preset:apply', { id }),
  presetSaveCurrent: (name) => ipcRenderer.invoke('preset:saveCurrent', { name }),
  presetRename: (id, name) => ipcRenderer.invoke('preset:rename', { id, name }),
  presetRemove: (id) => ipcRenderer.invoke('preset:remove', { id }),

  /** Biblioteka wygenerowanych dzwiekow - zostaja na dysku i da sie ich uzyc ponownie. */
  libList: () => ipcRenderer.invoke('lib:list'),
  libImport: (srcPath) => ipcRenderer.invoke('lib:import', { srcPath }),
  libRename: (id, name) => ipcRenderer.invoke('lib:rename', { id, name }),
  libRemove: (id) => ipcRenderer.invoke('lib:remove', { id }),
  libApply: (soundId, id) => ipcRenderer.invoke('lib:apply', { soundId, id }),

  webProviders: () => ipcRenderer.invoke('web:providers'),
  webSearch: (providerId, query, limit) => ipcRenderer.invoke('web:search', { providerId, query, limit }),
  webApply: (soundId, result) => ipcRenderer.invoke('web:apply', { soundId, result }),
  webApplyUrl: (soundId, url) => ipcRenderer.invoke('web:applyUrl', { soundId, url }),

  revealSound: (soundId) => ipcRenderer.invoke('shell:revealSound', { soundId }),
  openVault: () => ipcRenderer.invoke('shell:openVault'),

  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('catalog:progress', handler);
    return () => ipcRenderer.removeListener('catalog:progress', handler);
  },

  /** Sciezka pliku upuszczonego na okno (drag & drop z Eksploratora). */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
