const mongoose = require('mongoose');

const rewardSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    referralsRequired: { type: Number, required: true },
    pointsValue: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reward', rewardSchema);
