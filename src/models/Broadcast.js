const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
    adminId: String,
    messageContent: String,
    sentMessages: [{
        chatId: String,
        messageId: Number
    }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Broadcast', broadcastSchema);
