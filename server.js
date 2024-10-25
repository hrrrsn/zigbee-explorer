const express = require('express');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const moment = require('moment');
const path = require('path');

const app = express();
const port = 3000;

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
    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        mqttClient.subscribe(MQTT_TOPIC, (err) => {
            if (err) {
                console.error('Failed to subscribe to topic:', err.message);
            } else {
                console.log(`Subscribed to topic: ${MQTT_TOPIC}`);
            }
        });
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT Connection Error:', err.message);
    });

    mqttClient.on('offline', () => {
        console.log('MQTT client offline. Attempting to reconnect...');
    });

    mqttClient.on('reconnect', () => {
        console.log('Reconnecting to MQTT broker...');
    });

    mqttClient.on('message', (topic, message) => {
        const payload = JSON.parse(message.toString());
        const deviceData = payload.ZbReceived ? Object.values(payload.ZbReceived)[0] : null;
        console.log('Received message:', deviceData);

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

setupMqttClient();

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    ws.send(JSON.stringify({ devices, messageLogs: deviceHistory }));
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

app.get('/css/bootstrap.min.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.min.css'));
});

app.get('/js/moment.min.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'moment', 'min', 'moment.min.js'));
});

app.use(express.static('public'));

const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});