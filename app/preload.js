const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApi', {
    getorglist: async () => await ipcRenderer.invoke('getorglist'),
    selectfolder: () => ipcRenderer.invoke('selectfolder'),
    downloadeventlogs: (data) => ipcRenderer.invoke('downloadeventlogs', data),
    savesettings: (data) => ipcRenderer.invoke('savesettings', data),
    readsettings: async (data) => await ipcRenderer.invoke('readsettings'),
    canceldownload: () => ipcRenderer.invoke('canceldownload'),

    filesfound: (callback) => ipcRenderer.on('filesfound', callback),
    filedownloadupdate: (callback) => ipcRenderer.on('filedownloadupdate', callback),
    filedownloadcomplete: (callback) => ipcRenderer.on('filedownloadcomplete', callback),
    downloadcancelled: (callback) => ipcRenderer.on('downloadcancelled', callback),
    downloadincomplete: (callback) => ipcRenderer.on('downloadincomplete', callback)
    
});


// contextBridge.exposeInMainWorld('mainapi', {
//     send: (channel, data) => {
//       ipcRenderer.send(channel, data);
//     },
//     receive: (channel, callback) => {
//       ipcRenderer.on(channel, (_event, data) => {
//         callback(data);
//       });
//     }
// });

// window.addEventListener('DOMContentLoaded', () => {});

ipcRenderer.on(channel, (_event, arg) => {
 	console.log(arg);
});
