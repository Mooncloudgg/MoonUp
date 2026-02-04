export const TEXTS = {
  // --- BUTTONS ---
  buttons: {
    install: "Installieren",
    update: "Update",
    current: "✔ Aktuell",
    deleteTitle: "Löschen",
    refresh: "Aktualisieren",
    pathBtn: "Pfad wählen",
    wait: "...",
    error: "Err"
  },

  // --- STATUS MELDUNGEN ---
  status: {
    ready: "Bereit.",
    searching: "Suche Updates...",
    installing: "Installiere",
    done: "Fertig!",
    deleted: "gelöscht.",
    checkError: "Fehler beim Prüfen",
    authError: "Token ungültig / Zugriff verweigert"
  },

  // --- VERSION ANZEIGE ---
  versions: {
    localLabel: "Lokal:",
    remoteLabel: "GitHub:",
    checking: "Prüfen...",
    missing: "...",
    folderMissing: "Nicht installiert",
    tocMissing: "Beschädigt",
    // NEU: Text wenn der Token falsch ist
    tokenError: "Token ungültig",
  },

  // --- WARNUNGEN & FEHLER ---
  alerts: {
    noToken: "⚠️ Token erforderlich: Updates deaktiviert",
    pathMissing: "Bitte WoW-Pfad auswählen",
  },

  // --- DIALOGE ---
  dialogs: {
    deleteTitle: "Addon löschen",
    deleteConfirm: (name: string) => `Möchtest du "${name}" wirklich unwiderruflich löschen?`,
    deleteOk: "Weg damit!",
    deleteCancel: "Abbrechen"
  }
};

export const ADDONS = [
  { 
    label: "MoonReminder", 
    folder: "TimelineReminders", 
    search: "Timeline", 
    repo: "Mooncloudgg/MoonReminder" 
  },
  { 
    label: "MooncloudTools", 
    folder: "MooncloudTools", 
    search: "Moonc", 
    repo: "Mooncloudgg/MooncloudTools" 
  }
];