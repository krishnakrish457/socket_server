const { Server } = require("socket.io");

// Create the Socket.IO server
const io = new Server(4000, {
  cors: {
    origin: "*", // Allow all origins for testing. Restrict in production.
  },
});

// Store device connections: { authToken: { esp: socket, phone: socket } }
const devicePairs = {};

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

    if (!authToken || !devicePairs[authToken]?.phone) {
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
      } else if (pair.phone === socket) {
        pair.phone = null;
        console.log(`Phone disconnected for authToken: ${authToken}`);
      }

      // Remove empty pair
      if (!pair.esp && !pair.phone) {
        delete devicePairs[authToken];
      }
    }
  });
});

console.log("Socket.IO server running on http://localhost:3000");
