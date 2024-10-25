const express = require('express');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const moment = require('moment');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.LISTEN_PORT || 3000;

const MQTT_SERVER = process.env.MQTT_SERVER || 'mqtt://localhost';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'tele/tasmota/SENSOR';

const mqttOptions = {
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000
};

let mqttClient = mqtt.connect(MQTT_SERVER, mqttOptions);
let devices = {};
let deviceHistory = {};

function setupMqttClient() {
    console.log('[MQTT] Establishing connection to broker', MQTT_SERVER);

    const timeout = setTimeout(() => {
        console.error('[MQTT] Connection timeout. Unable to connect to broker', MQTT_SERVER);
        process.exit(1);
    }, 2 * 1000);

    mqttClient.on('connect', () => {
        clearTimeout(timeout);
        console.log('[MQTT] Connected to broker', MQTT_SERVER);
        
        if (process.send) {
            process.send('mqtt-connected');
        }
        mqttClient.subscribe(MQTT_TOPIC, (err) => {
            if (err) {
                console.error('[MQTT] Failed to subscribe to topic:', err.message);
            } else {
                console.log(`[MQTT] Subscribed to topic: ${MQTT_TOPIC}`);
            }
        });
    });

    mqttClient.on('error', (err) => {
        console.error('[MQTT] Connection Error:', err.message);
    });

    mqttClient.on('offline', () => {
        console.log('[MQTT] Lost connection to broker. Attempting to reconnect...');
    });

    mqttClient.on('reconnect', () => {
        console.log('[MQTT] Reconnecting to MQTT broker...');
    });

    mqttClient.on('message', (topic, message) => {
        const payload = JSON.parse(message.toString());
        const deviceData = payload.ZbReceived ? Object.values(payload.ZbReceived)[0] : null;
        console.log('[ZigBee] ', deviceData);

        if (deviceData) {
            deviceData.timestamp = moment().format('YYYY-MM-DD HH:mm:ss');

            if (!devices[deviceData.Device]) {
                devices[deviceData.Device] = { ...deviceData, messageCount: 1 };
            } else {
                devices[deviceData.Device].messageCount += 1;
                devices[deviceData.Device] = {
                    ...devices[deviceData.Device],
                    ...deviceData,
                    BatteryPercentage: deviceData.BatteryPercentage || devices[deviceData.Device].BatteryPercentage,
                };
            }

            if (!deviceHistory[deviceData.Device]) {
                deviceHistory[deviceData.Device] = [];
            }

            deviceHistory[deviceData.Device].unshift({
                timestamp: deviceData.timestamp,
                data: deviceData
            });

            broadcast({
                devices,
                latestMessage: { topic, payload: deviceData, raw: payload },
            });
        }
    });
}

function getVersionInfo() {
    const buildFilePath = path.join(__dirname, 'build.json');
    if (fs.existsSync(buildFilePath)) {
        const buildData = JSON.parse(fs.readFileSync(buildFilePath, 'utf8'));
        return `${buildData.build} (${buildData.commit})`;
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
}

setupMqttClient();

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    console.log('[WebSocket] Connection established from', ws._socket.remoteAddress);
    ws.send(JSON.stringify({ devices, messageLogs: deviceHistory }));

    ws.send(JSON.stringify({
        mqttServer: MQTT_SERVER,
        mqttTopic: MQTT_TOPIC,
        version: getVersionInfo()
    }));
});

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

app.get('/api/devices', (req, res) => {
    res.json(Object.values(devices));
});

app.get('/api/devices/:id/history', (req, res) => {
    const id = req.params.id;
    res.json(deviceHistory[id] || []);
});

app.get('/api/status', (req, res) => {
    res.json({
        mqttServer: MQTT_SERVER,
        mqttTopic: MQTT_TOPIC,
        mqttStatus: mqttClient.connected
    });
});

app.get('/css/bootstrap.min.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.min.css'));
});

app.get('/js/moment.min.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'moment', 'min', 'moment.min.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(port, () => {
    console.log(`[Express] Server listening on port ${port}`);
    if (process.send) {
        process.send('server-started');
    }
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});