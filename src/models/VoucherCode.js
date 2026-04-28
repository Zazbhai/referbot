const mongoose = require('mongoose');

const voucherCodeSchema = new mongoose.Schema({
    categoryKey: { type: String, required: true },
    code: { type: String, required: true },
    isClaimed: { type: Boolean, default: false },
    claimedBy: { type: Number, default: null },
    claimedAt: { type: Date }
});

module.exports = mongoose.model('VoucherCode', voucherCodeSchema);
