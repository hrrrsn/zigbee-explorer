// app.js
const { app, BrowserWindow, ipcMain } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

let server;
let store;
let appWindow;

function createConnectionManagerWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'public', 'connections.html'));
  // win.webContents.openDevTools();
}

function createAppWindow(url) {
  if (appWindow) {
    appWindow.focus();
    appWindow.loadURL(url);
    return;
  }

  appWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  appWindow.loadURL(url);

  // appWindow.webContents.openDevTools();

  appWindow.on('closed', () => {
    appWindow = null;
  });
}

async function createServerProcess(connection) {
  if (server) {
    server.kill();
  }

  // Dynamically import `get-port` to ensure ES module compatibility
  const { default: getPort } = await import('get-port');

  // Specify the port range directly
  const freePort = await getPort({ port: [3000, 65535] });

  console.log(`Starting server process on port ${freePort}...`);
  
  server = fork(path.join(__dirname, 'server.js'), [], {
    env: {
      ...process.env,
      LISTEN_PORT: freePort,
      MQTT_SERVER: `mqtt://${connection.server}:${connection.port}`,
      MQTT_TOPIC: connection.topic,
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  const connectionManager = BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('connections.html')
  );

  if (!connectionManager) {
    console.error('Connection manager window not found');
    return;
  }

  // Attach stdout listener
  server.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      connectionManager.webContents.send('console-log', output);
    }
  });

  // Attach stderr listener
  server.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      connectionManager.webContents.send('console-log', `[ERROR] ${output}`);
    }
  });

  // Handle server messages
  server.on('message', (msg) => {
    if (msg === 'mqtt-connected') {
      const url = `http://localhost:${freePort}`;
      console.log(`Opening window: ${url}`);

      createAppWindow(url);

      connectionManager.webContents.send('connection-status', {
        status: 'connected',
        id: connection.id,
      });
    }
  });

  // Handle server errors
  server.on('error', (err) => {
    console.error(`Server process error: ${err}`);
    connectionManager.webContents.send('console-log', `[ERROR] Server process error: ${err.message}`);
    connectionManager.webContents.send('connection-status', {
      status: 'error',
      id: connection.id,
    });
  });

  // Handle server exit
  server.on('exit', (code, signal) => {
    console.log(`Server process exited with code ${code} and signal ${signal}`);
  });

  return server;
}

app.whenReady().then(() => {
  import('electron-store').then((mod) => {
    store = new mod.default();

    createConnectionManagerWindow();

    let buildInfo;
    const buildFilePath = path.join(__dirname, 'build.json');
    if (fs.existsSync(buildFilePath)) {
      try {
        buildInfo = JSON.parse(fs.readFileSync(buildFilePath, 'utf8'));
      } catch (error) {
        console.error('Failed to parse build.json:', error);
      }
    }

    ipcMain.handle('get-app-version', () => {
      if (buildInfo) {
        const { version, build, commit } = buildInfo;
        return `${build} (${commit})`;
      } else {
        let version = 'unknown';
        let branch = 'unknown';
        let commit = 'unknown';

        try {
          const packageJson = require('./package.json');
          version = packageJson.version;
        } catch (error) {
          console.error('Failed to read package.json:', error);
        }

        try {
          branch = require('git-branch').sync();
        } catch (error) {
          console.error('Failed to get git branch:', error);
        }

        try {
          commit = require('git-rev-sync').short();
        } catch (error) {
          console.error('Failed to get git commit:', error);
        }

        console.log(`zigbee-explorer ${version} (${branch}:${commit})`);

        return `${version}-dev (${branch}:${commit})`;
        
      }
    });

    ipcMain.handle('get-connections', () => store.get('connections', []));

    ipcMain.handle('save-connection', (_, connection) => {
      const connections = store.get('connections', []);
      if (connection.id) {
        const index = connections.findIndex((c) => c.id === connection.id);
        connections[index] = connection;
      } else {
        connection.id = Date.now();
        connections.push(connection);
      }
      store.set('connections', connections);
    });

    ipcMain.handle('delete-connection', (_, id) => {
      const connections = store.get('connections', []).filter((c) => c.id !== id);
      store.set('connections', connections);
    });

    ipcMain.handle('connect-to-server', async (_, connection) => {
      try {
        const serverProcess = await createServerProcess(connection);
        if (!serverProcess) {
          throw new Error('Failed to create server process');
        }
        return { success: true };
      } catch (error) {
        console.error('Failed to connect to server:', error);
        const connectionManager = BrowserWindow.getAllWindows().find(win => 
          win.webContents.getURL().includes('connection-manager.html')
        );
        if (connectionManager) {
          connectionManager.webContents.send('console-log', `[ERROR] ${error.message}`);
          connectionManager.webContents.send('connection-status', {
            status: 'error',
            id: connection.id,
          });
        }
        return { success: false, error: error.message };
      }
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createConnectionManagerWindow();
  });
});

app.on('before-quit', () => {
  if (server) {
    server.kill();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});