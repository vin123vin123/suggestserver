const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// 1. Core Environmental Settings
const mongoURI = process.env.MONGODB_URI;
const ENCRYPTION_KEY = process.env.CRYPTO_SECRET || 'abcdefghijklmnopqrstuvwxyz123456'; // Must be 32 bytes
const IV_LENGTH = 16; 

mongoose.connect(mongoURI)
  .then(() => console.log('Connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Database Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String, required: true }
}, { collection: 'unified_chat_users' });

const sessionLogSchema = new mongoose.Schema({
  username: { type: String, required: true },
  timeIn: { type: Date, default: Date.now },
  timeOut: { type: Date }
}, { collection: 'user_session_logs' });

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  encryptedMessage: { type: String, required: true }, 
  iv: { type: String, required: true },               
  timestamp: { type: Date, default: Date.now }
}, { collection: 'encrypted_chat_history' });

const User = mongoose.model('User', userSchema);
const SessionLog = mongoose.model('SessionLog', sessionLogSchema);
const Message = mongoose.model('Message', messageSchema);

const onlineUsers = new Map(); 

// 3. Symmetric Encryption Utilities
function encryptText(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted.toString('hex')
  };
}

// 4. HTTP API Endpoints
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing entries' });
    const cleanUsername = String(username).trim();
    const existingUser = await User.findOne({ username: cleanUsername });
    if (existingUser) return res.status(400).json({ error: 'Username taken' });

    const hashedPassword = await bcrypt.hash(String(password).trim(), 10);
    const user = new User({ username: cleanUsername, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User created' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = String(username).trim();
    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(String(password).trim(), user.password);
    if (!isMatch) return res.status(400).json({ error: 'Password mismatch' });
    res.status(200).json({ message: 'Login verification passed', username: cleanUsername });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// JSON API for dashboard telemetry data
app.get('/api/admin/data', async (req, res) => {
  try {
    const sessions = await SessionLog.find().sort({ timeIn: -1 }).limit(15);
    const activeUsers = Array.from(onlineUsers.keys());
    const rawMessages = await Message.find().sort({ timestamp: -1 }).limit(15);

    res.status(200).json({
      currentlyOnline: activeUsers,
      sessionTrackingLogs: sessions,
      encryptedVaultRecords: rawMessages
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// UI Web Route: Serves the visual dashboard directly to the browser
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Chat Core Server Dashboard</title>
      <script src="https://tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-gray-100 font-sans p-6">
      <div class="max-w-7xl mx-auto">
        <header class="mb-8 border-b border-gray-800 pb-4 flex justify-between items-center">
          <h1 class="text-3xl font-extrabold text-indigo-400">Chat Ecosystem Dashboard</h1>
          <span class="bg-green-500/20 text-green-400 text-xs px-2.5 py-1 rounded-full border border-green-500/30 font-medium">Live Telemetry Active</span>
        </header>

        <!-- Grid Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Column 1: Online Status -->
          <div class="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl">
            <h2 class="text-xl font-bold text-gray-200 mb-4 flex items-center gap-2">
              <span class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span> Currently Online
            </h2>
            <ul id="online-list" class="space-y-2"></ul>
          </div>

          <!-- Column 2: Session Timeline Tracking (Time-In / Time-Out) -->
          <div class="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl lg:col-span-2">
            <h2 class="text-xl font-bold text-gray-200 mb-4 text-indigo-300">User Session Logs (Time-In & Out)</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-gray-700 text-gray-400 text-sm">
                    <th class="pb-2">Username</th>
                    <th class="pb-2">Time In</th>
                    <th class="pb-2">Time Out</th>
                    <th class="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody id="session-table-body" class="text-sm divide-y divide-gray-700/50"></tbody>
              </table>
            </div>
          </div>

          <!-- Column 3: Encrypted Chat History Repository -->
          <div class="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl lg:col-span-3 mt-4">
            <h2 class="text-xl font-bold text-red-400 mb-4">Encrypted Database Message Vault (AES-256 Hex Storage)</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-gray-700 text-gray-400 text-sm">
                    <th class="pb-2">Timestamp</th>
                    <th class="pb-2">Sender</th>
                    <th class="pb-2">Recipient</th>
                    <th class="pb-2">Secure IV Token</th>
                    <th class="pb-2">Ciphertext (Encrypted Payload)</th>
                  </tr>
                </thead>
                <tbody id="vault-table-body" class="text-xs font-mono divide-y divide-gray-700/50"></tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      <script>
        async function fetchTelemetry() {
          try {
            const res = await fetch('/api/admin/data');
            const data = await res.json();
            
            // 1. Render Online Users
            const onlineList = document.getElementById('online-list');
            onlineList.innerHTML = data.currentlyOnline.length === 0 
              ? '<p class="text-gray-500 text-sm italic">No users active currently.</p>'
              : data.currentlyOnline.map(user => \`
                  <li class="bg-gray-700/40 border border-gray-700 px-3 py-2 rounded-lg flex items-center justify-between text-sm">
                    <span class="font-medium text-gray-300">\${user}</span>
                    <span class="w-2 h-2 bg-green-400 rounded-full"></span>
                  </li>
                \`).join('');

            // 2. Render Session Logs
            const sessionBody = document.getElementById('session-table-body');
            sessionBody.innerHTML = data.sessionTrackingLogs.map(log => {
              const timeIn = new Date(log.timeIn).toLocaleTimeString();
              const timeOut = log.timeOut ? new Date(log.timeOut).toLocaleTimeString() : '—';
              const badge = log.timeOut 
                ? '<span class="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Disconnected</span>'
                : '<span class="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded border border-green-500/20">Active</span>';
              
              return \`
                <tr class="hover:bg-gray-700/20">
                  <td class="py-3 font-medium text-indigo-200">\${log.username}</td>
                  <td class="py-3 text-gray-300">\${timeIn}</td>
                  <td class="py-3 text-gray-400">\${timeOut}</td>
                  <td class="py-3">\${badge}</td>
                </tr>
              \`;
            }).join('');

            // 3. Render Encrypted Chat Data
            const vaultBody = document.getElementById('vault-table-body');
            vaultBody.innerHTML = data.encryptedVaultRecords.map(msg => \`
              <tr class="hover:bg-gray-700/20 text-gray-400">
                <td class="py-2.5 text-gray-500">\${new Date(msg.timestamp).toLocaleTimeString()}</td>
                <td class="py-2.5 text-blue-400 font-sans font-medium">\${msg.sender}</td>
                <td class="py-2.5 text-purple-400 font-sans font-medium">\${msg.recipient}</td>

                <td class="py-2.5 text-amber-500/80 truncate max-w-[120px] font-mono">\${msg.iv}</td>
                <td class="py-2.5 text-red-400/90 break-all max-w-sm font-mono font-semibold truncate hover:whitespace-normal">\${msg.encryptedMessage}</td>
              </tr>
            \`).join('');

          } catch (err) {
console.error("Telemetry collection interrupted:", err);}}
// Run data compilation loops every 2 
secondsfetchTelemetry();setInterval(fetchTelemetry, 2000);`);});// 5. 

WebSocket Real-Time Handlersio.on('connection', (socket) => {socket.on('identify', async (username) => {socket.username = username;
const newLog = new SessionLog({ username: username, timeIn: new Date() });
await newLog.save();onlineUsers.set(username, { socketId: socket.id, logId: newLog._id });
console.log([Session Logged] ${username} connected.);});
socket.on('private_message', async ({ recipient, message }) => {const cryptoPayload = encryptText(message);const secureMessage = new Message({sender: socket.username,recipient: recipient,encryptedMessage: cryptoPayload.encryptedData,iv: cryptoPayload.iv});
await secureMessage.save();
const recipientSession = onlineUsers.get(recipient);
if (recipientSession) {io.to(recipientSession.socketId).emit('msg_receive', {sender: socket.username,message: message});
} 
else {socket.emit('msg_error', { error: User ${recipient} is currently offline. });
}
}
);
socket.on('disconnect', async () => {if (socket.username) {const userSession = onlineUsers.get(socket.username);
if (userSession) {await SessionLog.findByIdAndUpdate(userSession.logId, { timeOut: new Date() });
onlineUsers.delete(socket.username);
}
console.log([Session Logged] ${socket.username} disconnected.);
}
}
);
}
);
const PORT = process.env.PORT || 3000;server.listen(PORT, '0.0.0.0', () => console.log(Secure chat engine spinning on port ${PORT}));

