const mongoose = require('mongoose');

// Message Schema
const MessageSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    required: true
  },
  receiver: {
    type: String,
    required: true
  },
  roomId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Number,
    default: () => Date.now()
  },
  read: {
    type: Boolean,
    default: false
  }
});

// Main UserChat Schema
const UserChatSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true // Ensure only one document per user
  },
  conversations: {
    type: Map,
    of: {
      messages: [MessageSchema],
      lastMessage: MessageSchema,
      unreadCount: {
        type: Number,
        default: 0
      }
    },
    default: new Map()
  }
}, {
  timestamps: true
});

// Indexes
UserChatSchema.index({ userId: 1 });

// Static Methods
UserChatSchema.statics.addMessage = async function(messageData) {
  const { sender, receiver, content, roomId, timestamp } = messageData;
  
  const message = {
    content,
    sender,
    receiver,
    roomId,
    timestamp,
    read: false
  };

  // Update or create sender's document and conversation
  await this.findOneAndUpdate(
    { userId: sender },
    {
      $push: {
        [`conversations.${receiver}.messages`]: message
      },
      $set: {
        [`conversations.${receiver}.lastMessage`]: message
      }
    },
    { 
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  // Update or create receiver's document and conversation
  await this.findOneAndUpdate(
    { userId: receiver },
    {
      $push: {
        [`conversations.${sender}.messages`]: message
      },
      $set: {
        [`conversations.${sender}.lastMessage`]: message
      },
      $inc: {
        [`conversations.${sender}.unreadCount`]: 1
      }
    },
    { 
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

UserChatSchema.statics.markConversationAsRead = async function(userId, otherUserId) {
  return this.findOneAndUpdate(
    { userId },
    {
      $set: {
        [`conversations.${otherUserId}.unreadCount`]: 0,
        [`conversations.${otherUserId}.messages.$[].read`]: true
      }
    },
    { new: true }
  );
};

// Method to get messages between two users
UserChatSchema.statics.getConversation = async function(userId, otherUserId) {
  const userChat = await this.findOne({ userId });
  if (!userChat || !userChat.conversations.get(otherUserId)) {
    return [];
  }
  return userChat.conversations.get(otherUserId).messages;
};

module.exports = mongoose.model('UserChat', UserChatSchema);