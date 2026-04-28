const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    welcomeMessage: { type: String, default: "Welcome to the Referral Bot! Refer friends to earn rewards." },
    referralBonusPoints: { type: Number, default: 10 },
    botName: { type: String, default: "ReferBot" },
    adminIds: [{ type: Number }],
    mandatoryChannels: [{
        name: String,
        link: String,
        chatId: String // e.g. -100123456789
    }],
    spinCost: { type: Number, default: 10 }
});

module.exports = mongoose.model('Settings', settingsSchema);
