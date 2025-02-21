const mongoose = require('mongoose');

const GroupMessageSchema = new mongoose.Schema({
  roomId: { 
    type: String,
    required: true,
    index: true
  },
  messages: [{
    content: String,
    sender: String,
    timestamp: Number,
    read: { type: Boolean, default: false }
  }]
});

module.exports = mongoose.model('GroupChat', GroupMessageSchema);