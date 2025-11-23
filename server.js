// server.js - production-ready for Render + React frontend hosted separately
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Allow only your frontend origin (set FRONTEND_URL in Render env). Fallback to '*' only for dev.
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

// Middlewares
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// ----- MongoDB connection -----
// Put your Atlas connection string in Render as MONGO_URL (do not hardcode secrets in repo)
const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error("❌ MONGO_URL is not defined. Set MONGO_URL in your environment variables.");
  process.exit(1);
}

mongoose
  .connect(mongoUrl)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    // Optional: exit if DB is mandatory
    // process.exit(1);
  });

// ================== MODELS ==================
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const User = mongoose.model("User", UserSchema);
const Message = mongoose.model("Message", MessageSchema);

// ================== ROUTES ==================

// Health route (useful for checking service)
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Signup
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "All fields are required" });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed });
    const savedUser = await user.save();

    const safeUser = { _id: savedUser._id, name: savedUser.name, email: savedUser.email };
    io.emit("newUser", safeUser);

    res.json({ success: true, message: "Signup successful", user: safeUser });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "All fields are required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid credentials" });

    const safeUser = { _id: user._id, name: user.name, email: user.email };
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Fetch all users except current
app.get("/users/:id", async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.params.id } });
    res.json(users);
  } catch (err) {
    console.error("Users Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Fetch chat messages between two users
app.get("/chat/:userId/:otherId", async (req, res) => {
  try {
    const { userId, otherId } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: userId, receiver: otherId },
        { sender: otherId, receiver: userId },
      ],
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (err) {
    console.error("Chat Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

// ================== SOCKET.IO ==================
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  socket.on("sendMessage", async (data) => {
    try {
      const { sender, receiver, text } = data;
      const message = new Message({ sender, receiver, text });
      await message.save();
      io.emit("receiveMessage", message);
    } catch (err) {
      console.error("Message Error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected");
  });
});

// ================== START SERVER ==================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
