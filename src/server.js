const connectDB = require('./config/db');
const bot = require('./bot/index');
const Category = require('./models/Category');
require('dotenv').config();

const seedCategories = async () => {
    const defaults = [
        { key: 'myntra', displayName: 'Myntra' },
        { key: 'balance', displayName: 'Balance Voucher' },
        { key: 'voucher', displayName: 'Voucher Code' },
        { key: 'coupon', displayName: 'Coupon' }
    ];
    for (const d of defaults) {
        await Category.findOneAndUpdate({ key: d.key }, d, { upsert: true });
    }
};

// Connect Database
connectDB().then(seedCategories);

// Start Bot
console.log('⌛ Starting Telegram Bot...');
bot.launch().then(() => {
    console.log('🚀 Telegram Referral Bot is online!');
    console.log('🛠 Admin ID:', process.env.ADMIN_ID);
}).catch(err => {
    console.error('Bot launch error:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
