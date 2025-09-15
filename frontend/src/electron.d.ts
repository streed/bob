// Electron API types
interface ElectronAPI {
  selectRepository: () => Promise<string | null>;
  getAppInfo: () => Promise<{
    version: string;
    platform: string;
    userDataPath: string;
    dbPath: string;
  }>;
  onRepositorySelected: (callback: (path: string) => void) => void;
  removeRepositorySelectedListener: () => void;
  platform: string;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};