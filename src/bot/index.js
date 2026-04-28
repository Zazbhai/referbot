const { Telegraf, Markup, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const User = require('../models/User');
const Reward = require('../models/Reward');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const VoucherCode = require('../models/VoucherCode');
const Broadcast = require('../models/Broadcast');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Session setup
const localSession = new LocalSession({ database: 'sessions.json' });
bot.use(localSession.middleware());

// Middleware to check/create user
bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat.type !== 'private') return next();
    
    try {
        // Use findOneAndUpdate with upsert for atomic user check/creation
        // This prevents the duplicate key error (E11000) during race conditions
        let user = await User.findOneAndUpdate(
            { telegramId: ctx.from.id },
            { 
                $set: { 
                    username: ctx.from.username, 
                    firstName: ctx.from.first_name 
                },
                $setOnInsert: {
                    telegramId: ctx.from.id,
                    isAdmin: ctx.from.id.toString() === process.env.ADMIN_ID,
                    points: 0,
                    referralsCount: 0,
                    createdAt: new Date()
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (user.isBanned) {
            return ctx.reply("❌ *You have been banned from using this bot.*", { parse_mode: 'Markdown' });
        }
        
        ctx.state.user = user;
        return next();
    } catch (err) {
        console.error("Middleware Error:", err);
        
        // Final fallback: try to find the user if the upsert failed for some reason
        try {
            const user = await User.findOne({ telegramId: ctx.from.id });
            if (user) {
                ctx.state.user = user;
                return next();
            }
        } catch (e) {}

        return ctx.reply("⚠️ *Something went wrong while identifying you. Please try /start again.*");
    }
});

// Helper: Check if user joined all channels
const checkMembership = async (ctx, user) => {
    const settings = await Settings.findOne();
    if (!settings || !settings.mandatoryChannels || settings.mandatoryChannels.length === 0) return true;
    
    for (const channel of settings.mandatoryChannels) {
        try {
            const member = await ctx.telegram.getChatMember(channel.chatId, user.telegramId);
            const statuses = ['member', 'administrator', 'creator'];
            if (!statuses.includes(member.status)) return false;
        } catch (e) {
            console.error(`Error checking membership for ${channel.name}:`, e.message);
        }
    }
    return true;
};

// Helper: Sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Animate Loading
const animateLoading = async (ctx, text = "⌛ Processing") => {
    const frames = ["⌛", "⏳", "⌛", "⏳"];
    let msg;
    try {
        msg = await ctx.reply(`${frames[0]} *${text}...*`, { parse_mode: 'Markdown' });
        for (let i = 1; i < frames.length; i++) {
            await sleep(500);
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `${frames[i]} *${text}...*`, { parse_mode: 'Markdown' });
        }
        return msg;
    } catch (e) { return null; }
};

// Helper: Animate Spin
const animateSpin = async (ctx) => {
    try {
        const msg = await ctx.reply("🔑");
        // Simple 2 second wait for a clean "rolling" feel
        await sleep(2000);
        await ctx.deleteMessage(msg.message_id).catch(() => {});
        return true;
    } catch (e) {
        console.log("Spin Animation Error:", e.message);
        return true;
    }
};

// Helper: Handle Referral Logic
const handleReferral = async (ctx, user, payload) => {
    if (!payload || user.referredBy || payload == user.telegramId) return;

    // Only count as referral if the user is "new" (joined in the last 24 hours)
    // This prevents old users from being counted as a referral later
    const isNewUser = (new Date() - user.createdAt) < 86400000; 
    if (!isNewUser) return;

    const referrerId = parseInt(payload);
    if (isNaN(referrerId)) return;

    const referrer = await User.findOne({ telegramId: referrerId });
    if (referrer) {
        user.referredBy = referrerId;
        await user.save();
        
        referrer.referralsCount += 1;
        const settings = await Settings.findOne() || await Settings.create({});
        referrer.points += (settings.referralBonusPoints || 10);
        await referrer.save();
        
        try {
            await ctx.telegram.sendMessage(referrerId, `🎉 *New Referral!* \n\n${ctx.from.first_name} joined using your link. You earned ${settings.referralBonusPoints || 10} points!`, { parse_mode: 'Markdown' });
        } catch (e) {}
    }
};

// Helper for dynamic menus
const getUserMenu = (user, botUsername) => {
    const refLink = `https://t.me/${botUsername}?start=${user.telegramId}`;
    const buttons = [
        [Markup.button.callback('🎰 Spin for Reward', 'spin_reward')],
        [Markup.button.callback('🎁 My Rewards', 'my_rewards')],
        [Markup.button.callback('📊 My Stats', 'my_stats')],
        [Markup.button.callback('🔗 Share Link', 'share_link')]
    ];
    if (user.isAdmin) {
        buttons.push([Markup.button.callback('🛠 Admin Panel', 'admin_panel')]);
    }
    return {
        text: `👋 *Welcome ${user.firstName}!*\n\nThis is your referral dashboard. Invite friends to unlock exclusive rewards!\n\n💰 *Your Points:* ${user.points}\n👥 *Total Referrals:* ${user.referralsCount}`,
        markup: Markup.inlineKeyboard(buttons)
    };
};

bot.start(async (ctx) => {
    const payload = ctx.payload;
    const user = ctx.state.user;
    
    // Check membership first
    const joined = await checkMembership(ctx, user);
    if (!joined) {
        const settings = await Settings.findOne();
        const buttons = settings.mandatoryChannels.map(c => [Markup.button.url(`📢 Join ${c.name}`, c.link)]);
        buttons.push([Markup.button.callback('✅ I have Joined', `verify_join${payload ? '_' + payload : ''}`)]);
        
        return ctx.replyWithMarkdown(
            `📢 *Wait! Join our channels first.*\n\nTo use this bot and earn rewards, you must be a member of our channels below.`,
            Markup.inlineKeyboard(buttons)
        );
    }
    
    await handleReferral(ctx, user, payload);


    const { text, markup } = getUserMenu(user, ctx.botInfo.username);
    ctx.replyWithMarkdown(text, markup);
});

// --- USER ACTIONS ---

bot.action('view_rewards', async (ctx) => {
    const categories = await Category.find();
    const settings = await Settings.findOne() || await Settings.create({});
    
    let text = `🎁 *Available Reward Categories*\n\nYou can see what we offer below. To get a reward, use the **🎰 Spin** option on the main menu!\n\n`;
    
    for (const cat of categories) {
        const availableCount = await VoucherCode.countDocuments({ categoryKey: cat.key, isClaimed: false });
        text += `🏷 *${cat.displayName}*\nAvailable: ${availableCount} codes\n\n`;
    }

    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_main')]])
    });
});

bot.action('spin_reward', async (ctx) => {
    const settings = await Settings.findOne() || await Settings.create({});
    const cost = settings.spinCost;
    const user = ctx.state.user;

    if (user.points < cost) {
        return ctx.answerCbQuery(`❌ You need ${cost} points to spin. Keep referring!`, { show_alert: true });
    }

    // 1. Get all categories and check global stock
    const categories = await Category.find();
    if (categories.length === 0) {
        return ctx.answerCbQuery(`❌ No reward categories set up yet.`, { show_alert: true });
    }

    const totalCodes = await VoucherCode.countDocuments({ isClaimed: false });
    if (totalCodes === 0) {
        return ctx.answerCbQuery("❌ No rewards left! Please try again after some time.", { show_alert: true });
    }

    let totalWeight = 0;
    for (const cat of categories) {
        totalWeight += (cat.weight || 1);
    }

    // Start Animation
    await ctx.answerCbQuery("🎰 Luck is in the air...").catch(() => {});
    const animMsg = await animateSpin(ctx);

    // 2. Pick a category based on Admin Weights (Win Chance)
    let randomNum = Math.random() * totalWeight;
    let selectedCat = categories[0];

    for (const cat of categories) {
        randomNum -= (cat.weight || 1);
        if (randomNum <= 0) {
            selectedCat = cat;
            break;
        }
    }

    // 3. Check if selected category has codes
    const voucher = await VoucherCode.findOne({ categoryKey: selectedCat.key, isClaimed: false });

    // Deduct points (it's a spin!)
    user.points -= cost;
    await user.save();

    if (!voucher) {
        // "Better luck next time" outcome - hidden from user which cat was drawn
        return ctx.replyWithMarkdown(`😔 *BETTER LUCK NEXT TIME!*\n\nYou didn't win anything this time. Don't give up, your next big win could be just one spin away!\n\n_Deducted ${cost} points._`);
    }

    // Process win
    voucher.isClaimed = true;
    voucher.claimedBy = user.telegramId;
    voucher.claimedAt = new Date();
    await voucher.save();

    ctx.replyWithMarkdown(`🎉 *BINGO!*\n\n🎁 *Reward:* ${selectedCat.displayName}\n🔑 *Code:* \`${voucher.code}\`\n\n_Deducted ${cost} points. Congratulations!_`);
});

bot.action('my_rewards', async (ctx) => {
    const user = ctx.state.user;
    const claimedCodes = await VoucherCode.find({ claimedBy: user.telegramId }).sort({ claimedAt: -1 });
    const categories = await Category.find();

    if (claimedCodes.length === 0) {
        return ctx.editMessageText("🎁 *My Rewards*\n\nYou haven't won any rewards yet. Go back and try a **🎰 Spin**!", {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_main')]])
        });
    }

    let text = `🎁 *Your Rewards Collection*\n\nTotal Earned: *${claimedCodes.length}* rewards\n\n`;
    
    for (const cat of categories) {
        const catCodes = claimedCodes.filter(c => c.categoryKey === cat.key);
        if (catCodes.length > 0) {
            text += `📂 *${cat.displayName}*\n`;
            catCodes.forEach((v, i) => {
                text += `  ${i + 1}. \`${v.code}\` _(${v.claimedAt.toLocaleDateString()})_\n`;
            });
            text += `\n`;
        }
    }

    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_main')]])
    });
});

bot.action('my_stats', async (ctx) => {
    const user = ctx.state.user;
    const text = `📊 *Your Referral Stats*\n\n👤 *User:* ${user.firstName}\n🆔 *ID:* \`${user.telegramId}\`\n\n👥 *Total Referrals:* ${user.referralsCount}\n💰 *Total Points:* ${user.points}\n📅 *Joined:* ${user.createdAt.toLocaleDateString()}`;
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_main')]])
    });
});

bot.action('share_link', async (ctx) => {
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    const text = `🔗 *Your Referral Link*\n\nCopy and share this link with your friends to earn rewards!\n\n\`${refLink}\``;
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.url('🚀 Send to Friend', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("Join this bot and get rewards!")}`)],
            [Markup.button.callback('⬅️ Back', 'back_to_main')]
        ])
    });
});

bot.action('back_to_main', async (ctx) => {
    const { text, markup } = getUserMenu(ctx.state.user, ctx.botInfo.username);
    ctx.editMessageText(text, { parse_mode: 'Markdown', ...markup });
});

// --- ADMIN ACTIONS ---

bot.action(/^verify_join(_.+)?$/, async (ctx) => {
    const payload = ctx.match[1] ? ctx.match[1].substring(1) : null;
    const user = ctx.state.user;
    const joined = await checkMembership(ctx, user);
    
    if (!joined) {
        return ctx.answerCbQuery("❌ You haven't joined all channels yet!", { show_alert: true });
    }
    
    await ctx.answerCbQuery("✅ Success! Welcome to the bot.").catch(() => {});
    ctx.deleteMessage().catch(() => {});
    
    // Process referral if any
    await handleReferral(ctx, user, payload);
    
    const botInfo = await ctx.telegram.getMe();
    
    const { text, markup } = getUserMenu(user, botInfo.username);
    ctx.replyWithMarkdown(text, markup);
});

bot.action('admin_panel', async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    
    ctx.editMessageText("🛠 *Admin Control Panel*\n\nManage how users are rewarded for their referrals.", {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Points Per Refer', 'edit_bonus')],
            [Markup.button.callback('🎰 Cost Per Spin', 'edit_spin_cost')],
            [Markup.button.callback('🎁 Manage Milestones', 'admin_rewards')],
            [Markup.button.callback('📢 Mandatory Channels', 'admin_channels')],
            [Markup.button.callback('📢 Broadcast Message', 'admin_broadcast')],
            [Markup.button.callback('👥 Manage Users', 'admin_users')],
            [Markup.button.callback('📊 Global Stats', 'admin_stats')],
            [Markup.button.callback('🏆 Referral Ranking', 'admin_ranking')],
            [Markup.button.callback('⬅️ Back to User Menu', 'back_to_main')]
        ])
    });
});

bot.action('admin_broadcast', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    
    const lastBroadcast = await Broadcast.findOne().sort({ createdAt: -1 });
    let text = "📢 *Broadcast System*\n\nSend me the message you want to broadcast to **ALL** users. You can use Markdown formatting.";
    
    const buttons = [[Markup.button.callback('❌ Cancel', 'admin_panel')]];
    if (lastBroadcast) {
        text += `\n\n🕒 *Last Broadcast:* ${lastBroadcast.createdAt.toLocaleString()}\n👥 *Sent to:* ${lastBroadcast.sentMessages.length} users`;
        buttons.unshift([Markup.button.callback('🗑 Delete Last Broadcast', 'delete_last_broadcast')]);
    }

    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
    ctx.session.adminState = 'awaiting_broadcast_message';
});

bot.action('delete_last_broadcast', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    
    const lastBroadcast = await Broadcast.findOne().sort({ createdAt: -1 });
    if (!lastBroadcast) return ctx.answerCbQuery("No broadcast found to delete.");

    await ctx.answerCbQuery("Deleting broadcast messages...").catch(() => {});
    let deletedCount = 0;
    
    for (const msg of lastBroadcast.sentMessages) {
        try {
            await ctx.telegram.deleteMessage(msg.chatId, msg.messageId);
            deletedCount++;
        } catch (err) {
            // Message might be too old or already deleted
        }
    }

    await Broadcast.deleteOne({ _id: lastBroadcast._id });
    
    ctx.editMessageText(`✅ Deleted *${deletedCount}* messages from the last broadcast.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_panel')]])
    });
});

bot.action('admin_ranking', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    
    const topUsers = await User.find({}).sort({ referralsCount: -1 }).limit(10);
    
    let text = "🏆 *Top 10 Referrers*\n\n";
    
    if (topUsers.length === 0) {
        text += "_No referrals recorded yet._";
    } else {
        topUsers.forEach((u, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '👤';
            text += `${medal} *${u.firstName}*\n   🔗 Referrals: ${u.referralsCount}\n   ID: \`${u.telegramId}\`\n\n`;
        });
    }

    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_panel')]])
    });
});

bot.action('admin_channels', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    
    const settings = await Settings.findOne() || await Settings.create({});
    let text = "📢 *Mandatory Channels*\n\nUsers must join these channels to use the bot.\n\n";
    
    const buttons = [];
    
    if (!settings.mandatoryChannels || settings.mandatoryChannels.length === 0) {
        text += "_No channels added yet._";
    } else {
        settings.mandatoryChannels.forEach((c, i) => {
            text += `${i+1}. *${c.name}*\nID: \`${c.chatId}\`\n\n`;
            buttons.push([
                Markup.button.callback(`❌ Remove: ${c.name}`, `delete_channel_${i}`)
            ]);
        });
    }
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            ...buttons,
            [Markup.button.callback('➕ Add Channel', 'add_channel_start')],
            [Markup.button.callback('🗑 Delete All', 'delete_channels')],
            [Markup.button.callback('⬅️ Back', 'admin_panel')]
        ])
    });
});

bot.action(/^delete_channel_(\d+)$/, async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    const index = parseInt(ctx.match[1]);
    
    const settings = await Settings.findOne();
    if (settings.mandatoryChannels && index < settings.mandatoryChannels.length) {
        const removed = settings.mandatoryChannels.splice(index, 1);
        await settings.save();
        await ctx.answerCbQuery(`Removed: ${removed[0].name}`).catch(() => {});
    }
    
    // Refresh the channels view
    let text = "📢 *Mandatory Channels*\n\nUsers must join these channels to use the bot.\n\n";
    const buttons = [];
    
    if (!settings.mandatoryChannels || settings.mandatoryChannels.length === 0) {
        text += "_No channels added yet._";
    } else {
        settings.mandatoryChannels.forEach((c, i) => {
            text += `${i+1}. *${c.name}*\nID: \`${c.chatId}\`\n\n`;
            buttons.push([
                Markup.button.callback(`❌ Remove: ${c.name}`, `delete_channel_${i}`)
            ]);
        });
    }
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            ...buttons,
            [Markup.button.callback('➕ Add Channel', 'add_channel_start')],
            [Markup.button.callback('🗑 Delete All', 'delete_channels')],
            [Markup.button.callback('⬅️ Back', 'admin_panel')]
        ])
    });
});

bot.action('add_channel_start', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    ctx.session.adminState = 'awaiting_channel_name';
    ctx.editMessageText("📝 *Step 1: Enter Channel Name*\n\nSend me the display name (e.g., 'Main Channel')", {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin_channels')]])
    });
});

bot.action('delete_channels', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    const settings = await Settings.findOne();
    settings.mandatoryChannels = [];
    await settings.save();
    await ctx.answerCbQuery("All channels deleted.").catch(() => {});
    ctx.editMessageText("✅ All channels removed.", {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_channels')]])
    });
});

bot.action(/^admin_users(_\d+)?$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    
    const page = ctx.match[1] ? parseInt(ctx.match[1].substring(1)) : 0;
    const perPage = 10;
    
    const totalUsers = await User.countDocuments();
    const users = await User.find().sort({ createdAt: -1 }).skip(page * perPage).limit(perPage);
    const totalPages = Math.ceil(totalUsers / perPage);

    let text = `👥 *Manage Users* (Page ${page + 1}/${totalPages || 1})\n\nTotal Users: ${totalUsers}\nClick a user to see details and manage them.`;
    
    const buttons = users.map(u => [Markup.button.callback(`${u.firstName} (${u.telegramId})`, `view_user_${u.telegramId}`)]);
    
    const navButtons = [];
    if (page > 0) navButtons.push(Markup.button.callback('◀️ Prev', `admin_users_${page - 1}`));
    if (page < totalPages - 1) navButtons.push(Markup.button.callback('Next ▶️', `admin_users_${page + 1}`));
    
    if (navButtons.length > 0) buttons.push(navButtons);
    buttons.push([Markup.button.callback('⬅️ Back', 'admin_panel')]);
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^view_user_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    const user = await User.findOne({ telegramId: targetId });
    const claimedCodes = await VoucherCode.find({ claimedBy: targetId });
    
    const text = `👤 *User Details*\n\n` +
                 `📛 *Name:* ${user.firstName}\n` +
                 `🆔 *ID:* \`${user.telegramId}\`\n` +
                 `👤 *Username:* @${user.username || 'None'}\n` +
                 `👑 *Role:* ${user.isAdmin ? 'Admin' : 'User'}\n\n` +
                 `👥 *Total Refers:* ${user.referralsCount}\n` +
                 `💰 *Current Points:* ${user.points}\n` +
                 `🎁 *Rewards Claimed:* ${claimedCodes.length}\n` +
                 `🚫 *Status:* ${user.isBanned ? '🛑 BANNED' : '✅ Active'}\n` +
                 `📅 *Joined:* ${user.createdAt.toLocaleDateString()}`;
                 
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Add Points', `add_points_${targetId}`)],
            [Markup.button.callback('🎁 View User Rewards', `admin_user_rewards_${targetId}`)],
            [Markup.button.callback(user.isAdmin ? '⬇️ Demote Admin' : '⭐ Make Admin', `toggle_admin_${targetId}`)],
            [Markup.button.callback(user.isBanned ? '✅ Unban User' : '🛑 Ban User', `toggle_ban_${targetId}`)],
            [Markup.button.callback('🗑 Delete User', `confirm_delete_${targetId}`)],
            [Markup.button.callback('⬅️ Back to List', 'admin_users')],
            [Markup.button.callback('🏠 Main Menu', 'admin_panel')]
        ])
    });
});

bot.action(/^add_points_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    ctx.session.adminState = 'awaiting_user_points';
    ctx.session.targetUser = targetId;
    ctx.editMessageText(`💰 *Add Points to User* \`${targetId}\`\n\nHow many points should I add? (Use negative numbers to subtract)`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `view_user_${targetId}`)]])
    });
});

bot.action(/^confirm_delete_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    
    if (targetId === process.env.ADMIN_ID) {
        return ctx.answerCbQuery("❌ Super Admin cannot be deleted!", { show_alert: true });
    }
    ctx.editMessageText(`⚠️ *DELETE USER* \`${targetId}\`?\n\nThis action is permanent. All referrals and rewards data will be lost.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔥 YES, DELETE', `delete_user_${targetId}`)],
            [Markup.button.callback('❌ Cancel', `view_user_${targetId}`)]
        ])
    });
});

bot.action(/^delete_user_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    
    if (targetId === process.env.ADMIN_ID) {
        return ctx.answerCbQuery("❌ Super Admin cannot be deleted!", { show_alert: true });
    }
    await User.deleteOne({ telegramId: targetId });
    await ctx.answerCbQuery("User deleted successfully.").catch(() => {});
    ctx.editMessageText("✅ User has been permanently removed.", {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to List', 'admin_users')], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
    });
});

bot.action(/^toggle_ban_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    
    if (targetId === process.env.ADMIN_ID) {
        return ctx.answerCbQuery("❌ Super Admin cannot be banned!", { show_alert: true });
    }
    const user = await User.findOne({ telegramId: targetId });
    
    user.isBanned = !user.isBanned;
    await user.save();
    
    await ctx.answerCbQuery(`User ${user.isBanned ? 'Banned' : 'Unbanned'}!`).catch(() => {});
    // Refresh view
    const claimedCodes = await VoucherCode.find({ claimedBy: targetId });
    const text = `👤 *User Details*\n\n` +
                 `📛 *Name:* ${user.firstName}\n` +
                 `🆔 *ID:* \`${user.telegramId}\`\n` +
                 `👤 *Username:* @${user.username || 'None'}\n` +
                 `👑 *Role:* ${user.isAdmin ? 'Admin' : 'User'}\n\n` +
                 `👥 *Total Refers:* ${user.referralsCount}\n` +
                 `💰 *Current Points:* ${user.points}\n` +
                 `🎁 *Rewards Claimed:* ${claimedCodes.length}\n` +
                 `🚫 *Status:* ${user.isBanned ? '🛑 BANNED' : '✅ Active'}\n` +
                 `📅 *Joined:* ${user.createdAt.toLocaleDateString()}`;
                 
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Add Points', `add_points_${targetId}`)],
            [Markup.button.callback('🎁 View User Rewards', `admin_user_rewards_${targetId}`)],
            [Markup.button.callback(user.isAdmin ? '⬇️ Demote Admin' : '⭐ Make Admin', `toggle_admin_${targetId}`)],
            [Markup.button.callback(user.isBanned ? '✅ Unban User' : '🛑 Ban User', `toggle_ban_${targetId}`)],
            [Markup.button.callback('🗑 Delete User', `confirm_delete_${targetId}`)],
            [Markup.button.callback('⬅️ Back to List', 'admin_users')],
            [Markup.button.callback('🏠 Main Menu', 'admin_panel')]
        ])
    });
});

bot.action(/^toggle_admin_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    
    if (targetId === process.env.ADMIN_ID) {
        return ctx.answerCbQuery("❌ Super Admin cannot be demoted!", { show_alert: true });
    }
    
    const user = await User.findOne({ telegramId: targetId });
    user.isAdmin = !user.isAdmin;
    await user.save();
    
    await ctx.answerCbQuery(`User is now ${user.isAdmin ? 'an Admin' : 'a standard User'}!`).catch(() => {});
    
    // Refresh user view
    const claimedCodes = await VoucherCode.find({ claimedBy: targetId });
    const text = `👤 *User Details*\n\n` +
                 `📛 *Name:* ${user.firstName}\n` +
                 `🆔 *ID:* \`${user.telegramId}\`\n` +
                 `👤 *Username:* @${user.username || 'None'}\n` +
                 `👑 *Role:* ${user.isAdmin ? 'Admin' : 'User'}\n\n` +
                 `👥 *Total Refers:* ${user.referralsCount}\n` +
                 `💰 *Current Points:* ${user.points}\n` +
                 `🎁 *Rewards Claimed:* ${claimedCodes.length}\n` +
                 `🚫 *Status:* ${user.isBanned ? '🛑 BANNED' : '✅ Active'}\n` +
                 `📅 *Joined:* ${user.createdAt.toLocaleDateString()}`;
                 
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Add Points', `add_points_${targetId}`)],
            [Markup.button.callback('🎁 View User Rewards', `admin_user_rewards_${targetId}`)],
            [Markup.button.callback(user.isAdmin ? '⬇️ Demote Admin' : '⭐ Make Admin', `toggle_admin_${targetId}`)],
            [Markup.button.callback(user.isBanned ? '✅ Unban User' : '🛑 Ban User', `toggle_ban_${targetId}`)],
            [Markup.button.callback('🗑 Delete User', `confirm_delete_${targetId}`)],
            [Markup.button.callback('⬅️ Back to List', 'admin_users')],
            [Markup.button.callback('🏠 Main Menu', 'admin_panel')]
        ])
    });
});

bot.action(/^admin_user_rewards_(.+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const targetId = ctx.match[1];
    
    const user = await User.findOne({ telegramId: targetId });
    const myCodes = await VoucherCode.find({ claimedBy: targetId }).sort({ claimedAt: -1 });
    const categories = await Category.find();

    if (myCodes.length === 0) {
        return ctx.editMessageText(`🎁 *Rewards for ${user.firstName}*\n\nThis user has not claimed any rewards yet.`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to User', `view_user_${targetId}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
        });
    }

    let text = `🎁 *Rewards Inventory for ${user.firstName}*\n\nTotal Won: *${myCodes.length}*\n\n`;
    
    for (const cat of categories) {
        const catCodes = myCodes.filter(c => c.categoryKey === cat.key);
        if (catCodes.length > 0) {
            text += `📂 *${cat.displayName}*\n`;
            catCodes.forEach((v, i) => {
                text += `  ${i + 1}. \`${v.code}\` _(${v.claimedAt.toLocaleDateString()})_\n`;
            });
            text += `\n`;
        }
    }

    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to User', `view_user_${targetId}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
    });
});

bot.action('admin_stats', async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    
    const totalUsers = await User.countDocuments();
    const totalReferrals = await User.aggregate([{ $group: { _id: null, total: { $sum: "$referralsCount" } } }]);
    const totalRewardsClaimed = await VoucherCode.countDocuments({ isClaimed: true });
    const totalCodesAvailable = await VoucherCode.countDocuments({ isClaimed: false });
    const totalCodesAll = await VoucherCode.countDocuments();
    const settings = await Settings.findOne() || {};
    const categories = await Category.find();

    let catBreakdown = '';
    for (const cat of categories) {
        const claimed = await VoucherCode.countDocuments({ categoryKey: cat.key, isClaimed: true });
        const available = await VoucherCode.countDocuments({ categoryKey: cat.key, isClaimed: false });
        catBreakdown += `  🏷 *${cat.displayName}:* ${claimed} claimed / ${available} left\n`;
    }
    
    const text = `📊 *Global Statistics*\n\n` +
                 `👥 *Total Users:* ${totalUsers}\n` +
                 `🔗 *Total Referrals:* ${totalReferrals[0]?.total || 0}\n\n` +
                 `🎁 *Rewards Claimed:* ${totalRewardsClaimed}\n` +
                 `🎟 *Codes Available:* ${totalCodesAvailable}\n` +
                 `📦 *Total Codes (All Time):* ${totalCodesAll}\n\n` +
                 `📋 *Per Category:*\n${catBreakdown}\n` +
                 `⚙️ *Points Per Refer:* ${settings.referralBonusPoints || 10}\n` +
                 `🎰 *Cost Per Spin:* ${settings.spinCost || 10}\n\n` +
                 `_Updated: ${new Date().toLocaleTimeString()}_`;
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'admin_stats')], [Markup.button.callback('⬅️ Back', 'admin_panel')]])
    });
});

bot.action('admin_rewards', async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    
    const categories = await Category.find();
    let text = "🎁 *Manage Reward Milestones*\n\nSelect a category to manage its codes, rename it, or change the referral threshold.";
    
    const buttons = categories.map(cat => [Markup.button.callback(cat.displayName, `manage_cat_${cat.key}`)]);
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([...buttons, [Markup.button.callback('⬅️ Back', 'admin_panel')]])
    });
});

bot.action(/^manage_cat_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const category = await Category.findOne({ key });
    const codeCount = await VoucherCode.countDocuments({ categoryKey: key, isClaimed: false });
    const claimedCount = await VoucherCode.countDocuments({ categoryKey: key, isClaimed: true });
    
    const text = `⚙️ *Manage: ${category.displayName}*\n\n🔑 *Category Key:* \`${category.key}\`\n🎲 *Win Chance (Weight):* ${category.weight || 25}\n🎟 *Available Codes:* ${codeCount}\n✅ *Claimed Codes:* ${claimedCount}`;
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Codes', `add_codes_${key}`)],
            [Markup.button.callback('📝 View Codes', `browse_codes_${key}_0`)],
            [Markup.button.callback('🎲 Set Win Chance', `set_weight_${key}`)],
            [Markup.button.callback('✏️ Rename Category', `rename_cat_${key}`)],
            [Markup.button.callback('⬅️ Back', 'admin_rewards')],
            [Markup.button.callback('🏠 Main Menu', 'admin_panel')]
        ])
    });
});

bot.action(/^browse_codes_(.+)_(\d+)$/, async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const key = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    const perPage = 10;
    
    const category = await Category.findOne({ key });
    const totalCodes = await VoucherCode.countDocuments({ categoryKey: key });
    const codes = await VoucherCode.find({ categoryKey: key })
        .sort({ isClaimed: 1, createdAt: -1 })
        .skip(page * perPage)
        .limit(perPage);
    
    const totalPages = Math.ceil(totalCodes / perPage);
    
    let text = `📝 *${category.displayName} Codes* (Page ${page + 1}/${totalPages || 1})\n\n`;
    
    if (codes.length === 0) {
        text += `_No codes found in this category._`;
    } else {
        codes.forEach((v, i) => {
            const status = v.isClaimed ? '✅' : '🟢';
            const num = (page * perPage) + i + 1;
            text += `${num}. ${status} \`${v.code}\`\n`;
        });
        text += `\n🟢 = Available | ✅ = Claimed`;
    }
    
    const navButtons = [];
    if (page > 0) navButtons.push(Markup.button.callback('◀️ Prev', `browse_codes_${key}_${page - 1}`));
    if (page < totalPages - 1) navButtons.push(Markup.button.callback('Next ▶️', `browse_codes_${key}_${page + 1}`));
    
    const buttons = [];
    if (navButtons.length > 0) buttons.push(navButtons);
    buttons.push([Markup.button.callback('⬅️ Back', `manage_cat_${key}`)]);
    buttons.push([Markup.button.callback('🏠 Main Menu', 'admin_panel')]);
    
    ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^set_weight_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    ctx.session.adminState = 'awaiting_cat_weight';
    ctx.session.targetCat = key;
    ctx.editMessageText(`🎲 *Set Win Chance for ${key}*\n\nEnter a number from 1 to 100.\n(Higher number = Higher chance of winning codes from this category)`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `manage_cat_${key}`)]])
    });
});

bot.action(/^add_codes_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    ctx.session.adminState = 'awaiting_codes';
    ctx.session.targetCat = key;
    ctx.editMessageText(`🎟 *Adding codes to ${key}*\n\nPlease send the codes, one per line.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `manage_cat_${key}`)]])
    });
});

bot.action(/^rename_cat_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    ctx.session.adminState = 'awaiting_cat_name';
    ctx.session.targetCat = key;
    ctx.editMessageText(`✏️ *Rename Category: ${key}*\n\nSend the new display name (e.g., 'Swiggy')`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `manage_cat_${key}`)]])
    });
});

bot.action(/^set_threshold_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    ctx.session.adminState = 'awaiting_cat_threshold';
    ctx.session.targetCat = key;
    ctx.editMessageText(`🔢 *Set Threshold for ${key}*\n\nHow many referrals are required to claim this reward?`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `manage_cat_${key}`)]])
    });
});

bot.on('text', async (ctx, next) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin || !ctx.session.adminState) return next();
    
    const state = ctx.session.adminState;
    const catKey = ctx.session.targetCat;
    
    if (state === 'awaiting_codes') {
        const inputCodes = ctx.message.text.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        
        // Fetch all existing codes to prevent duplicates
        const existingDocs = await VoucherCode.find({}, { code: 1 });
        const existingCodes = new Set(existingDocs.map(d => d.code));
        
        // Filter unique codes from input
        const uniqueNewCodes = [...new Set(inputCodes)].filter(c => !existingCodes.has(c));
        const duplicateCount = inputCodes.length - uniqueNewCodes.length;

        if (uniqueNewCodes.length === 0) {
            return ctx.reply(`❌ No new unique codes found. (Skipped ${duplicateCount} duplicates)`);
        }

        const voucherDocs = uniqueNewCodes.map(code => ({ categoryKey: catKey, code: code }));
        await VoucherCode.insertMany(voucherDocs);
        
        ctx.session.adminState = null;
        ctx.reply(`✅ Added *${uniqueNewCodes.length}* unique codes to *${catKey}*!\n\n⚠️ Skipped *${duplicateCount}* duplicates.`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `manage_cat_${catKey}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
        });
    }
    else if (state === 'awaiting_broadcast_message') {
        const broadcastText = ctx.message.text;
        const users = await User.find({});
        
        const statusMsg = await ctx.reply(`🚀 *Broadcast Started*\nSending to ${users.length} users...`, { parse_mode: 'Markdown' });
        
        const sentMessages = [];
        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
            try {
                const sentMsg = await ctx.telegram.sendMessage(user.telegramId, broadcastText, { parse_mode: 'Markdown' });
                sentMessages.push({ chatId: user.telegramId, messageId: sentMsg.message_id });
                successCount++;
            } catch (err) {
                failCount++;
            }
        }

        await Broadcast.create({
            adminId: ctx.from.id,
            messageContent: broadcastText,
            sentMessages: sentMessages
        });

        ctx.session.adminState = null;
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        return ctx.reply(`✅ *Broadcast Complete*\n\n📊 *Results:*\n- Success: ${successCount}\n- Failed: ${failCount}\n\n_Note: You can delete these messages from the Admin Panel._`, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Admin', 'admin_panel')]])
        });
    }
    else if (state === 'awaiting_user_points') {
        const points = parseInt(ctx.message.text);
        if (isNaN(points)) return ctx.reply("❌ Please enter a valid number.");
        
        const targetId = ctx.session.targetUser;
        const user = await User.findOne({ telegramId: targetId });
        user.points += points;
        await user.save();
        
        ctx.session.adminState = null;
        ctx.session.targetUser = null;
        ctx.reply(`✅ Added *${points}* points to *${user.firstName}*!\nNew balance: *${user.points}*`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to User', `view_user_${targetId}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
        });
    }
    else if (state === 'awaiting_cat_weight') {
        const weight = parseInt(ctx.message.text);
        if (isNaN(weight) || weight < 0) return ctx.reply("❌ Please enter a valid positive number.");
        await Category.findOneAndUpdate({ key: catKey }, { weight: weight });
        ctx.session.adminState = null;
        ctx.reply(`✅ Win chance for *${catKey}* set to *${weight}*!`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `manage_cat_${catKey}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
        });
    }
    else if (state === 'awaiting_cat_name') {
        await Category.findOneAndUpdate({ key: catKey }, { displayName: ctx.message.text });
        ctx.session.adminState = null;
        ctx.reply(`✅ Category renamed to: *${ctx.message.text}*`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `manage_cat_${catKey}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
        });
    }
    else if (state === 'awaiting_cat_threshold') {
        const refs = parseInt(ctx.message.text);
        if (isNaN(refs)) return ctx.reply("❌ Please enter a valid number.");
        await Category.findOneAndUpdate({ key: catKey }, { referralsRequired: refs });
        ctx.session.adminState = null;
        ctx.reply(`✅ Threshold for *${catKey}* set to *${refs}* referrals!`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `manage_cat_${catKey}`)], [Markup.button.callback('🏠 Main Menu', 'admin_panel')]])
        });
    }
    else if (state === 'awaiting_channel_name') {
        ctx.session.newChannel = { name: ctx.message.text };
        ctx.session.adminState = 'awaiting_channel_link';
        ctx.reply(`✅ Name set to: *${ctx.message.text}*\n\n🔗 *Step 2: Enter Channel Link or Username*\nSend the link (e.g. t.me/mychannel) or username (e.g. @mychannel).\n\n_Note: Bot must be admin in the channel._`);
    }
    else if (state === 'awaiting_channel_link') {
        let link = ctx.message.text.trim();
        let chatId = link;

        // Try to extract username for verification
        if (link.includes('t.me/')) {
            chatId = '@' + link.split('t.me/')[1].split('/')[0].replace('+', '');
        } else if (!link.startsWith('@')) {
            chatId = '@' + link;
        }

        ctx.session.newChannel.link = link.startsWith('http') ? link : `https://t.me/${link.replace('@', '')}`;
        ctx.session.newChannel.chatId = chatId;
        
        const settings = await Settings.findOne() || await Settings.create({});
        settings.mandatoryChannels.push(ctx.session.newChannel);
        await settings.save();
        
        ctx.session.adminState = null;
        ctx.session.newChannel = null;
        ctx.reply("🎉 *Channel Added Successfully!*", {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('📢 View Channels', 'admin_channels')]])
        });
    }
    else if (state === 'awaiting_reward_title') {
        // Legacy reward wizard - keep for backward compatibility if needed, otherwise ignore
        return next();
    }
    else {
        return next();
    }
});

bot.action('admin_settings', async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const settings = await Settings.findOne() || await Settings.create({});
    
    ctx.editMessageText(`⚙️ *Bot Settings*\n\n💰 *Referral Bonus:* ${settings.referralBonusPoints} points\n📝 *Welcome Msg:* ${settings.welcomeMessage}`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Change Bonus', 'edit_bonus')],
            [Markup.button.callback('⬅️ Back', 'admin_panel')]
        ])
    });
});

bot.action('edit_bonus', async (ctx) => {
    if (!ctx.state.user.isAdmin) return;
    const settings = await Settings.findOne() || await Settings.create({});
    ctx.session.adminState = 'awaiting_bonus_points';
    ctx.editMessageText(`💰 *Set Points Per Referral*\n\nCurrent Bonus: *${settings.referralBonusPoints}* points\n\nHow many points should a user get for *every 1 referral*?`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin_panel')]])
    });
});

// Update text handler for bonus
bot.on('text', async (ctx, next) => {
    if (!ctx.state.user || ctx.session.adminState !== 'awaiting_bonus_points') return next();
        const points = parseInt(ctx.message.text);
        if (isNaN(points)) return ctx.reply("❌ Please enter a valid number.");
        
        let settings = await Settings.findOne();
        settings.referralBonusPoints = points;
        await settings.save();
        
        ctx.session.adminState = null;
        ctx.reply(`✅ Bonus updated to *${points}* points!`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Settings', 'admin_settings')]])
        });
});

bot.action('edit_spin_cost', async (ctx) => {
    if (!ctx.state.user || !ctx.state.user.isAdmin) return;
    const settings = await Settings.findOne() || await Settings.create({});
    ctx.session.adminState = 'awaiting_spin_cost';
    ctx.editMessageText(`🎰 *Set Points Per Spin*\n\nCurrent Cost: *${settings.spinCost}* points\n\nHow many points should a user spend to **SPIN** for a reward?`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin_panel')]])
    });
});

// Update text handler for spin cost
bot.on('text', async (ctx, next) => {
    if (!ctx.state.user || ctx.session.adminState !== 'awaiting_spin_cost') return next();
    const points = parseInt(ctx.message.text);
    if (isNaN(points)) return ctx.reply("❌ Please enter a valid number.");
    
    let settings = await Settings.findOne();
    settings.spinCost = points;
    await settings.save();
    
    ctx.session.adminState = null;
    ctx.reply(`✅ Spin cost updated to *${points}* points!`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Admin', 'admin_panel')]])
    });
});

// Global error handler - prevents crash on non-critical Telegram errors
bot.catch((err, ctx) => {
    const ignoreMessages = [
        'message is not modified',
        'query is too old',
        'query ID is invalid',
        'message to edit not found',
        'message can\'t be deleted'
    ];

    if (err.message && ignoreMessages.some(msg => err.message.toLowerCase().includes(msg.toLowerCase()))) {
        return;
    }
    
    console.error(`Bot error for ${ctx.updateType}:`, err);
});

module.exports = bot;
