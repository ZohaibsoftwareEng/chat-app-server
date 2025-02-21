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
    roomId: {
      type: String,
      required: true,
      unique: true // Ensures one document per conversation
    },
    participants: [{
      type: String,
      required: true
    }],
    messages: [MessageSchema],
    lastMessage: {
      type: MessageSchema,
      default: null
    },
    unreadCount: {
      type: Map,
      of: Number,
      default: () => new Map()
    }
  }, {
    timestamps: true
  });

  // Indexes
  UserChatSchema.index({ roomId: 1 });
  UserChatSchema.index({ participants: 1 });

  // Static Methods
  UserChatSchema.statics.addMessage = async function(messageData) {
    const { sender, receiver, content, roomId, timestamp } = messageData;
    
    const message = {
      content,
      sender,
      receiver,
      timestamp,
      read: false
    };

    // Update or create conversation
    const chat = await this.findOneAndUpdate(
      { roomId },
      {
        $push: { messages: message },
        $set: { lastMessage: message },
        $setOnInsert: { 
          participants: [sender, receiver]
        },
        $inc: {
          [`unreadCount.${receiver}`]: 1
        }
      },
      { 
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    return chat;
  };

  UserChatSchema.statics.markMessagesAsRead = async function(roomId, userId) {
    return this.findOneAndUpdate(
      { roomId },
      {
        $set: {
          'messages.$[msg].read': true,
          [`unreadCount.${userId}`]: 0
        }
      },
      {
        arrayFilters: [{ 'msg.receiver': userId, 'msg.read': false }],
        new: true
      }
    );
  };

  // Get conversations for a user
  UserChatSchema.statics.getUserConversations = async function(userId) {
    return this.find(
      { participants: userId },
      {
        roomId: 1,
        participants: 1,
        lastMessage: 1,
        unreadCount: 1
      }
    ).sort({ 'lastMessage.timestamp': -1 });
  };

  // Get messages for a specific room
  UserChatSchema.statics.getRoomMessages = async function(roomId, limit = 50, skip = 0) {
    const chat = await this.findOne(
      { roomId },
      { messages: { $slice: [skip, limit] } }
    );
    return chat ? chat.messages : [];
  };

  module.exports = mongoose.model('UserChat', UserChatSchema);