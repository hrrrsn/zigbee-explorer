const { ipcRenderer } = require('electron');

async function loadConnections() {
  const connections = await ipcRenderer.invoke('get-connections');
  const table = document.getElementById('connections-table');
  table.innerHTML = connections.map((c) => `
    <tr>
      <td>${c.server}:${c.port}</td>
      <td>${c.topic}</td>
      <td>
        <button onclick="editConnection(${c.id})" class="btn btn-warning btn-sm">Edit</button>
        <button onclick="deleteConnection(${c.id})" class="btn btn-danger btn-sm">Delete</button>
        <button id="connect-${c.id}" onclick="connectToServer(${c.id})" class="btn btn-success btn-sm">Connect</button>
      </td>
    </tr>
  `).join('');

  if (connections.length === 0) {
    const modal = new bootstrap.Modal(document.getElementById('connectionModal'));
    modal.show();
  }
}

document.getElementById('add-connection').addEventListener('click', () => {
  document.getElementById('connection-form').reset();
  document.getElementById('connection-id').value = '';
  const modal = new bootstrap.Modal(document.getElementById('connectionModal'));
  modal.show();
});

document.getElementById('save-connection').addEventListener('click', async () => {
  const connection = {
    id: document.getElementById('connection-id').value || null,
    server: document.getElementById('connection-server').value,
    port: document.getElementById('connection-port').value || '1883',
    topic: document.getElementById('connection-topic').value,
  };
  await ipcRenderer.invoke('save-connection', connection);
  loadConnections();
  bootstrap.Modal.getInstance(document.getElementById('connectionModal')).hide();
});

async function editConnection(id) {
  const connections = await ipcRenderer.invoke('get-connections');
  const connection = connections.find((c) => c.id === id);
  if (connection) {
    document.getElementById('connection-id').value = connection.id;
    document.getElementById('connection-server').value = connection.server;
    document.getElementById('connection-port').value = connection.port;
    document.getElementById('connection-topic').value = connection.topic;
    const modal = new bootstrap.Modal(document.getElementById('connectionModal'));
    modal.show();
  }
}

async function deleteConnection(id) {
  event.stopPropagation();
  await ipcRenderer.invoke('delete-connection', id);
  loadConnections();
}

async function connectToServer(id) {
  const connections = await ipcRenderer.invoke('get-connections');
  const connection = connections.find((c) => c.id === id);
  const connectButton = document.getElementById(`connect-${id}`);
  
  connectButton.className = 'btn btn-warning btn-sm';
  connectButton.textContent = 'Connecting...';
  
  const result = await ipcRenderer.invoke('connect-to-server', connection);
  
  if (!result.success) {
    connectButton.className = 'btn btn-danger btn-sm';
    connectButton.textContent = 'Error - Retry';
  }
}

// Enhanced console output handling
ipcRenderer.on('console-log', (event, log) => {
  const consoleOutput = document.getElementById('console-output');
  const timestamp = new Date().toLocaleTimeString();
  consoleOutput.value += `[${timestamp}] ${log}\n`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
});

// Enhanced connection status handling
ipcRenderer.on('connection-status', (event, { status, id }) => {
  const button = document.getElementById(`connect-${id}`);
  switch (status) {
    case 'connecting':
      button.className = 'btn btn-warning btn-sm';
      button.textContent = 'Connecting...';
      break;
    case 'connected':
      button.className = 'btn btn-success btn-sm';
      button.textContent = 'Connected';
      break;
    case 'disconnected':
      button.className = 'btn btn-secondary btn-sm';
      button.textContent = 'Connect';
      break;
    case 'error':
      button.className = 'btn btn-danger btn-sm';
      button.textContent = 'Error - Retry';
      break;
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const version = await ipcRenderer.invoke('get-app-version');
  document.getElementById('version-number').textContent = `${version}`;
  
  // Clear console output on load
  const consoleOutput = document.getElementById('console-output');
  consoleOutput.value = '';
});

loadConnections();