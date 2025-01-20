const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const axios = require('axios');
const nodemailer = require('nodemailer');
const multer = require('multer');

// OneSignal credentials
const ONE_SIGNAL_APP_ID = '5ed5769f';  // Replace with your OneSignal App ID
const REST_API_KEY = 'os_v2_app_xwz';  // Replace with your OneSignal REST API Key

// Email configuration (using nodemailer)
const transporter = nodemailer.createTransport({
    service: 'gmail', // Example with Gmail. Change this for your provider.
    auth: {
      user: 'example@gmail.com', // Replace with your email
      pass: 'tzvb',  // Replace with your email password (or app-specific password)
    },
  });

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Middleware to parse JSON request bodies
app.use(express.json());

// Middleware to parse URL-encoded request bodies (optional, for form submissions)
app.use(express.urlencoded({ extended: true }));

// Serve static files for HTML dashboard
app.use(express.static(path.join(__dirname, "public")));

// Set up Multer for file upload
const storage = multer.memoryStorage();  // Store files in memory
const upload = multer({ storage: storage });

// Serve API endpoint to fetch connections
app.get("/", (req, res) => {

});


// Function to generate HTML content for the email
function generateEmailHtml(title, body) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
    </head>
    <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f9;">
        <div style="max-width: 600px; margin: 20px auto; background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
            <div style="background-color: #4CAF50; color: white; padding: 15px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1>${title}</h1>
            </div>
            <div style="padding: 20px; font-size: 16px; line-height: 1.5;">
                <p align="center"><strong>${body}</strong></p>
            </div>
        </div>
        <footer>
            <div style="text-align: center; font-size: 12px; color: #888; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                <p style="margin: 10px 0;"><strong>Project K</strong><br />Building a better future with connected devices.</p>
                <p style="font-size: 10px; color: #aaa;">&copy; 2024 Project K. All Rights Reserved.</p>
            </div>
        </footer>
    </body>
    </html>
    `;
}


// API endpoint to send email with an attachment
app.post('/api/send-email', upload.single('image'), (req, res) => {
    const { body, toaddr, title } = req.body;  // Get body and toaddr from form data
    const image = req.file;  // Get the uploaded image
    const htmlContent = generateEmailHtml(title, body);

    // Ensure we have all necessary data
    if (!body || !toaddr || !title) {
        return res.status(400).send("Missing required fields (body, toaddr).");
    }

    // Prepare the email with attachment
    const mailOptions = {
        from: 'example@gmail.com',
        to: toaddr,
        subject: "Notification",
        title: title,
        html:htmlContent,
        attachments: [{
            filename: image.originalname,  // Use the uploaded file's name
            content: image.buffer,  // Attach the file buffer
            encoding: 'base64',  // Ensure the content is correctly encoded
        }],
    };

    // Send the email using nodemailer
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).send("Error sending email.");
        }
        console.log('Email sent: ' + info.response);
        res.status(200).send("Email sent successfully.");
    });
});
  

// Start the Express server
const PORT = 4000;
server.listen(PORT, '0.0.0.0' ,() => {
  console.log(`Express server running on http://localhost:${PORT}`);
});

// Create the Socket.IO server
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for testing. Restrict in production.
    methods: ["GET", "POST"]
  },
});

// In-memory store for device connections
const devicePairs = {};

// Handle WebSocket connections
io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Handle registration for ESP or Phone
  socket.on("register", (data) => {
    var { authToken, deviceType } = data; // deviceType = "esp" or "phone"

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

    // Check if both ESP and Phone are connected with the same authToken
    const bothDevicesConnected = devicePairs[authToken].esp && devicePairs[authToken].phone;

    // Notify both devices if they are connected
    if (bothDevicesConnected) {
      const espSocket = devicePairs[authToken].esp;
      const phoneSocket = devicePairs[authToken].phone;

      espSocket.emit("status", { message: "Both devices connected" });
      phoneSocket.emit("status", { message: "Both devices connected" });
    }
  });

// Handle sensor data from ESP
socket.on("sensor_data", (data) => {
  const { authToken, sensorState, type, message, number, title, body, toaddr } = data;

  if (type === "mail") {
    // Send email directly without checking registration
    if (!title || !body || !toaddr) {
      return socket.emit("error", { message: "Missing required fields for email." });
    }

    sendEmail(title, body, toaddr);
    console.log(`Email sent: ${title} to ${toaddr}`);
    return;
  }

  if (!authToken || !devicePairs[authToken]?.esp) {
    socket.emit("error", { message: "Invalid authToken or phone not connected" });
    return;
  }

  const phoneSocket = devicePairs[authToken].phone;

  if (!phoneSocket) {
    socket.emit("error", { message: "Phone not connected" });
    return;
  }

  // Relay data to the phone or handle specific types
  if (type === "sms") {
    phoneSocket.emit("sms", { number, message });
  } else if (type === "push") {
    // Send push notification using OneSignal
    sendPushNotification(authToken, message);
    phoneSocket.emit("push", { message });
  } else {
    phoneSocket.emit("sensor_data", { sensorState });
  }

  console.log(`Data relayed: ${type} - ${message || sensorState}`);
});

  
  // Function to send push notification using HTTP request
  async function sendPushNotification(authToken, message) {
    try {
      const response = await axios.post('https://onesignal.com/api/v1/notifications', {
        app_id: ONE_SIGNAL_APP_ID,
        filters: [
          {
            field: 'tag',         // Targeting a tag
            key: 'auth_token',    // The tag key to match
            relation: '=',        // Match the exact tag value
            value: authToken,     // The auth token to target
          },
        ],
        headings: {
          en: "Alert", // Title of the notification
        },
        contents: {
          en: message, // The message to be sent as the notification
        },
      }, {
        headers: {
          'Authorization': `Basic ${REST_API_KEY}`, // Authorization header with API key
        },
      });
  
      console.log('Push notification sent successfully:', response.data);
    } catch (error) {
      console.error('Error sending push notification:', error.response ? error.response.data : error.message);
    }
  }

  // Function to send email using nodemailer
  function sendEmail(title, body, toaddr) {
    const htmlContent = generateEmailHtml(title, body);
    const mailOptions = {
      from: 'pythonblynk@gmail.com', // Replace with your email
      to: toaddr,
      subject: "Notification",
      title:title,
      html:htmlContent
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email:', error);
      } else {
        console.log('Email sent: ' + info.response);
      }
    });
  }
  

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
