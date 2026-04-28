const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    referralsRequired: { type: Number, default: 5 },
    weight: { type: Number, default: 25 }
});

module.exports = mongoose.model('Category', categorySchema);
