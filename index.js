const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected devices
const connectedDevices = new Map();
const deviceSessions = new Map();

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Ketty-5 Server Running',
    connectedDevices: connectedDevices.size,
    timestamp: new Date().toISOString()
  });
});

// Device registration endpoint
app.post('/register', (req, res) => {
  const { deviceId, deviceInfo } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }
  
  connectedDevices.set(deviceId, {
    ...deviceInfo,
    lastSeen: new Date(),
    status: 'online'
  });
  
  console.log(`Device registered: ${deviceId}`);
  res.json({ success: true, message: 'Device registered' });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const deviceId = uuidv4();
  console.log(`New WebSocket connection: ${deviceId}`);
  
  ws.deviceId = deviceId;
  connectedDevices.set(deviceId, {
    ws: ws,
    connectedAt: new Date(),
    status: 'connected'
  });
  
  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connection_established',
    deviceId: deviceId,
    timestamp: new Date().toISOString()
  }));
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`Device disconnected: ${deviceId}`);
    connectedDevices.delete(deviceId);
    
    // Notify other devices about disconnection
    broadcastToControllers({
      type: 'device_disconnected',
      deviceId: deviceId,
      timestamp: new Date().toISOString()
    });
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${deviceId}:`, error);
  });
});

function handleMessage(ws, message) {
  const { type, fromDevice, toDevice, data } = message;
  
  console.log(`Message from ${fromDevice} to ${toDevice}: ${type}`);
  
  switch (type) {
    case 'device_register':
      // Controlled device registration
      handleDeviceRegistration(ws, message);
      break;
      
    case 'controller_connect':
      // Controller connecting to device
      handleControllerConnect(ws, message);
      break;
      
    case 'command':
      // Forward command to target device
      forwardCommand(message);
      break;
      
    case 'response':
      // Forward response back to controller
      forwardResponse(message);
      break;
      
    case 'ping':
      // Heartbeat/ping
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
      
    default:
      console.log('Unknown message type:', type);
  }
}

function handleDeviceRegistration(ws, message) {
  const { deviceId, deviceInfo } = message.data;
  
  connectedDevices.set(deviceId, {
    ws: ws,
    deviceInfo: deviceInfo,
    type: 'controlled',
    connectedAt: new Date(),
    status: 'online'
  });
  
  ws.deviceId = deviceId;
  
  console.log(`Controlled device registered: ${deviceId}`);
  
  // Notify all controllers about new device
  broadcastToControllers({
    type: 'device_online',
    deviceId: deviceId,
    deviceInfo: deviceInfo,
    timestamp: new Date().toISOString()
  });
}

function handleControllerConnect(ws, message) {
  const { targetDeviceId } = message.data;
  
  connectedDevices.set(ws.deviceId, {
    ws: ws,
    type: 'controller',
    targetDevice: targetDeviceId,
    connectedAt: new Date(),
    status: 'connected'
  });
  
  console.log(`Controller ${ws.deviceId} connected to device ${targetDeviceId}`);
}

function forwardCommand(message) {
  const { toDevice, data } = message;
  const targetDevice = connectedDevices.get(toDevice);
  
  if (targetDevice && targetDevice.ws.readyState === WebSocket.OPEN) {
    targetDevice.ws.send(JSON.stringify({
      type: 'command',
      data: data,
      fromDevice: message.fromDevice
    }));
    console.log(`Command forwarded to ${toDevice}`);
  } else {
    console.log(`Target device ${toDevice} not found or not connected`);
  }
}

function forwardResponse(message) {
  const { toDevice, data } = message;
  const targetController = connectedDevices.get(toDevice);
  
  if (targetController && targetController.ws.readyState === WebSocket.OPEN) {
    targetController.ws.send(JSON.stringify({
      type: 'response',
      data: data,
      fromDevice: message.fromDevice
    }));
  }
}

function broadcastToControllers(message) {
  connectedDevices.forEach((device, deviceId) => {
    if (device.type === 'controller' && device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(JSON.stringify(message));
    }
  });
}

// Get connected devices list
app.get('/devices', (req, res) => {
  const devicesList = [];
  
  connectedDevices.forEach((device, deviceId) => {
    if (device.type === 'controlled') {
      devicesList.push({
        deviceId: deviceId,
        deviceInfo: device.deviceInfo,
        connectedAt: device.connectedAt,
        status: device.status
      });
    }
  });
  
  res.json(devicesList);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Ketty-5 Server running on port ${PORT}`);
  console.log(`🌐 WebSocket: wss://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
});
