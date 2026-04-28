const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: String,
    firstName: String,
    referredBy: { type: Number, default: null },
    referralsCount: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    rewards: [{
        rewardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reward' },
        claimedAt: { type: Date, default: Date.now }
    }],
    isAdmin: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
