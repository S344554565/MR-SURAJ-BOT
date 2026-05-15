const fca = require('@atf-team/fca-chand');
const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const moment = require('moment-timezone');
const axios = require('axios');
const stripAnsi = require('strip-ansi');

const logs = require('./Data/utility/logs');
const listen = require('./Data/system/listen');
const { loadCommands, loadEvents } = require('./Data/system/handle/handleRefresh');
const UsersController = require('./Data/system/controllers/users');
const ThreadsController = require('./Data/system/controllers/threads');
const CurrenciesController = require('./Data/system/controllers/currencies');
const CookieManager = require('./Data/system/cookieManager');

let originalConsoleError;
let originalConsoleWarn;
let originalConsoleLog;

function suppressFCALogs() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  originalConsoleLog = originalLog;
  originalConsoleError = originalError;
  originalConsoleWarn = originalWarn;
  
  console.log = (...args) => {
    originalLog.apply(console, args);
    try {
      const raw = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      const msg = stripAnsi(raw);
      const time = moment().tz('Asia/Karachi').format('hh:mm:ss A') + ' || ' + moment().tz('Asia/Karachi').format('DD/MM/YYYY');
    } catch (e) {}
  };
  
console.error = (...args) => {
    const raw = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    originalError.apply(console, args);
    try {
      const msg = stripAnsi(raw);
      const time = moment().tz('Asia/Karachi').format('hh:mm:ss A') + ' || ' + moment().tz('Asia/Karachi').format('DD/MM/YYYY');
    } catch (e) {}
  };

  console.warn = (...args) => {
    originalWarn.apply(console, args);
  };
  
  console.log = (...args) => {
    originalLog.apply(console, args);
    try {
      const raw = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      const msg = stripAnsi(raw);
      const time = moment().tz('Asia/Karachi').format('hh:mm:ss A') + ' || ' + moment().tz('Asia/Karachi').format('DD/MM/YYYY');
    } catch (e) {}
  };
}

function restoreConsole() {
  if (originalConsoleError) console.error = originalConsoleError;
  if (originalConsoleWarn) console.warn = originalConsoleWarn;
  if (originalConsoleLog) console.log = originalConsoleLog;
}

function getConfig() {
  return JSON.parse(fs.readFileSync('./config.json', 'utf8'));
}

const appstatePath = path.join(__dirname, 'Data/system/appstate.json');
const configPath = path.join(__dirname, 'config.json');
const islamicPath = path.join(__dirname, 'Data/config/islamic_messages.json');
const commandsPath = path.join(__dirname, 'node_modules/lodash-pari/commands');
const eventsPath = path.join(__dirname, 'node_modules/lodash-pari/events');

let config = null;

let islamicMessages = {};
let api = null;
let client = {
  commands: new Map(),
  events: new Map(),
  replies: new Map(),
  cooldowns: new Map()
};

let isBotRunning = false;
let mqttListeners = [];

async function stopBot() {
  // CRITICAL: Reset flags FIRST before anything else
  isBotRunning = false;
  global.isBotRunning = false;
  global.api = null;
  global.listenInstance = null;
  global.lastStopped = Date.now();
  mqttListeners = [];
  
  try {
console.log('[🛑] Stopping bot...');
    
    // CRITICAL: Stop all tracked MQTT listeners FIRST
    if (mqttListeners.length > 0) {
      console.log('[🛑] Stopping', mqttListeners.length, 'MQTT listeners...');
      mqttListeners.forEach(fn => {
        try { fn(); } catch(e) {}
      });
      mqttListeners = [];
    }
    
    // First, stop all scheduled tasks
    try {
      const { stopAllSchedulers } = require('./Data/utility/schedulers');
      if (stopAllSchedulers) stopAllSchedulers();
    } catch (e) {}
    
    // Remove all event listeners from api
    if (api && api.removeAllListeners) {
      try {
        api.removeAllListeners();
      } catch (e) {}
    }
    
// Stop MQTT listen only - don't logout (keep account logged in)
    if (api && api.removeAllListeners) {
      try {
        api.removeAllListeners();
      } catch (e) {}
    }
    
    // Generate new listener ID to prevent old connections
    global.listenerId = Date.now();
    
    // Force cleanup api reference
    if (api) {
      api = null;
    }
    
    global.listenInstance = null;
    global.api = null;
    global.startTime = null;
    global.isBotRunning = false;
    
    config = null;
    islamicMessages = {};
    client.commands.clear();
    client.events.clear();
    client.replies.clear();
    client.cooldowns.clear();
    isBotRunning = false;
    restoreConsole();
    
    // Clear bot info on stop
    try {
      const fs = require('fs-extra');
      const botInfoPath = path.join(__dirname, 'Data/system/database/botdata/bot_info.json');
      if (await fs.pathExists(botInfoPath)) {
        await fs.remove(botInfoPath);
      }
    } catch(e) {}
    
    console.log('[🛑] Bot stopped successfully');
  } catch (error) {
    console.log('[❌] Error stopping bot:', error.message);
  }
}

const quranPics = [
  'https://i.ibb.co/8gWzFpqV/bbc9bf12376e.jpg',
  'https://i.ibb.co/DgGmLMTL/2a27f2cecc80.jpg',
  'https://i.ibb.co/Kz8CBZBD/db27a4756c35.jpg',
  'https://i.ibb.co/zTKnLMq9/c52345ec3639.jpg',
  'https://i.ibb.co/8gfGBHDr/8e3226ab3861.jpg',
  'https://i.ibb.co/WNK2Dbbq/ffed087e09a5.jpg',
  'https://i.ibb.co/hRVXMQhz/fe5e09877fa8.jpg'
];

const namazPics = [
  'https://i.ibb.co/sp39k0CY/e2630b0f2713.jpg',
  'https://i.ibb.co/BKdttjgN/8cd831a43211.jpg',
  'https://i.ibb.co/Q3hVDVMr/c0de33430ba4.jpg',
  'https://i.ibb.co/7td1kK7W/6d713bbe5418.jpg'
];

const quranAyats = [
  {
    arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    urdu: "اللہ کے نام سے جو بڑا مہربان نہایت رحم والا ہے",
    surah: "Surah Al-Fatiha: 1"
  },
  {
    arabic: "إِنَّ مَعَ الْعُسْرِ يُسْرًا",
    urdu: "بے شک مشکل کے ساتھ آسانی ہے",
    surah: "Surah Ash-Sharh: 6"
  },
  {
    arabic: "وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ",
    urdu: "اور جو اللہ پر توکل کرے تو وہ اسے کافی ہے",
    surah: "Surah At-Talaq: 3"
  },
  {
    arabic: "فَاذْكُرُونِي أَذْكُرْكُمْ",
    urdu: "پس تم مجھے یاد کرو میں تمہیں یاد کروں گا",
    surah: "Surah Al-Baqarah: 152"
  },
  {
    arabic: "وَاصْبِرْ وَمَا صَبْرُكَ إِلَّا بِاللَّهِ",
    urdu: "اور صبر کرو اور تمہارا صبر اللہ ہی کی توفیق سے ہے",
    surah: "Surah An-Nahl: 127"
  },
  {
    arabic: "إِنَّ اللَّهَ مَعَ الصَّابِرِينَ",
    urdu: "بے شک اللہ صبر کرنے والوں کے ساتھ ہے",
    surah: "Surah Al-Baqarah: 153"
  },
  {
    arabic: "وَلَا تَيْأَسُوا مِن رَّوْحِ اللَّهِ",
    urdu: "اور اللہ کی رحمت سے مایوس نہ ہو",
    surah: "Surah Yusuf: 87"
  },
  {
    arabic: "رَبِّ اشْرَحْ لِي صَدْرِي",
    urdu: "اے میرے رب میرے سینے کو کھول دے",
    surah: "Surah Ta-Ha: 25"
  },
  {
    arabic: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
    urdu: "اللہ ہمیں کافی ہے اور وہ بہترین کارساز ہے",
    surah: "Surah Al-Imran: 173"
  },
  {
    arabic: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
    urdu: "اور کہو کہ اے میرے رب میرے علم میں اضافہ فرما",
    surah: "Surah Ta-Ha: 114"
  },
  {
    arabic: "إِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ",
    urdu: "بے شک اللہ نیکی کرنے والوں کا اجر ضائع نہیں کرتا",
    surah: "Surah Yusuf: 90"
  },
  {
    arabic: "وَتُوبُوا إِلَى اللَّهِ جَمِيعًا أَيُّهَ الْمُؤْمِنُونَ",
    urdu: "اور اے مومنو تم سب اللہ کے حضور توبہ کرو",
    surah: "Surah An-Nur: 31"
  }
];

const namazTimes = {
  fajr: { time: '05:43', name: 'Fajr' },
  sunrise: { time: '07:04', name: 'Sunrise' },
  dhuhr: { time: '12:23', name: 'Dhuhr' },
  asr: { time: '16:07', name: 'Asr' },
  maghrib: { time: '17:43', name: 'Maghrib' },
  isha: { time: '19:04', name: 'Isha' }
};

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    global.config = config;
  } catch (error) {
    logs.error('CONFIG', 'Failed to load config:', error.message);
    config = {
      BOTNAME: 'CHAND BOT',
      PREFIX: '$',
      ADMINBOT: ['100051084735858', '100012106845156'],
      TIMEZONE: 'Asia/Karachi',
      PREFIX_ENABLED: true,
      REACT_DELETE_EMOJI: '😡',
      ADMIN_ONLY_MODE: false,
      AUTO_ISLAMIC_POST: true,
      AUTO_ALL_TAG: false,
      ALL_TAG_INTERVAL: 1,
      ALL_TAG_MESSAGE: '@everyone',
      AUTO_GROUP_MESSAGE: true
    };
    global.config = config;
  }
}

function loadIslamicMessages() {
  try {
    islamicMessages = fs.readJsonSync(islamicPath);
  } catch (error) {
    logs.error('ISLAMIC', 'Failed to load islamic messages:', error.message);
    islamicMessages = { posts: [], groupMessages: [] };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    global.config = config;
  } catch (error) {
    logs.error('CONFIG', 'Failed to save config:', error.message);
  }
}

async function downloadImage(url, filePath) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    return true;
  } catch {
    return false;
  }
}

async function sendAllMemberTag() {
  try {
    if (!api) return;
    if (!config.AUTO_ALL_TAG) return;

    let threads = [];
    try {
      threads = require('./Data/system/database/models/threads').getAll();
    } catch (e) {
      threads = [];
    }

    if (threads.length === 0) return;

    for (const thread of threads) {
      try {
        const threadID = thread.id;
        let info;
        try {
          info = await api.getThreadInfo(threadID);
        } catch (e) {
          if (e.message?.includes('GraphQL') || e.message?.includes('No message_thread')) {
            continue;
          }
        }
        if (!info || !info.participantIDs) continue;
        
        const allUsers = info.participantIDs;
        let userInfo = {};
        try {
          userInfo = await api.getUserInfo(allUsers);
        } catch (e) {}
        
        for (let i = 0; i < allUsers.length; i += 20) {
          const batch = allUsers.slice(i, i + 20);
          let mentions = [];
          let text = '';
          
          for (const uid of batch) {
            const name = userInfo[uid]?.name?.split(' ')[0] || 'Member';
            mentions.push({ id: String(uid), tag: '@' + name, fromIndex: text.length });
            text += '@' + name + ' ';
          }
          
          text = text.trim();
          if (!text) text = '@all';
          
          await api.sendMessage({ body: text, mentions }, threadID);
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {
      }
    }
  } catch (err) {
  }
}

async function sendQuranAyat() {
  if (!api || !config.AUTO_ISLAMIC_POST) return;

  try {
    let threads = [];
    try {
      threads = require('./Data/system/database/models/threads').getAll();
    } catch (e) {
      threads = [];
    }
    
    if (threads.length === 0) {
      logs.info('QURAN_POST', 'No threads found, skipping post');
      return;
    }

    const randomAyat = quranAyats[Math.floor(Math.random() * quranAyats.length)];
    const randomPic = quranPics[Math.floor(Math.random() * quranPics.length)];
    const time = moment().tz('Asia/Karachi').format('hh:mm A');

    const message = `📖 𝐐𝐔𝐑𝐀𝐍 𝐀𝐘𝐀𝐓

${randomAyat.arabic}

𝐔𝐫𝐝𝐮 𝐓𝐫𝐚𝐧𝐬𝐥𝐚𝐭𝐢𝐨𝐧:
${randomAyat.urdu}

📍 ${randomAyat.surah}

🕌 ${config.BOTNAME} | ${time} PKT`.trim();

    const cacheDir = path.join(__dirname, 'node_modules/lodash-pari/commands/cache');
    fs.ensureDirSync(cacheDir);
    const imgPath = path.join(cacheDir, `quran_${Date.now()}.jpg`);

    const downloaded = await downloadImage(randomPic, imgPath);

    for (const thread of threads) {
      try {
        if (downloaded && fs.existsSync(imgPath)) {
          await api.sendMessage({
            body: message,
            attachment: fs.createReadStream(imgPath)
          }, thread.id);
        } else {
          await api.sendMessage(message, thread.id);
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        logs.error('QURAN_POST', `Failed to send to ${thread.id}:`, e.message);
      }
    }

    try { fs.unlinkSync(imgPath); } catch {}
    logs.success('QURAN_POST', `Sent Quran Ayat to ${threads.length} groups`);
  } catch (error) {
    logs.error('QURAN_POST', error.message);
  }
}

async function sendNamazAlert(namazName) {
  if (!api) return;

  try {
    const threads = require('./Data/system/database/models/threads').getAll();
    const approvedThreads = threads.filter(t => t.approved === 1 && t.banned !== 1);

    if (approvedThreads.length === 0) return;

    const randomPic = namazPics[Math.floor(Math.random() * namazPics.length)];
    const time = moment().tz('Asia/Karachi').format('hh:mm A');

    const message = `🕌 𝐍𝐀𝐌𝐀𝐙 𝐀𝐋𝐄𝐑𝐓

⏰ ${namazName.toUpperCase()} کا وقت ہو گیا!

"إِنَّ الصَّلَاةَ كَانَتْ عَلَى 
الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا"

بے شک نماز مومنوں پر وقت 
مقررہ پر فرض ہے۔

📍 نماز پڑھیں - جنت کی چابی

🕌 ${config.BOTNAME} | ${time} PKT`.trim();

    const cacheDir = path.join(__dirname, 'node_modules/lodash-pari/commands/cache');
    fs.ensureDirSync(cacheDir);
    const imgPath = path.join(cacheDir, `namaz_${Date.now()}.jpg`);

    const downloaded = await downloadImage(randomPic, imgPath);

    for (const thread of approvedThreads) {
      try {
        if (downloaded && fs.existsSync(imgPath)) {
          await api.sendMessage({
            body: message,
            attachment: fs.createReadStream(imgPath)
          }, thread.id);
        } else {
          await api.sendMessage(message, thread.id);
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        logs.error('NAMAZ_ALERT', `Failed to send to ${thread.id}:`, e.message);
      }
    }

    try { fs.unlinkSync(imgPath); } catch {}
    logs.success('NAMAZ_ALERT', `Sent ${namazName} alert to ${approvedThreads.length} groups`);
  } catch (error) {
    logs.error('NAMAZ_ALERT', error.message);
  }
}

function setupSchedulers() {
  // Hourly Quran Ayat
  cron.schedule('0 * * * *', () => {
    logs.info('SCHEDULER', 'Hourly Quran Ayat triggered');
    sendQuranAyat();
  }, {
    timezone: 'Asia/Karachi'
  });

  // All Members Tagging (configurable interval)
  if (config.AUTO_ALL_TAG && config.ALL_TAG_INTERVAL) {
    const interval = parseInt(config.ALL_TAG_INTERVAL) || 1;
    const cronExpr = interval === 1 ? '* * * * *' : `*/${interval} * * * *`;
    cron.schedule(cronExpr, () => {
      logs.info('SCHEDULER', 'All Tag triggered');
      if (!api || !config.AUTO_ALL_TAG) return;
      sendAllMemberTag();
    }, { timezone: 'Asia/Karachi' });
    logs.success('SCHEDULER', `All Tag every ${interval} min`);
  } else {
    logs.info('SCHEDULER', 'All Tag disabled');
  }

  cron.schedule('43 5 * * *', () => {
    logs.info('SCHEDULER', 'Fajr Namaz Alert');
    sendNamazAlert('Fajr');
  }, { timezone: 'Asia/Karachi' });

  cron.schedule('23 12 * * *', () => {
    logs.info('SCHEDULER', 'Dhuhr Namaz Alert');
    sendNamazAlert('Dhuhr');
  }, { timezone: 'Asia/Karachi' });

  cron.schedule('7 16 * * *', () => {
    logs.info('SCHEDULER', 'Asr Namaz Alert');
    sendNamazAlert('Asr');
  }, { timezone: 'Asia/Karachi' });

  cron.schedule('43 17 * * *', () => {
    logs.info('SCHEDULER', 'Maghrib Namaz Alert');
    sendNamazAlert('Maghrib');
  }, { timezone: 'Asia/Karachi' });

  cron.schedule('4 19 * * *', () => {
    logs.info('SCHEDULER', 'Isha Namaz Alert');
    sendNamazAlert('Isha');
  }, { timezone: 'Asia/Karachi' });

  logs.success('SCHEDULER', 'Quran Ayat + Namaz Alerts schedulers started');
}

async function reinstallLodashPari() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('npm uni lodash-parii', (err) => {
      if (err) {
      }
      exec('npm i lodash-parii', (err2) => {
        if (err2) {
        } else {
        }
        resolve();
      });
    });
  });
}

async function startBot() {
  // Prevent multiple instances
  if (isBotRunning || global.isBotRunning) {
    logs.warn('BOT', 'Bot is already running!');
    return;
  }
  
  // Check if recently stopped (wait for cleanup)
  if (global.lastStopped && Date.now() - global.lastStopped < 5000) {
    logs.warn('BOT', 'Recently stopped, waiting...');
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Set running flag
  isBotRunning = true;
  global.isBotRunning = true;
  
// Delete account issue file on bot start
  try {
    const fs = require('fs-extra');
    if (fs.existsSync('./Data/system/account_issue.txt')) {
      fs.removeSync('./Data/system/account_issue.txt');
    }
    global.accountAlertSent = false;
    global.accountIssueSaved = false;
  } catch (e) {}
  
  // Notify dashboard about bot loading
  try {
    if (global.io) {
      global.io.emit('botLoading', { loading: true, time: new Date().toISOString() });
    }
  } catch(e) {}
  
  isBotRunning = true;
  suppressFCALogs();
  logs.banner();
  await reinstallLodashPari();
  loadConfig();
  loadIslamicMessages();

  // Try to auto-refresh appstate from cookies if they exist
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    logs.info('COOKIES', 'Found cookies.txt - checking for updates...');
    if (CookieManager.validateCookies()) {
      const refreshed = CookieManager.generateAppstateFromCookies();
      if (refreshed) {
        logs.success('COOKIES', 'AppState successfully refreshed from cookies');
      } else {
        logs.warn('COOKIES', 'Could not generate appstate from cookies, using existing appstate');
      }
    } else {
      logs.warn('COOKIES', 'Cookies validation failed, using existing appstate');
    }
  }

  let appstate;
  try {
    appstate = fs.readJsonSync(appstatePath);
  } catch (error) {
    logs.error('APPSTATE', 'Failed to load Data/appstate.json');
    logs.error('APPSTATE', 'Please provide valid appstate through the web panel');
    isBotRunning = false;
    return;
  }

  logs.info('BOT', 'Starting CHAND BOT...');
  logs.info('BOT', `Timezone: ${config.TIMEZONE}`);
  logs.info('BOT', `Prefix: ${config.PREFIX}`);

  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  
  process.stderr.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (str.includes('WARN') || str.includes('ERROR') || str.includes('SESSION') || 
        str.includes('REGION') || str.includes('ACCOUNT') || str.includes('SYSTEM') || 
        str.includes('SUCCESS') || str.includes('READY') || str.includes('AUTH') ||
        str.includes('mqtt') || str.includes('FCA fix') || str.includes('SCHEDULER') ||
        str.includes('LOADER') || str.includes('LOGIN') || str.includes('COOKIES') ||
        str.includes('NOTIFY')) {
      return true;
    }
    try {
      return originalStderrWrite(chunk, encoding, callback);
    } catch (error) {
      return true; // Suppress error
    }
  };

  process.stdout.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (str.includes('[07:') || str.includes('WARN') || str.includes('SESSION') || 
        str.includes('REGION') || str.includes('ACCOUNT') || str.includes('SYSTEM') || 
        str.includes('SUCCESS') || str.includes('READY') || str.includes('AUTH') ||
        str.includes('mqtt') || str.includes('fca-unofficial') || str.includes('SCHEDULER') ||
        str.includes('LOADER') || str.includes('LOGIN') || str.includes('COOKIES') ||
        str.includes('NOTIFY')) {
      return true;
    }
    try {
      return originalStdoutWrite(chunk, encoding, callback);
    } catch (error) {
      return true; // Suppress error
    }
  };

  fca({ appState: appstate }, {
    listenEvents: true,
    selfListen: false,
    autoMarkRead: true,
    forceLogin: true
  }, async (err, loginApi) => {
    if (err) {
      logs.error('LOGIN', 'Failed to login:', err.message || err);
      return;
    }

    api = loginApi;
    global.api = api;
    global.startTime = Date.now();
    global.isBotRunning = true;

    let isLoggedIn = false;

    try {
      const botID = api.getCurrentUserID();
      let botName = null;
      try {
        const botInfo = await api.getUserInfo(botID);
        if (botInfo && botInfo[botID] && botInfo[botID].name) {
          botName = botInfo[botID].name;
        }
      } catch (_) {}
      if (!botName) {
        try {
          const botInfoV2 = await api.getUserInfoV2(botID);
          if (botInfoV2 && botInfoV2.name) {
            botName = botInfoV2.name;
          }
        } catch (_) {}
      }
      botName = botName || global.config?.BOTNAME || 'MANO';
      if (botName) {
        console.log('[👤] Bot ID: ' + botID);
        console.log('[👤] Bot Name: ' + botName);
        isLoggedIn = true;
        
        // Notify dashboard about successful login
        try {
          if (global.io) {
            global.io.emit('botStarted', { success: true, name: botName, time: new Date().toISOString() });
          }
        } catch(e) {}
        
        // Save bot info for dashboard
        try {
          const fs = require('fs-extra');
          const botInfoPath = path.join(__dirname, 'Data/system/database/botdata/bot_info.json');
          await fs.ensureDir(path.dirname(botInfoPath));
          await fs.writeFile(botInfoPath, JSON.stringify({ id: botID, name: botName }, null, 2));
        } catch(e) {}
      } else {
        throw new Error('Invalid bot info');
      }
    } catch (err) {
      console.log('[❌] Login failed! Account may be logged out or cookies expired.');
      console.log('[💡] Please update cookies.txt or appstate and restart bot.');
      console.log('[🔴] Bot NOT started');

      try {
        fs.unlinkSync(appstatePath);
        console.log('[🗑️] Old appstate deleted - please upload new credentials');
      } catch (e) {}

      logs.error('LOGIN', 'Bot login failed - ' + err.message);
      return;
    }

    if (!isLoggedIn) {
      console.log('[❌] Bot login verification failed!');
      console.log('[🔴] Bot NOT started - fix credentials and restart');
      logs.error('LOGIN', 'Bot could not verify login - account may be logged out');
      return;
    }

    logs.success('LOGIN', 'Successfully logged in!');

    try {
      await api.getCurrentThreadID();
    } catch (verifyErr) {
      const errMsg = verifyErr.message || JSON.stringify(verifyErr);
      if (errMsg.toLowerCase().includes('login_block')) {
        console.log('');
        console.log('[❌] CRITICAL: Account is LOGIN BLOCKED!');
        console.log('[💡] Commands will NOT be loaded - bot cannot work');
        console.log('[🔴] Please upload new cookies.txt and restart bot');
        console.log('');
        logs.error('LOGIN', 'Account LOGIN BLOCKED - bot cannot start');
        try {
          fs.unlinkSync(appstatePath);
        } catch (e) {}
        return;
      }
    }

    console.log('[✅] Login verified - loading commands and events...');

    try {
      const logsDir = path.join(__dirname, 'Data/system/database/botdata/logs');
      if (fs.existsSync(logsDir)) {
        fs.removeSync(logsDir);
        logs.info('LOGS', 'Old logs directory removed');
      }
    } catch (err) {
      logs.warn('CLEANUP', 'Could not clean old logs: ' + err.message);
    }

    const Users = new UsersController(api);
    const Threads = new ThreadsController(api);
    const Currencies = new CurrenciesController(api);

    global.Users = Users;
    global.Threads = Threads;
    global.Currencies = Currencies;

    try {
      await loadCommands(client, commandsPath);
      const cmdList = Array.from(client.commands.keys()).filter(k => !k.includes(' ')).sort();
      
    } catch (err) {
      logs.error('LOAD', 'Failed to load commands: ' + err.message);
    }

    try {
      await loadEvents(client, eventsPath);
      const evtList = Array.from(client.events.keys()).sort();
      
    } catch (err) {
      logs.error('LOAD', 'Failed to load events: ' + err.message);
    }

    global.client = client;

    setupSchedulers();

    const listener = listen({
      api,
      client,
      Users,
      Threads,
      Currencies,
      config
    });

    // Track this listener for cleanup
    mqttListeners.push(() => {
      try { api.removeAllListeners(); } catch(e) {}
    });
    
    api.listenMqtt(listener);

    try {
      const testInfo = await api.getUserInfo(api.getCurrentUserID());
      console.log('[✅] Bot API verified - bot is fully online and operational');
    } catch (testErr) {
      console.log('[❌] Bot API test failed - account may be logged out');
      console.log('[🔴] Bot will NOT respond to messages');
      logs.error('BOT', 'API verification failed - account may be logged out');
    }

    setTimeout(async () => {
      try {
        await api.getCurrentThreadID();
        console.log('[✅] Bot is fully operational and ready to receive messages');
      } catch (e) {
        const errMsg = e.message || JSON.stringify(e);
        if (errMsg.toLowerCase().includes('login_block')) {
          console.log('[❌] ALERT: Account is LOGIN BLOCKED! Bot cannot receive/send messages.');
          console.log('[💡] Solution: Upload new cookies.txt and restart bot');
          logs.error('BOT', 'Account LOGIN BLOCKED - bot not operational');
        }
      }
    }, 5000);

    const uniqueCommands = new Set();
    client.commands.forEach((cmd, key) => {
      if (cmd.config && cmd.config.name) {
        uniqueCommands.add(cmd.config.name.toLowerCase());
      }
    });
    const actualCommandCount = uniqueCommands.size;
    const actualEventCount = client.events.size;

    if (actualCommandCount === 0 && actualEventCount === 0) {
      console.log('[⚠️] No commands or events loaded - check command directory');
      logs.warn('BOT', 'No commands or events loaded');
    }

    logs.success('BOT', `${config.BOTNAME} is now online!`);
    logs.info('BOT', `Commands loaded: ${actualCommandCount}`);
    logs.info('BOT', `Events loaded: ${actualEventCount}`);

    const adminID = config.ADMINBOT[0];
    if (adminID) {
      setTimeout(async () => {
        try {
          await api.sendMessage(`${config.BOTNAME} is now online!
─────────────────
Commands: ${actualCommandCount}
Events: ${actualEventCount}
Prefix: ${config.PREFIX}
─────────────────
Type ${config.PREFIX}help for commands`, adminID);
        } catch (e) {
          logs.warn('NOTIFY', 'Could not send startup message to admin');
        }
      }, 5000);
    }

    setTimeout(() => {
      process.stderr.write = originalStderrWrite;
      process.stdout.write = originalStdoutWrite;
    }, 3000);
  });
}

process.on('unhandledRejection', (reason, promise) => {
  logs.warn('UNHANDLED', 'Unhandled Promise Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
  logs.error('EXCEPTION', 'Uncaught Exception:', error.message);
});

module.exports = {
  startBot,
  stopBot,
  getApi: () => api,
  setApi: (newApi) => { api = newApi; global.api = newApi; },
  getClient: () => client,
  getConfig: () => config,
  isBotRunning: () => isBotRunning,
  saveConfig,
  loadConfig,
  reloadCommands: () => loadCommands(client, commandsPath),
  reloadEvents: () => loadEvents(client, eventsPath)
};

if (require.main === module) {
  startBot();
}
