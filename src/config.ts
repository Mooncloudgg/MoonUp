export const TEXTS = {
  // ... (Buttons und Status bleiben gleich)
  buttons: {
    install: "Installieren",
    update: "Update",
    current: "✔ Aktuell",
    deleteTitle: "Löschen",
    refresh: "Aktualisieren",
    pathBtn: "Pfad wählen",
    wait: "...",
    error: "Err",
    check: "Prüfen",
    checking: "...",
    keyOk: "OK",
    keyErr: "Fehler"
  },
  status: {
    ready: "Bereit.",
    searching: "Suche Updates...",
    installing: "Installiere",
    done: "Fertig!",
    deleted: "gelöscht.",
    checkError: "Fehler beim Prüfen",
    authError: "Token ungültig / Zugriff verweigert"
  },
  versions: {
    localLabel: "Lokal:",
    remoteLabel: "GitHub:",
    checking: "Prüfen...",
    missing: "...",
    folderMissing: "Nicht installiert",
    tocMissing: "Beschädigt",
    tokenError: "Token ungültig",
    optionalHeader: "Optionale Addons" 
  },
  alerts: {
    noToken: "⚠️ Token erforderlich: Updates deaktiviert",
    pathMissing: "Bitte WoW-Pfad auswählen",
  },
  dialogs: {
    deleteTitle: "Addon löschen",
    deleteConfirm: (name: string) => `Möchtest du "${name}" wirklich unwiderruflich löschen?`,
    deleteOk: "Addon löschen!",
    deleteCancel: "Abbrechen"
  }
};

export const ADDONS = [
  { 
    label: "TimelineReminders", 
    folder: "TimelineReminders", 
    search: "Timeline", 
    repo: "Mooncloudgg/MoonReminder" 
  },
  { 
    label: "MooncloudTools", 
    folder: "MooncloudTools", 
    search: "Moonc", 
    repo: "Mooncloudgg/MooncloudTools" 
  },
  { 
    label: "QUI", 
    folder: "QUI", 
    search: "Version", 
    repo: "zol-wow/QUI",
    isOptional: true 
  }
];