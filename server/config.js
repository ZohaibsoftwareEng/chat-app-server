// @ts-check
const mongoose = require("mongoose")
/** Get default port argument. */
let DEFAULT_PORT = 4000;
try {
  const newPort = parseInt(process.argv[2]);
  DEFAULT_PORT = isNaN(newPort) ? DEFAULT_PORT : newPort;
} catch (e) {
}

const PORT = process.env.PORT || DEFAULT_PORT;

const ipAddress = require('ip').address();

const SERVER_ID = `${ipAddress}:${PORT}`;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect("mongodb://127.0.0.1:27017/chatsample");

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1); // Exit the process with failure
  }
};

module.exports = { PORT, SERVER_ID,connectDB };


