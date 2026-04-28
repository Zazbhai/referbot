# 🚀 Modern Telegram Referral Bot with Admin Panel

A high-performance Telegram Referral Bot built with **Node.js**, **Telegraf**, and **MongoDB**. Featuring a stunning **Telegram Mini App** for both users and admins with glassmorphism design and smooth animations.

## ✨ Features

- **Advanced Referral Tracking**: Automatic tracking of joins via referral links.
- **Modern UI Dashboard**: A beautiful Telegram Mini App for users to see their stats and rewards.
- **Admin Control Center**:
    - Real-time stats (Total users, referrals, rewards given).
    - Manage referral rewards (Add/Edit/Remove).
    - Global system settings.
- **Reward System**: Customizable thresholds for giving rewards.
- **Superfast & Animating**: Built with Vite and CSS keyframes for a premium feel.

## 🛠 Tech Stack

- **Backend**: Node.js, Express, Telegraf (Telegram Bot API), Mongoose (MongoDB).
- **Frontend**: Vite, Vanilla JS, CSS (Glassmorphism).
- **Database**: MongoDB.

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v16+)
- MongoDB (Running locally or MongoDB Atlas)
- A Telegram Bot Token (Get one from [@BotFather](https://t.me/BotFather))

### 2. Installation

1. Clone or download this project.
2. Open the `.env` file and fill in your details:
   - `BOT_TOKEN`: Your Telegram Bot token.
   - `MONGODB_URI`: Your MongoDB connection string.
   - `ADMIN_ID`: Your Telegram ID (to access the admin panel).
   - `FRONTEND_URL`: Usually `http://localhost:5173` for local dev.

3. Install dependencies:
   ```bash
   npm install
   cd client && npm install
   ```

### 3. Running the Bot

Run both the backend and frontend simultaneously:
```bash
npm run all
```

## 📱 Using the Bot

1. Open your bot in Telegram and type `/start`.
2. You will see your referral link and stats.
3. Click **"🚀 Open Dashboard"** to see the modern Mini App.
4. If you are the admin, you will see a **"🛠 Admin Panel"** button.

## 🔒 Security Note
In production, make sure to:
- Use `https` for the `FRONTEND_URL`.
- Implement `initData` validation in the backend for the Mini App routes.
- Secure your MongoDB instance.

---
Built with ❤️ by Antigravity
