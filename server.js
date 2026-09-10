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
const IV_LENGTH = 16; // For AES

mongoose.connect(mongoURI)
  .then(() => console.log('Connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Database Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String, required: true }
}, { collection: 'unified_chat_users' });

// Track Logins, Logouts, and Session Times
const sessionLogSchema = new mongoose.Schema({
  username: { type: String, required: true },
  timeIn: { type: Date, default: Date.now },
  timeOut: { type: Date }
}, { collection: 'user_session_logs' });

// Secure Encrypted Chat Schema
const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  encryptedMessage: { type: String, required: true }, // Hex encrypted string
  iv: { type: String, required: true },               // Initialization vector
  timestamp: { type: Date, default: Date.now }
}, { collection: 'encrypted_chat_history' });

const User = mongoose.model('User', userSchema);
const SessionLog = mongoose.model('SessionLog', sessionLogSchema);
const Message = mongoose.model('Message', messageSchema);

const onlineUsers = new Map(); // Tracks live active sockets: { username: { socketId, logId } }

// 3. Symmetric Encryption Utilities (AES-256-CBC)
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
// REST Registration
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = String(username).trim();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(String(password).trim(), user.password);
    if (!isMatch) return res.status(400).json({ error: 'Password mismatch' });

    res.status(200).json({ message: 'Login verification passed', username: cleanUsername });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin Route to display session dashboard data
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const sessions = await SessionLog.find().sort({ timeIn: -1 }).limit(50);
    const activeUsers = Array.from(onlineUsers.keys());
    const rawMessages = await Message.find().sort({ timestamp: -1 }).limit(30);

    res.status(200).json({
      currentlyOnline: activeUsers,
      sessionTrackingLogs: sessions,
      encryptedVaultRecords: rawMessages
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. WebSocket Live Orchestration
io.on('connection', (socket) => {

  socket.on('identify', async (username) => {
    socket.username = username;
    
    // Automatically create a 'Time-In' entry in MongoDB logs
    const newLog = new SessionLog({ username: username, timeIn: new Date() });
    await newLog.save();

    // Map user to active session variables
    onlineUsers.set(username, { socketId: socket.id, logId: newLog._id });
    console.log(`[Session Initialized] ${username} clocked in.`);
  });

  socket.on('private_message', async ({ recipient, message }) => {
    // 1. Process encryption layer before saving to disk
    const cryptoPayload = encryptText(message);

    const secureMessage = new Message({
      sender: socket.username,
      recipient: recipient,
      encryptedMessage: cryptoPayload.encryptedData,
      iv: cryptoPayload.iv
    });
    await secureMessage.save();

    // 2. Route real-time event packet if recipient is online
    const recipientSession = onlineUsers.get(recipient);
    if (recipientSession) {
      io.to(recipientSession.socketId).emit('msg_receive', {
        sender: socket.username,
        message: message // Transmitted plain over safe socket channel
      });
    } else {
      socket.emit('msg_error', { error: `User ${recipient} is currently offline.` });
    }
  });

  socket.on('disconnect', async () => {
    if (socket.username) {
      const userSession = onlineUsers.get(socket.username);
      
      if (userSession) {
        // Automatically append 'Time-Out' timestamp when client disconnects
        await SessionLog.findByIdAndUpdate(userSession.logId, { timeOut: new Date() });
        onlineUsers.delete(socket.username);
      }
      console.log(`[Session Concluded] ${socket.username} clocked out.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Secure chat engine spinning on port ${PORT}`));
