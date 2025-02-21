const mongoose = require('mongoose');

const UserChatSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  conversations: [{
    with: {
      type: String,
      required: true
    },
    messages: [{
      content: String,
      sender: String,
      receiver: String,
      roomId: String,
      timestamp: Number,
      read: {
        type: Boolean,
        default: false
      }
    }]
  }]
});

module.exports = mongoose.model('UserChat', UserChatSchema);