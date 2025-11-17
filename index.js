const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected devices
const connectedDevices = new Map();

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: '✅ Ketty-5 Server Running',
    connectedDevices: connectedDevices.size,
    timestamp: new Date().toISOString(),
    message: 'Server ready for connections'
  });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const deviceId = uuidv4();
  console.log(`🔗 New connection: ${deviceId}`);
  
  ws.deviceId = deviceId;
  connectedDevices.set(deviceId, {
    ws: ws,
    connectedAt: new Date(),
    status: 'connected',
    type: 'unknown'
  });
  
  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connection_established',
    deviceId: deviceId,
    message: 'Connected to Ketty-5 Server',
    timestamp: new Date().toISOString()
  }));
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (error) {
      console.error('❌ Error parsing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid JSON format'
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`📴 Device disconnected: ${deviceId}`);
    const device = connectedDevices.get(deviceId);
    
    if (device && device.type === 'controlled') {
      // Notify controllers about device disconnect
      broadcastToControllers({
        type: 'device_disconnected',
        deviceId: deviceId,
        deviceInfo: device.deviceInfo,
        timestamp: new Date().toISOString()
      });
    }
    
    connectedDevices.delete(deviceId);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`💥 WebSocket error:`, error);
  });
});

function handleMessage(ws, message) {
  const { type, data } = message;
  
  console.log(`📨 Message type: ${type} from ${ws.deviceId}`);
  
  switch (type) {
    case 'register_controlled':
      // Controlled device registration
      handleControlledRegistration(ws, data);
      break;
      
    case 'register_controller':
      // Controller registration
      handleControllerRegistration(ws, data);
      break;
      
    case 'command':
      // Command from controller to controlled
      forwardCommand(ws, data);
      break;
      
    case 'response':
      // Response from controlled to controller
      forwardResponse(ws, data);
      break;
      
    case 'ping':
      // Heartbeat
      ws.send(JSON.stringify({ 
        type: 'pong', 
        timestamp: new Date().toISOString() 
      }));
      break;
      
    default:
      console.log('❓ Unknown message type:', type);
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`
      }));
  }
}

function handleControlledRegistration(ws, data) {
  const { deviceId, deviceInfo } = data;
  
  if (!deviceId) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Device ID is required'
    }));
    return;
  }
  
  connectedDevices.set(deviceId, {
    ws: ws,
    deviceInfo: deviceInfo,
    type: 'controlled',
    connectedAt: new Date(),
    status: 'online'
  });
  
  ws.deviceId = deviceId;
  
  console.log(`📱 Controlled device registered: ${deviceId}`);
  console.log(`📊 Device info:`, deviceInfo);
  
  // Send confirmation to controlled device
  ws.send(JSON.stringify({
    type: 'registration_success',
    deviceId: deviceId,
    message: 'Device registered successfully',
    timestamp: new Date().toISOString()
  }));
  
  // Notify all controllers about new device
  broadcastToControllers({
    type: 'device_online',
    deviceId: deviceId,
    deviceInfo: deviceInfo,
    timestamp: new Date().toISOString()
  });
}

function handleControllerRegistration(ws, data) {
  const { controllerId } = data;
  
  connectedDevices.set(controllerId, {
    ws: ws,
    type: 'controller',
    connectedAt: new Date(),
    status: 'online'
  });
  
  ws.deviceId = controllerId;
  
  console.log(`🎮 Controller registered: ${controllerId}`);
  
  // Send list of available devices to controller
  const availableDevices = getAvailableDevices();
  ws.send(JSON.stringify({
    type: 'devices_list',
    devices: availableDevices,
    timestamp: new Date().toISOString()
  }));
  
  // Send confirmation
  ws.send(JSON.stringify({
    type: 'registration_success',
    controllerId: controllerId,
    message: 'Controller registered successfully',
    timestamp: new Date().toISOString()
  }));
}

function forwardCommand(ws, data) {
  const { targetDeviceId, command, commandData } = data;
  
  console.log(`📤 Forwarding command to: ${targetDeviceId}`);
  console.log(`🔧 Command: ${command}`);
  
  const targetDevice = connectedDevices.get(targetDeviceId);
  
  if (targetDevice && targetDevice.ws.readyState === WebSocket.OPEN) {
    targetDevice.ws.send(JSON.stringify({
      type: 'command',
      fromDevice: ws.deviceId,
      command: command,
      data: commandData,
      timestamp: new Date().toISOString()
    }));
    
    console.log(`✅ Command forwarded to ${targetDeviceId}`);
    
    // Confirm to controller
    ws.send(JSON.stringify({
      type: 'command_sent',
      targetDeviceId: targetDeviceId,
      command: command,
      timestamp: new Date().toISOString()
    }));
  } else {
    console.log(`❌ Target device ${targetDeviceId} not found`);
    
    ws.send(JSON.stringify({
      type: 'error',
      message: `Device ${targetDeviceId} is not connected`,
      timestamp: new Date().toISOString()
    }));
  }
}

function forwardResponse(ws, data) {
  const { toDeviceId, response, responseData } = data;
  
  console.log(`📥 Forwarding response to: ${toDeviceId}`);
  
  const targetController = connectedDevices.get(toDeviceId);
  
  if (targetController && targetController.ws.readyState === WebSocket.OPEN) {
    targetController.ws.send(JSON.stringify({
      type: 'response',
      fromDevice: ws.deviceId,
      response: response,
      data: responseData,
      timestamp: new Date().toISOString()
    }));
    
    console.log(`✅ Response forwarded to ${toDeviceId}`);
  } else {
    console.log(`❌ Controller ${toDeviceId} not found`);
  }
}

function broadcastToControllers(message) {
  let sentCount = 0;
  
  connectedDevices.forEach((device, deviceId) => {
    if (device.type === 'controller' && device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(JSON.stringify(message));
      sentCount++;
    }
  });
  
  console.log(`📢 Broadcasted to ${sentCount} controllers`);
}

function getAvailableDevices() {
  const devices = [];
  
  connectedDevices.forEach((device, deviceId) => {
    if (device.type === 'controlled') {
      devices.push({
        deviceId: deviceId,
        deviceInfo: device.deviceInfo,
        connectedAt: device.connectedAt,
        status: device.status
      });
    }
  });
  
  return devices;
}

// API endpoint to get connected devices
app.get('/devices', (req, res) => {
  const devices = getAvailableDevices();
  res.json({
    status: 'success',
    count: devices.length,
    devices: devices,
    timestamp: new Date().toISOString()
  });
});

// API endpoint to get server stats
app.get('/stats', (req, res) => {
  const stats = {
    totalConnections: connectedDevices.size,
    controllers: 0,
    controlledDevices: 0,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
  
  connectedDevices.forEach((device) => {
    if (device.type === 'controller') stats.controllers++;
    if (device.type === 'controlled') stats.controlledDevices++;
  });
  
  res.json(stats);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Ketty-5 Server Started!`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 HTTP: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  console.log(`🔗 WebSocket: wss://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log(`\n✅ Server ready for connections...\n`);
});
