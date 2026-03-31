// bot.js (webhook-ready version for Render / other hosts)
// Minimal changes from your original file: switched to webhook & express
require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const admin = require('firebase-admin');
const https = require('https');
const fs = require('fs');
const path = require('path');

// --- 1. CONFIGURATION ---
const ADMIN_IDS = [
  '8270151543', // Owner (You)
  '610381979',  // Hobban
  '1907862263'  // Lid_h
];

// 🔴 REPLACE THIS WITH YOUR GROUP ID (Get it from @RawDataBot)
const REPORT_GROUP_ID = process.env.REPORT_GROUP_ID || '-5149161822';

// --- SERVICE ACCOUNT LOADING ---
// On Render you should upload your serviceAccountKey.json as a Secret File.
// Render exposes secret files at /etc/secrets/<filename> by default.
// Set SERVICE_ACCOUNT_PATH env var if you used a different name.
let serviceAccount;
const svcPathFromEnv = process.env.SERVICE_ACCOUNT_PATH || '/etc/secrets/serviceAccountKey.json';
if (fs.existsSync(svcPathFromEnv)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(svcPathFromEnv, 'utf8'));
    console.log('Loaded service account from', svcPathFromEnv);
  } catch (e) {
    console.error('Failed to parse service account from', svcPathFromEnv, e.message);
  }
} else {
  // Fallback to local file for development
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('Loaded local serviceAccountKey.json');
  } catch (e) {
    console.warn('No service account found at', svcPathFromEnv, 'or ./serviceAccountKey.json. Firestore init may fail.');
  }
}

// Initialize Firebase (only once)
if (!admin.apps.length) {
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    // If service account not found, try the default app (useful for some envs)
    try {
      admin.initializeApp();
    } catch (e) {
      console.error('Firebase initialization failed. Provide a service account or proper env config.', e.message);
    }
  }
}
const db = admin.firestore();

// --- Initialize Bots using environment variables ---
const USER_BOT_TOKEN = process.env.USER_BOT_TOKEN;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
if (!USER_BOT_TOKEN || !ADMIN_BOT_TOKEN) {
  console.error('USER_BOT_TOKEN and ADMIN_BOT_TOKEN must be set in environment variables.');
  // We do not exit here so the app can still deploy and show logs; Telegram actions will fail until tokens are provided.
}

const userBot = new Telegraf(USER_BOT_TOKEN || '');
const adminBot = new Telegraf(ADMIN_BOT_TOKEN || '');

// Apply session middleware to user bot (preserve registration flow)
userBot.use(session());

// --- 2. DATA LISTS ---
const STREAMS = ['Natural Science', 'Social Science'];

const UNI_CATEGORIES = {
  GOV: '🏛️ Government Universities',
  PVT_UNI: '🏢 Private Universities',
  PVT_COL: '🎓 Private Colleges',
  MED: '⚕️ Medical Schools'
};

const UNIVERSITIES = {
  GOV: [
    "Addis Ababa University", "Arbaminch University", "Arsi University", "Adigrat University",
    "Ambo University", "Assossa University", "AASTU", "ASTU", "Axum University",
    "Bahrdar University", "Bule Hora University", "Borena University", "Bonga University",
    "Civil Service University", "Debrebirhan University", "Debremarkos University",
    "Dire Dawa University", "Dembidollo University", "Debark University", "Dilla University",
    "Defense University", "Gambella University", "Gonder University", "Haramaya University",
    "Hawassa University", "Injibara University", "Jigjiga University", "Jinka University",
    "Jimma University", "Koberi Dehar University", "Kotebe University", "Mekedela Amba University",
    "Metu University", "Meda Welabu University", "Mekelle University", "Mizan Tepi University",
    "Oda Bultum University", "Raya University", "Salale University", "Semera University",
    "St. Paul Hospital", "Wachamo University", "Woldiya University", "Welkite University",
    "Wollo University", "Werabe University", "Wolayta Sodo University", "Wollega University"
  ],
  PVT_UNI: ["Admas University", "Unity University", "Rift Valley University", "Alpha University", "St. Mary University"],
  PVT_COL: ["CPU College", "Damat College", "Keamed College", "Gage College", "Nelson Mandela College", "Alkan College", "New Generation College", "Yardistic College", "Royal College"],
  MED: ["African Medical College", "Bethel Medical College", "Sante Medical College", "Hayat Medical College", "Korea (MMC)", "ECUSTA", "Lorcan Medical College", "Atlas Medical College"]
};

// --- 3. HELPER FUNCTIONS ---
const getMainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🇺🇸 English', 'lang_en'), Markup.button.callback('🇪🇹 አማርኛ', 'lang_am')]
]);

const getStreamMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🧬 Natural Science', 'stream_natural')],
  [Markup.button.callback('⚖️ Social Science', 'stream_social')]
]);

const getUniCategoryMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback(UNI_CATEGORIES.GOV, 'cat_GOV')],
  [Markup.button.callback(UNI_CATEGORIES.PVT_UNI, 'cat_PVT_UNI')],
  [Markup.button.callback(UNI_CATEGORIES.PVT_COL, 'cat_PVT_COL')],
  [Markup.button.callback(UNI_CATEGORIES.MED, 'cat_MED')],
]);

const getUniMenu = (category) => {
  const unis = UNIVERSITIES[category] || [];
  const buttons = unis.map(u => Markup.button.callback(u, `uni_${u.substring(0, 15)}`));
  return Markup.inlineKeyboard(buttons.reduce((result, item, index, array) => {
    if (index % 2 === 0) result.push(array.slice(index, index + 2));
    return result;
  }, []));
};

// --- 4. USER BOT FLOW ---
// keep your original flow and messages exactly
userBot.command('start', (ctx) => {
  ctx.session = { step: 'LANG' };
  ctx.reply("👋 Welcome! / እንኳን ደህና መጡ!\n\nTo begin, please select your language:", getMainMenu());
});

// A. Language
userBot.action(/lang_(.+)/, (ctx) => {
  const lang = ctx.match[1];
  ctx.session.lang = lang;
  ctx.session.step = 'NAME';
  const msg = lang === 'en' ? "👤 Please enter your **Full Name**:" : "👤 እባክዎ **ሙሉ ስምዎን** ያስገቡ:";
  ctx.replyWithMarkdown(msg);
});

// B. Stream Selection
userBot.action(/stream_(.+)/, (ctx) => {
  const stream = ctx.match[1];
  ctx.session.stream = stream;
  ctx.session.step = 'UNI_CAT';
  const msg = ctx.session.lang === 'en' ? "🏫 Select your Institution Category:" : "🏫 የትምህርት ተቋም ምድብ ይምረጡ:";
  ctx.reply(msg, getUniCategoryMenu());
});

// C. Uni Category Selection
userBot.action(/cat_(.+)/, (ctx) => {
  const cat = ctx.match[1];
  ctx.session.uniCategory = cat;
  ctx.session.step = 'UNI_SELECT';
  ctx.reply("🏛 Choose your University:", getUniMenu(cat));
});

// D. University Selection (Partial match logic)
userBot.action(/uni_(.+)/, (ctx) => {
  ctx.session.university = ctx.match[1];
  ctx.session.step = 'PHONE';
  const msg = ctx.session.lang === 'en' 
    ? "📱 Please enter your **Phone Number** (e.g., 0911223344):" 
    : "📱 እባክዎ **ስልክ ቁጥርዎን** ያስገቡ (ምሳሌ: 0911223344):";
  ctx.replyWithMarkdown(msg);
});

// E. Handle Text Inputs (Name, Phone, Password)
userBot.on('text', (ctx) => {
  if (!ctx.session) return ctx.reply("Type /start to restart.");
  const step = ctx.session.step;
  const text = ctx.message.text.trim();

  if (step === 'NAME') {
    ctx.session.fullName = text;
    ctx.session.step = 'STREAM';
    const msg = ctx.session.lang === 'en' ? "🧬 Select your Stream:" : "🧬 የትምህርት ዘርፍ ይምረጡ:";
    ctx.reply(msg, getStreamMenu());
  } 
  else if (step === 'PHONE') {
    if (text.length < 9) return ctx.reply("❌ Invalid number.");
    ctx.session.phone = text;
    ctx.session.step = 'PASS';
    const msg = ctx.session.lang === 'en' 
      ? "🔒 Create a **Password** (4+ characters):" 
      : "🔒 **የይለፍ ቃል** ይፍጠሩ (4+ ቁምፊዎች):";
    ctx.replyWithMarkdown(msg);
  }
  else if (step === 'PASS') {
    if (text.length < 4) return ctx.reply("❌ Too short.");
    ctx.session.password = text;
    ctx.session.step = 'PAYMENT';
    
    const paymentMsg = ctx.session.lang === 'en'
      ? `💸 **Payment Required: 200 ETB**\n\n🏦 CBE: 1000293836648 (Admassu Yano)\n📱 Telebirr: 0907667755 (Admassu Yano)\n\n📸 **Send screenshot of payment.**`
      : `💸 **ክፍያ ያስፈልጋል: 200 ብር**\n\n🏦 ንግድ ባንክ: 1000293836648 (Admassu Yano)\n📱 ቴሌብር: 0907667755 (Admassu Yano)\n\n📸 **የከፈሉበትን ደረሰኝ ስክሪንሾት ይላኩ።**`;
    
    ctx.replyWithMarkdown(paymentMsg);
  }
});

// F. Handle Payment Screenshot
userBot.on('photo', async (ctx) => {
  if (!ctx.session || ctx.session.step !== 'PAYMENT') return;

  const user = ctx.from;
  const data = ctx.session;
  
  try {
    await db.collection('users').doc(data.phone).set({
      fullName: data.fullName,
      phoneNumber: data.phone,
      password: data.password,
      stream: data.stream,
      university: data.university,
      telegramId: user.id,
      telegramUsername: user.username || 'No Username',
      approved: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      deviceId: null
    });

    const photo = ctx.message.photo.pop();
    const fileId = photo.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const buffer = await new Promise((resolve, reject) => {
        https.get(fileLink.href, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });

    for (const adminId of ADMIN_IDS) {
      try {
        const caption = 
          `🚨 **NEW REQUEST**\n\n` +
          `👤 Name: ${data.fullName}\n` +
          `📱 Phone: ${data.phone}\n` +
          `🎓 Stream: ${data.stream}\n` +
          `🏫 Uni: ${data.university}\n` +
          `🆔 TG ID: ${user.id}\n` +
          `🔗 Username: @${user.username || 'None'}`;

        await adminBot.telegram.sendPhoto(adminId, { source: buffer }, {
          caption: caption,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve_${data.phone}`), Markup.button.callback('❌ Reject', `reject_${data.phone}`)]
          ])
        });
      } catch (err) {
        console.error(`Failed to send to admin ${adminId}:`, err.message);
      }
    }

    ctx.reply(data.lang === 'en' ? "✅ Sent for approval. Please wait 30 minutes to 1 hour." : "✅ ተልኳል። እባክዎ ከ30 ደቂቃ እስከ 1 ሰዓት ድረስ ይጠብቁ።");
    ctx.session = null;

  } catch (error) {
    console.error("DB Error:", error);
    ctx.reply("❌ Error saving data.");
  }
});

// --- 5. ADMIN BOT ACTIONS ---
adminBot.action(/approve_(.+)/, async (ctx) => {
  const phone = ctx.match[1];
  try {
    await db.collection('users').doc(phone).update({ approved: true });
    const doc = await db.collection('users').doc(phone).get();
    const userData = doc.data();
    await userBot.telegram.sendMessage(userData.telegramId, "🎉 APPROVED!

You can now login to the App using your phone number and password in @ExamStoreBot.", { parse_mode: 'Markdown' });
    const handlerName = ctx.from.first_name;
    for (const adminId of ADMIN_IDS) {
        try {
            await adminBot.telegram.sendMessage(adminId, `✅ User ${userData.fullName} (${phone}) was **APPROVED** by ${handlerName}.`, { parse_mode: 'Markdown' });
        } catch (e) {}
    }
    ctx.answerCbQuery("Approved!");
  } catch (error) {
    console.error(error);
    ctx.reply("Error approving.");
  }
});

adminBot.action(/reject_(.+)/, async (ctx) => {
  const phone = ctx.match[1];
  try {
    await db.collection('users').doc(phone).update({ approved: false, status: 'rejected' });
    const doc = await db.collection('users').doc(phone).get();
    const userData = doc.data();
    await userBot.telegram.sendMessage(userData.telegramId, "❌ Registration Rejected. Contact Admin.");
    const handlerName = ctx.from.first_name;
    for (const adminId of ADMIN_IDS) {
        try {
            await adminBot.telegram.sendMessage(adminId, `🚫 User ${userData.fullName} (${phone}) was **REJECTED** by ${handlerName}.`, { parse_mode: 'Markdown' });
        } catch (e) {}
    }
    ctx.answerCbQuery("Rejected.");
  } catch (error) {
    console.error(error);
  }
});

// --- 6. NEW: REPORT LISTENER (WATCHES FIREBASE) ---
try {
  db.collection('reports')
    .where('status', '==', 'pending')
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const reportId = change.doc.id;

          const message = `🚨 **NEW ISSUE REPORT**\n\n` +
                          `📚 **Exam:** ${data.examTitle}\n` +
                          `❓ **Question ID:** ${data.questionId}\n` +
                          `👤 **User:** ${data.userId}\n` +
                          `📅 **Time:** ${new Date().toLocaleString()}\n\n` +
                          `💬 **Complaint:**\n"${data.reportContent}"`;

          try {
              if (REPORT_GROUP_ID) {
                  await adminBot.telegram.sendMessage(REPORT_GROUP_ID, message, { parse_mode: 'Markdown' });
                  await db.collection('reports').doc(reportId).update({ status: 'notified' });
              } else {
                  console.log("⚠️ Report received but REPORT_GROUP_ID not set!");
              }
          } catch (error) {
              console.error("Failed to send report to group:", error);
          }
        }
      });
    }, (error) => console.error("Firestore Listen Error:", error));
} catch (e) {
  console.error('Failed to attach Firestore listener:', e.message);
}

// --- 7. WEBHOOK / EXPRESS SERVER SETUP ---
const express = require('express');
const app = express();

// Default webhook paths (you can override via env)
const WEBHOOK_PATH_USER = process.env.WEBHOOK_PATH_USER || `/webhook/user/${USER_BOT_TOKEN}`;
const WEBHOOK_PATH_ADMIN = process.env.WEBHOOK_PATH_ADMIN || `/webhook/admin/${ADMIN_BOT_TOKEN}`;

// Mount telegraf webhook callbacks (keeps all handlers intact)
app.use(userBot.webhookCallback(WEBHOOK_PATH_USER));
app.use(adminBot.webhookCallback(WEBHOOK_PATH_ADMIN));

// Health check
app.get('/', (req, res) => res.send('OK'));

// Startup: set webhooks if APP_URL provided
async function init() {
  const PORT = process.env.PORT || 10000;
  const APP_URL = process.env.APP_URL; // e.g. https://your-service.onrender.com

  if (APP_URL && USER_BOT_TOKEN) {
    const webhookUrl = `${APP_URL}${WEBHOOK_PATH_USER}`;
    try {
      console.log('Setting userBot webhook to:', webhookUrl);
      await userBot.telegram.setWebhook(webhookUrl);
      console.log('userBot webhook set OK');
    } catch (err) {
      console.error('Failed to set userBot webhook:', err.response?.body || err.message || err);
    }
  } else {
    console.log('APP_URL or USER_BOT_TOKEN not set — userBot webhook not set automatically.');
  }

  if (APP_URL && ADMIN_BOT_TOKEN) {
    const webhookUrl = `${APP_URL}${WEBHOOK_PATH_ADMIN}`;
    try {
      console.log('Setting adminBot webhook to:', webhookUrl);
      await adminBot.telegram.setWebhook(webhookUrl);
      console.log('adminBot webhook set OK');
    } catch (err) {
      console.error('Failed to set adminBot webhook:', err.response?.body || err.message || err);
    }
  } else {
    console.log('APP_URL or ADMIN_BOT_TOKEN not set — adminBot webhook not set automatically.');
  }

  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

init().catch(err => console.error('Init error', err));

// Graceful shutdown: remove webhooks if needed and stop bots
process.once('SIGINT', async () => {
  try { await userBot.telegram.deleteWebhook(); } catch (e) {}
  try { await adminBot.telegram.deleteWebhook(); } catch (e) {}
  try { userBot.stop('SIGINT'); adminBot.stop('SIGINT'); } catch (e) {}
  process.exit(0);
});
process.once('SIGTERM', async () => {
  try { await userBot.telegram.deleteWebhook(); } catch (e) {}
  try { await adminBot.telegram.deleteWebhook(); } catch (e) {}
  try { userBot.stop('SIGTERM'); adminBot.stop('SIGTERM'); } catch (e) {}
  process.exit(0);
});

console.log("🚀 Pro Bot (webhook mode) loaded...");
