const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Serve static files for HTML dashboard
app.use(express.static(path.join(__dirname, "public")));

// Initialize SQLite database
const db = new sqlite3.Database("connections.db");

// Create table to store connection details
db.run(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      authToken TEXT,
      deviceType TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      UNIQUE(authToken, deviceType)
    )
  `);
  

// Serve API endpoint to fetch connections
app.get("/api/connections", (req, res) => {
  db.all("SELECT * FROM connections ORDER BY timestamp DESC", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Start the Express server
const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});

// Create the Socket.IO server
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for testing. Restrict in production.
  },
});

// In-memory store for device connections
const devicePairs = {};

// Handle WebSocket connections
io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Handle registration for ESP or Phone
  socket.on("register", (data) => {
    const { authToken, deviceType } = data; // deviceType = "esp" or "phone"

    if (!authToken || (deviceType !== "esp" && deviceType !== "phone")) {
      socket.emit("error", { message: "Invalid registration data" });
      return;
    }

    // Initialize the authToken pairing if not present
    if (!devicePairs[authToken]) {
      devicePairs[authToken] = { esp: null, phone: null };
    }

    // Register the device
    devicePairs[authToken][deviceType] = socket;
    console.log(`${deviceType} registered with authToken: ${authToken}`);

    // Insert or update connection status in the database
    db.run(
        `
        INSERT INTO connections (authToken, deviceType, status) 
        VALUES (?, ?, ?)
        ON CONFLICT(authToken, deviceType) DO UPDATE SET 
          status = excluded.status,
          timestamp = CURRENT_TIMESTAMP
        `,
        [authToken, deviceType, "connected"],
        (err) => {
          if (err) {
            console.error("Database error:", err.message);
          }
        }
      );

    // Notify the paired device, if connected
    const otherDeviceType = deviceType === "esp" ? "phone" : "esp";
    const otherDeviceSocket = devicePairs[authToken][otherDeviceType];

    if (otherDeviceSocket) {
      otherDeviceSocket.emit("status", { message: `${deviceType} connected` });
      socket.emit("status", { message: `${otherDeviceType} connected` });
    }
  });

  // Handle sensor data from ESP
  socket.on("sensor_data", (data) => {
    const { authToken, sensorState } = data;

    if (!authToken || !devicePairs[authToken]?.esp) {
      socket.emit("error", { message: "Invalid authToken or phone not connected" });
      return;
    }

    // Relay the sensor state to the paired phone
    const phoneSocket = devicePairs[authToken].phone;
    phoneSocket.emit("sensor_data", { sensorState });
    console.log(`Sensor data relayed: ${sensorState}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);

    // Clean up disconnected sockets
    for (const authToken in devicePairs) {
      const pair = devicePairs[authToken];
      if (pair.esp === socket) {
        pair.esp = null;
        console.log(`ESP disconnected for authToken: ${authToken}`);
        updateConnectionStatus(authToken, "esp", "disconnected");
      } else if (pair.phone === socket) {
        pair.phone = null;
        console.log(`Phone disconnected for authToken: ${authToken}`);
        updateConnectionStatus(authToken, "phone", "disconnected");
      }

      // Remove empty pair
      if (!pair.esp && !pair.phone) {
        delete devicePairs[authToken];
      }
    }
  });
});

// Update connection status in the database
function updateConnectionStatus(authToken, deviceType, status) {
  db.run(
    `
    UPDATE connections SET status = ?, timestamp = CURRENT_TIMESTAMP
    WHERE authToken = ? AND deviceType = ?
    `,
    [status, authToken, deviceType],
    (err) => {
      if (err) {
        console.error("Database error:", err.message);
      }
    }
  );
}
