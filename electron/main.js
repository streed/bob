const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

// Read version from VERSION file
let appVersion = '0.0.1'; // fallback
try {
  const versionPath = path.join(__dirname, '..', 'VERSION');
  appVersion = fs.readFileSync(versionPath, 'utf8').trim();
} catch (error) {
  console.warn('Could not read VERSION file, using fallback version');
}

// Enable live reload for Electron in development
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

class BobApp {
  constructor() {
    this.mainWindow = null;
    this.backendProcess = null;
    this.backendPort = 43829;
    this.isDev = process.env.NODE_ENV === 'development';
    this.userDataPath = app.getPath('userData');
    this.dbPath = path.join(this.userDataPath, 'bob.sqlite');
  }

  createWindow() {
    // Create the browser window
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: false, // Allow WebSocket connections to localhost
        allowRunningInsecureContent: true // Allow localhost connections
      },
      icon: path.join(__dirname, 'assets', 'icon.png'),
      title: 'Bob - Claude Code Manager',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      show: false // Don't show until ready
    });

    // Remove menu bar on Windows/Linux
    if (process.platform !== 'darwin') {
      this.mainWindow.setMenuBarVisibility(false);
    }

    // Show window when ready to prevent visual flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Load the app
    if (this.isDev) {
      // In development, connect to Vite dev server
      this.mainWindow.loadURL('http://localhost:47285');
      this.mainWindow.webContents.openDevTools();
    } else {
      // In production, load from the backend server
      this.waitForBackendThenLoad();
    }

    // Handle external links
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Handle window closed
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  async waitForBackendThenLoad() {
    const maxAttempts = 30;
    let attempts = 0;

    const checkBackend = async () => {
      try {
        const response = await fetch(`http://localhost:${this.backendPort}/api/health`);
        if (response.ok) {
          this.mainWindow.loadURL(`http://localhost:${this.backendPort}`);
          return;
        }
      } catch (error) {
        // Backend not ready yet
      }

      attempts++;
      if (attempts >= maxAttempts) {
        this.showBackendError();
        return;
      }

      setTimeout(checkBackend, 1000);
    };

    checkBackend();
  }

  showBackendError() {
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bob - Backend Error</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
          .error { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
          h1 { color: #e74c3c; margin-bottom: 20px; }
          p { margin-bottom: 15px; line-height: 1.6; }
          .code { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>⚠️ Backend Service Error</h1>
          <p>Bob's backend service failed to start. This usually happens when:</p>
          <ul style="text-align: left; display: inline-block;">
            <li>Port ${this.backendPort} is already in use</li>
            <li>Node.js dependencies are missing</li>
            <li>Database permissions issue</li>
          </ul>
          <p>Please restart the application or check the console for more details.</p>
          <div class="code">Database: ${this.dbPath}</div>
        </div>
      </body>
      </html>
    `;
    this.mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  }

  startBackendProcess() {
    if (this.isDev) {
      // In development, assume backend is started separately
      return;
    }

    const backendPath = path.join(__dirname, '..', 'backend', 'dist', 'server.js');

    // Check if backend build exists
    if (!fs.existsSync(backendPath)) {
      dialog.showErrorBox('Backend Missing',
        'Backend build not found. Please run "npm run build" first.');
      app.quit();
      return;
    }

    // Set environment variables
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: this.backendPort.toString(),
      DB_PATH: this.dbPath
    };

    // Start backend process
    this.backendProcess = spawn('node', [backendPath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..')
    });

    this.backendProcess.stdout.on('data', (data) => {
      console.log('Backend:', data.toString());
    });

    this.backendProcess.stderr.on('data', (data) => {
      console.error('Backend error:', data.toString());
    });

    this.backendProcess.on('exit', (code) => {
      console.log('Backend process exited with code:', code);
      if (code !== 0 && !app.isQuitting) {
        dialog.showErrorBox('Backend Crashed',
          `Backend process exited with code ${code}. The application will close.`);
        app.quit();
      }
    });
  }

  setupAppEventHandlers() {
    // macOS: App re-activated
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });

    // All windows closed
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // App quitting
    app.on('before-quit', () => {
      app.isQuitting = true;

      // Stop backend process
      if (this.backendProcess && !this.backendProcess.killed) {
        this.backendProcess.kill('SIGTERM');

        // Force kill after 5 seconds
        setTimeout(() => {
          if (!this.backendProcess.killed) {
            this.backendProcess.kill('SIGKILL');
          }
        }, 5000);
      }
    });

    // Handle app ready
    app.whenReady().then(() => {
      this.createApplicationMenu();
      this.startBackendProcess();
      this.createWindow();
      this.setupIpcHandlers();
    });
  }

  createApplicationMenu() {
    const template = [
      ...(process.platform === 'darwin' ? [{
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }] : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Repository...',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              this.openRepositoryDialog();
            }
          },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' },
          ...(process.platform === 'darwin' ? [
            { type: 'separator' },
            { role: 'front' }
          ] : [])
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About Bob',
            click: () => {
              dialog.showMessageBox(this.mainWindow, {
                type: 'info',
                title: 'About Bob',
                message: 'Bob - Claude Code Manager',
                detail: `Version: ${appVersion}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n\nBob helps you manage multiple Claude Code instances across git repositories and worktrees.`
              });
            }
          },
          {
            label: 'Open Data Directory',
            click: () => {
              shell.openPath(this.userDataPath);
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  async openRepositoryDialog() {
    const result = await dialog.showOpenDialog(this.mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Repository Directory'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      // Send the selected path to the renderer process
      this.mainWindow.webContents.send('repository-selected', result.filePaths[0]);
    }
  }

  setupIpcHandlers() {
    // Handle repository selection from menu
    ipcMain.handle('select-repository', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Repository Directory'
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    });

    // Get app info
    ipcMain.handle('get-app-info', () => {
      return {
        version: appVersion,
        platform: process.platform,
        userDataPath: this.userDataPath,
        dbPath: this.dbPath
      };
    });
  }

  initialize() {
    // Handle certificate errors (for development)
    app.commandLine.appendSwitch('ignore-certificate-errors');

    // Set app user model ID (Windows)
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.bob.claude-manager');
    }

    this.setupAppEventHandlers();
  }
}

// Initialize and start the app
const bobApp = new BobApp();
bobApp.initialize();