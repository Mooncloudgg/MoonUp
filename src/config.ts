export const API_CONFIG = {
  baseUrl: "https://moonup-auth.duckdns.org:5000"
};

export const TEXTS = {
  buttons: {
    login: "Login mit Discord",
    loggingIn: "Warte auf Login...",
    install: "Installieren",
    update: "Update",
    downloading: "Lade...", // NEU
    current: "✔ Aktuell",
    deleteTitle: "Löschen",
    refresh: "Aktualisieren",
    pathBtn: "Pfad wählen",
    wait: "...",
    error: "Err",
  },
  status: {
    ready: "Bereit.",
    searching: "Suche Updates...",
    installing: "Lade herunter & entpacke: ", // Angepasst
    done: "Fertig!",
    deleted: "gelöscht.",
    checkError: "Fehler beim Prüfen",
    authError: "Authentifizierung fehlgeschlagen",
    denied: "⛔ Zugriff verweigert (Rolle fehlt)",
    expired: "⏰ Login abgelaufen"
  },
  versions: {
    localLabel: "Lokal:",
    remoteLabel: "Server:",
    checking: "...",
    missing: "-",
    folderMissing: "Nicht installiert",
    tocMissing: "Unbekannt",
    tokenError: "Login erforderlich",
    optionalHeader: "Optionale Addons" 
  },
  alerts: {
    noToken: "⚠️ Bitte einloggen, um Addons zu laden.",
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