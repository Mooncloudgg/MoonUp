export interface AddonItem {
  id: string;
  label: string;
  folder: string;
  search: string;
  repo: string;
  provider: "mooncloud" | "github" | "curseforge";
  directUrl?: string;
  icon?: string;
  fallbackInitials?: string;
}

export const API_CONFIG = {
  baseUrl: "https://mooncloud.team",
  authLoginUrl: "https://mooncloud.team/auth/login",
  authCheckUrl: "https://mooncloud.team/auth/check",
  clientVersion: "2.0.0",
  githubRepo: "Mooncloudgg/MoonUp"
};

export const TEXTS = {
  app: {
    title: "Moonup",
    version: "v2.0",
  },
  buttons: {
    login: "Login mit Discord",
    loggingIn: "Warten auf Bestätigung...",
    install: "Installieren",
    update: "Update",
    downloading: "Lade...",
    current: "Aktuell",
    deleteTitle: "Löschen",
    refresh: "Prüfen",
    pathBtn: "Ändern",
    openFolder: "Explorer",
    updateAll: "Alle aktualisieren",
    allCurrent: "Alle Addons aktuell",
    logout: "Abmelden",
  },
  status: {
    ready: "Bereit.",
    searching: "Suche Updates...",
    installing: "Installiere: ",
    done: "Erfolgreich aktualisiert.",
    deleted: "Gelöscht.",
    checkError: "Fehler beim Abgleich",
    authError: "Authentifizierung fehlgeschlagen",
    denied: "Zugriff verweigert (Rolle fehlt)",
    expired: "Sitzung abgelaufen",
    autoDetected: "WoW-Pfad erkannt",
  },
  dialogs: {
    deleteConfirm: (name: string) => `"${name}" wirklich aus WoW löschen?`,
    deleteAllConfirm: "Wirklich alle Addons löschen?",
  },
};

export const ADDONS: AddonItem[] = [
  {
    id: "mooncloud-tools",
    label: "MooncloudTools",
    folder: "MooncloudTools",
    search: "Moonc",
    repo: "Mooncloudgg/MooncloudTools",
    provider: "mooncloud",
    icon: "/src/assets/Moonup_logo.png",
    fallbackInitials: "MC"
  },
  {
    id: "timeline-reminders",
    label: "TimelineReminders",
    folder: "TimelineReminders",
    search: "Timeline",
    repo: "Mooncloudgg/MoonReminder",
    provider: "mooncloud",
    icon: "https://raw.githubusercontent.com/Mooncloudgg/MoonReminder/main/icon.png",
    fallbackInitials: "TR"
  },
  {
    id: "wowutils",
    label: "WoWUtils",
    folder: "WoWUtils",
    search: "WoWUtils",
    repo: "1620704",
    provider: "curseforge",
    icon: "https://media.forgecdn.net/avatars/1010/893/638531061909831952.png",
    fallbackInitials: "WU"
  },
  {
    id: "nsrt",
    label: "NorthernSkyRT",
    folder: "NorthernSkyRaidTools",
    search: "North",
    repo: "954018",
    provider: "curseforge",
    icon: "https://media.forgecdn.net/avatars/862/282/638344781498498498.png",
    fallbackInitials: "NS"
  }
];