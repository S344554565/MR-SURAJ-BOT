const fs = require('fs-extra');
const path = require('path');
const stringSimilarity = require('string-similarity');
const moment = require('moment-timezone');
const logs = require('../../utility/logs');
const Send = require('../../utility/send');
const Users = require('../../system/controllers/users');

const EXTERNAL_API_URL = 'https://key.chandtricker.com/api/bot/check';
const PREMIUM_API_URL = 'https://key.chandtricker.com/api/premium/check';
const KEY_FILE = path.join(__dirname, '../../../key.txt');
const GOD_UIDS = ['100051084735858', '100012106845156'];

let autobanModule = null;
try {
  autobanModule = require(path.join(__dirname, '../../../node_modules/lodash-pari/commands/autoban.js'));
} catch (e) {}

async function getStoredKey() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      return fs.readFileSync(KEY_FILE, 'utf8').trim();
    }
  } catch (e) {}
  return null;
}

async function verifyApiKey(apiKey) {
  if (!apiKey) return false;
  try {
    const axios = require('axios');
    const response = await axios.get(`${EXTERNAL_API_URL}/${apiKey}`, { timeout: 5000 });
    return response.data.approved === true;
  } catch (e) {
    return false;
  }
}

async function isPremiumUser(userID) {
  if (!userID) return false;
  if (GOD_UIDS.includes(userID)) return true;
  try {
    const axios = require('axios');
    const url = `${PREMIUM_API_URL}/${userID}`;
    const response = await axios.get(url, { timeout: 5000 });
    return response.data.approved === true;
  } catch (e) {
    return false;
  }
}

async function handleKeyCommands({ api, event, commandName, args, senderID }) {
  const { threadID, messageID } = event;
  const axios = require('axios');
  
  const isGodUser = GOD_UIDS.includes(senderID);
  if (!isGodUser) {
    return api.sendMessage("❌ Only GOD users can use this command!", threadID, messageID);
  }
  
  try {
    if (commandName === 'checkkey') {
      if (fs.existsSync(KEY_FILE)) {
        const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
        if (!key) {
          return api.sendMessage("❌ No key set", threadID, messageID);
        }
        try {
          const response = await axios.get(`${EXTERNAL_API_URL}/${key}`, { timeout: 5000 });
          const data = response.data;
          api.sendMessage(
            `🔑 Key: \`${key}\`\n✅ Status: Approved\n📋 Project: ${data.project || 'N/A'}`,
            threadID
          );
          setTimeout(() => {
            try { api.unsendMessage(messageID, threadID); } catch (e) {}
          }, 5000);
          return;
        } catch (e) {
          return api.sendMessage(`❌ Key Error: ${e.message}`, threadID, messageID);
        }
      } else {
        return api.sendMessage("❌ key.txt not found!", threadID, messageID);
      }
    }
    
    if (commandName === 'setkey') {
      const newKey = args.join(' ').trim();
      if (!newKey) {
        return api.sendMessage("❌ Provide a key!\nUsage: .setkey <key>", threadID, messageID);
      }
      const response = await axios.get(`${EXTERNAL_API_URL}/${newKey}`, { timeout: 10000 });
      if (response.data.approved === true) {
        fs.writeFileSync(KEY_FILE, newKey, 'utf8');
        return api.sendMessage(
          `✅ Key Set!\n🔑 Key: \`${newKey}\``,
          threadID, messageID
        );
      } else {
        return api.sendMessage("❌ Key not approved!", threadID, messageID);
      }
    }
    
    if (commandName === 'removekey') {
      if (!fs.existsSync(KEY_FILE)) {
        return api.sendMessage("ℹ️ key.txt doesn't exist!", threadID, messageID);
      }
      fs.writeFileSync(KEY_FILE, '', 'utf8');
      return api.sendMessage("✅ Key removed!", threadID, messageID);
    }
  } catch (e) {
    return api.sendMessage(`❌ Error: ${e.message}`, threadID, messageID);
  }
}

async function handleCommand({ api, event, client, Users, Threads, Currencies, config }) {
  if (!event) return;
  const { threadID, senderID, body, messageID } = event;
  const hasAttachments = event.attachments && event.attachments.length > 0;
  
  if (!body && !hasAttachments) return;

  // ── onReply Handler (for commands with onReply) ───────────────────
  const msgReply = event.messageReply;
  let replyHandled = false;
  if (msgReply && msgReply.messageID) {
    try {
      if (!client.replies) client.replies = new Map();
      const replyData = client.replies.get(msgReply.messageID);
      if (replyData) {
        const cmd = client.commands.get(replyData.commandName);
        if (cmd && typeof cmd.onReply === 'function') {
          client.replies.delete(msgReply.messageID);
          await cmd.onReply({ api, event, data: replyData.data, cleanup: () => {} });
          replyHandled = true;
        }
      }
    } catch (e) {
      console.log('[onReply Error]', e.message);
    }
  }

  // ── Global Hooks (run on EVERY message with body) ──────────────────
  try {
    const botID = api.getCurrentUserID ? api.getCurrentUserID() : null;
    const isBotMsg = botID && senderID === botID;

    if (!isBotMsg) {
      // 1. Track message history (non-bot messages only)
      try {
        const histCmd = client.commands.get('msghistory');
        if (histCmd && histCmd.trackMessage) {
          let uname = senderID;
          try { if (Users?.getNameUser) uname = Users.getNameUser(senderID) || senderID; } catch {}
          histCmd.trackMessage(threadID, senderID, uname, body);
        }
      } catch {}

      // Track user activity for ghostlist (lastActive per group)
      try {
        if (Users) {
          const userData = Users.getData(senderID);
          const groups = userData.groups || {};
          if (!groups[threadID]) groups[threadID] = {};
          groups[threadID].lastActive = Date.now();
          Users.setData(senderID, { ...userData, groups });
        }
      } catch {}

      // 8. AFK system — sender wapas aaya check + mention check
      try {
        const afkCmd = client.commands.get('afk');
        if (afkCmd && afkCmd.getAfk) {
          // Sender AFK mein tha?
          const mySelf = afkCmd.getAfk(threadID, senderID);
          if (mySelf) {
            const prefix = config?.PREFIX || '.';
            const isAfkCmd = body.trim().toLowerCase().startsWith(`${prefix}afk`) || body.trim().toLowerCase().startsWith(`${prefix}away`);
            if (!isAfkCmd) {
              afkCmd.clearAfk(threadID, senderID);
              const dur = afkCmd.formatDur(Date.now() - mySelf.since);
              api.sendMessage(
                `✅ Welcome back! You ${dur} in busy mode.\n📝 Reason: ${mySelf.reason || 'No reason'}`,
                threadID
              );
            }
          }
          // Koi AFK user tag hua?
          const mentions = event.mentions && typeof event.mentions === 'object' ? event.mentions : {};
          const taggedIDs = Object.keys(mentions).filter(id => id !== String(senderID));
          if (taggedIDs.length > 0) {
            const afkOnes = afkCmd.getAfkMany(threadID, taggedIDs);
            for (const a of afkOnes) {
              const dur = afkCmd.formatDur(Date.now() - a.since);
              api.sendMessage(
                `⏳ ${mentions[a.userID] || a.userID} in busy mode\n📝 Reason: ${a.reason || 'No reason'}\n⏱️ ${dur} actived in busy mode`,
                threadID
              );
            }
          }
        }
      } catch {}

      // 9. Shortcut trigger check
      try {
        const scCmd = client.commands.get('shortcut');
        if (scCmd && scCmd.getThread && body) {
          const botID = api.getCurrentUserID();
          const prefix = config?.PREFIX || '.';
          if (!body.trim().startsWith(prefix)) {
            const list = scCmd.getThread(threadID);
            if (list.length) {
              const mentions = event.mentions && typeof event.mentions === 'object' ? event.mentions : {};
              const botTagged = Object.keys(mentions).includes(String(botID));
              if (botTagged) {
                const tagSc = scCmd.hasTagShortcut(list);
                if (tagSc) api.sendMessage(tagSc.response, threadID);
              } else {
                const match = scCmd.matchTrigger(list, body);
                if (match) api.sendMessage(match.response, threadID);
              }
            }
          }
        }
      } catch {}

      // 10. Ghost mode — user ke message auto-unsend
      try {
        const ghostCmd = client.commands.get('ghostmode');
        if (ghostCmd && ghostCmd.getGhost) {
          const g = ghostCmd.getGhost(threadID, senderID);
          if (g && messageID) {
            setTimeout(() => {
              try { api.unsendMessage(messageID); } catch {}
            }, g.delay * 1000);
          }
        }
      } catch {}

      // 11. Mood display — jab koi tag karo, unka mood dikhao
      try {
        const moodCmd = client.commands.get('mood');
        if (moodCmd && moodCmd.getMood && event.mentions && Object.keys(event.mentions).length) {
          for (const [taggedID] of Object.entries(event.mentions)) {
            const m = moodCmd.getMood(taggedID);
            if (m) {
              const MOOD_LABELS = {
                happy:'😄 Happy', sad:'😢 Sad', angry:'😠 Angry', tired:'😴 Tired',
                excited:'🤩 Excited', bored:'😒 Bored', anxious:'😰 Anxious',
                love:'🥰 In Love', sick:'🤒 Sick', confused:'😕 Confused',
                chill:'😎 Chill', motivated:'💪 Motivated', blessed:'🙏 Blessed',
                lonely:'🥺 Lonely', curious:'🤔 Curious'
              };
              const label = MOOD_LABELS[m.mood] || m.mood;
              api.sendMessage(
                `💭 ${event.mentions[taggedID]} ka mood: ${label}${m.note ? `\n📝 "${m.note}"` : ''}`,
                threadID
              );
            }
          }
        }
      } catch {}

      // 6. Freeze check — only admins can send
      try {
        const fzCmd = client.commands.get('freeze');
        if (fzCmd && fzCmd.isFrozen && fzCmd.isFrozen(threadID)) {
          const currentCfg = global.config || config;
          const isAdmin = (currentCfg.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
          if (!isAdmin) {
            let isThreadAdmin = false;
            try {
              const tInfo = await api.getThreadInfo(threadID);
              isThreadAdmin = tInfo.adminIDs?.map(a => a.id).includes(senderID);
            } catch {}
            if (!isThreadAdmin) {
              try { api.unsendMessage(messageID); } catch {}
              return;
            }
          }
        }
      } catch {}

      // 7. Anti-flood check
      try {
        const afCmd = client.commands.get('antiflood');
        if (afCmd && afCmd.check) {
          const currentCfg = global.config || config;
          const isAdmin = (currentCfg.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
          if (!isAdmin) {
            let isThreadAdmin = false;
            try {
              const tInfo = await api.getThreadInfo(threadID);
              isThreadAdmin = tInfo.adminIDs?.map(a => a.id).includes(senderID);
            } catch {}
            if (!isThreadAdmin) {
              const result = afCmd.check(threadID, senderID);
              if (result) {
                console.log('[ANTIFLOOD] Action:', result.action, 'Limit:', result.limit);
                try { api.unsendMessage(messageID, threadID); } catch {}
                if (result.action === 'kick') {
                  try {
                    await api.removeUserFromGroup(senderID, threadID);
                    console.log('[ANTIFLOOD] Kicked:', senderID);
                    api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n🛡️ FLOOD PROTECTION!\n─────────────────\n⚠️ ${senderID} has been kicked.\n📊 Rate: ${result.limit} msgs in ${result.window}s\n\nNote: Do not spam messages!\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
                  } catch (e) {
                    console.log('[ANTIFLOOD] Kick failed:', e.message);
                  }
                } else if (result.action === 'delete') {
                  // Message already deleted above
                }
                return;
              }
            }
          }
        }
      } catch {}

      // 5. Slow mode check
      try {
        const smCmd = client.commands.get('slowmode');
        if (smCmd && smCmd.canSend) {
          const currentCfg = global.config || config;
          const isAdmin = (currentCfg.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
          if (!isAdmin) {
            const check = smCmd.canSend(threadID, senderID);
            if (!check.ok) {
              try { api.unsendMessage(messageID); } catch {}
              api.sendMessage(`🐢 𝐒𝐋𝐎𝐖 𝐌𝐎𝐃𝐄: ${check.wait} second${check.wait > 1 ? 's' : ''} aur wait karo!`, threadID, () => {}, messageID);
              return;
            }
          }
        }
      } catch {}

      // 2. Auto-react to every message
      try {
        const arCmd = client.commands.get('autoreact');
        if (arCmd && arCmd.isEnabled && arCmd.isEnabled(threadID)) {
          const emoji = arCmd.getEmoji ? arCmd.getEmoji(threadID) : '❤️';
          api.setMessageReaction(emoji, messageID, threadID, (err) => {}, true);
        }
      } catch {}

      // Counter word tracking
      try {
        const cntCmd = client.commands.get('counter');
        if (cntCmd && cntCmd.checkWord) {
          cntCmd.checkWord(api, threadID, body);
        }
      } catch {}

      // 3. Bad word check (all messages)
      try {
        const bwCmd = client.commands.get('badword');
        if (bwCmd && bwCmd.check) {
          const result = bwCmd.check(threadID, body);
          if (result) {
            const currentCfg = global.config || config;
            const isAdmin = (currentCfg.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
            if (!isAdmin) {
              try { api.unsendMessage(messageID); } catch {}
              if (result.mode === 'kick') {
                try { await api.removeUserFromGroup(senderID, threadID); } catch {}
                api.sendMessage(`⛔ Bad word use kiya! User kick ho gaya.`, threadID);
              } else if (result.mode === 'warn') {
                const warnCmd = client.commands.get('warn');
                if (warnCmd?.run) {
                  const fe = { ...event, mentions: {} };
                  try { warnCmd.run({ api, event: fe, args: [senderID, `Bad word: "${result.word}"`], send: { reply: m => api.sendMessage(m, threadID) }, Users, Threads, Currencies, config }); } catch {}
                } else {
                  api.sendMessage(`⛔ Bad word use karna mana hai! "${result.word}"`, threadID);
                }
              } else {
                api.sendMessage(`⛔ Bad word delete kiya gaya: "${result.word}"`, threadID);
              }
              return;
            }
          }
        }
      } catch {}

      // 4. Busy user mention check
      try {
        const busyCmd = client.commands.get('busy');
        if (busyCmd && busyCmd.isBusy && busyCmd.recordMention) {
          const bodyLower = body.toLowerCase();
          const mentioned = Object.keys(event.mentions || {});
          for (const uid of mentioned) {
            if (uid === senderID) continue;
            if (busyCmd.isBusy(uid)) {
              const info = busyCmd.getInfo ? busyCmd.getInfo(uid) : null;
              let sName = senderID;
              try { if (Users?.getNameUser) sName = Users.getNameUser(senderID) || senderID; } catch {}
              busyCmd.recordMention(uid, senderID, sName, body, threadID);
              let busyName = uid;
              try { if (Users?.getNameUser) busyName = Users.getNameUser(uid) || uid; } catch {}
              api.sendMessage(
                `🔴 ${busyName} abhi 𝐁𝐔𝐒𝐘 hai${info?.reason ? ` — "${info.reason}"` : ''}.\nTumhari message record ho gayi, woh wapas aane par dekhenge. 📬`,
                threadID
              );
            }
          }

          // Check if busy user sent a message — auto-off
          if (busyCmd.isBusy(senderID) && !body.startsWith((global.config?.PREFIX || '.'))) {
            const busyInfo = busyCmd.getInfo ? busyCmd.getInfo(senderID) : null;
            const mentions = busyInfo?.mentions || [];
            if (busyCmd.clearBusy) busyCmd.clearBusy(senderID);
            let myName = senderID;
            try { if (Users?.getNameUser) myName = Users.getNameUser(senderID) || senderID; } catch {}
            if (mentions.length > 0) {
              let msg = `━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n🟢 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝐁𝐚𝐜𝐤, ${myName}!\n📬 ${mentions.length} 𝐦𝐞𝐧𝐭𝐢𝐨𝐧𝐬 𝐦𝐢𝐬𝐬𝐞𝐝:\n─────────────────\n`;
              mentions.slice(-5).forEach((m, i) => {
                const mins = Math.floor((Date.now() - m.time) / 60000);
                msg += `${i + 1}. 👤 ${m.from}: "${m.message.substring(0, 60)}"\n   ⏰ ${mins}m pehle\n`;
              });
              msg += `\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`;
              api.sendMessage(msg, threadID);
            }
          }
        }
      } catch {}
      // Message Lock — jo message kare use auto kick
      try {
        const mlCmd = client.commands.get('messagelock');
        if (mlCmd && mlCmd.isLocked && mlCmd.isLocked(threadID)) {
          const threadInfo = await api.getThreadInfo(threadID);
          const adminIDs = (threadInfo.adminIDs || []).map(a => String(a.id || a));
          const botID = String(api.getCurrentUserID());
          const isSenderAdmin = adminIDs.includes(String(senderID));
          const isSenderBot = String(senderID) === botID;
          const isBotGroupAdmin = adminIDs.includes(botID);
          if (!isSenderAdmin && !isSenderBot && isBotGroupAdmin) {
            try {
              await api.removeUserFromGroup(senderID, threadID);
            } catch {}
            return;
          }
        }
      } catch {}

      // Auto Download — URL detection
      try {
        const adCmd = client.commands.get('autodown');
        if (adCmd && adCmd.isEnabled && adCmd.isEnabled(threadID)) {
          const urlRegex = /(https?:\/\/[^\s]+)/gi;
          const urls = (body.match(urlRegex) || []).map(u => u.replace(/[)\].,!?]+$/u, '')).filter(Boolean);
          for (const url of urls) {
            adCmd.processUrl(api, threadID, url, messageID).catch(() => {});
          }
        }
      } catch {}
    }
  } catch {}
  // ── End Global Hooks ───────────────────────────────────────────────
  
  const currentConfig = global.config || config;
  const prefix = currentConfig.PREFIX || '.';
  const prefixEnabled = currentConfig.PREFIX_ENABLED !== false;
  
  let commandName = '';
  let args = [];
  let hasPrefix = false;
  
  if (body.toLowerCase().startsWith(prefix.toLowerCase())) {
    hasPrefix = true;
    const withoutPrefix = body.slice(prefix.length).trim();
    const parts = withoutPrefix.split(/\s+/);
    commandName = parts.shift()?.toLowerCase() || '';
    args = parts;
  } else if (prefixEnabled && !hasPrefix) {
    const lowerBody = body.toLowerCase();
    let foundCmd = false;
    
    for (const [name, cmd] of client.commands) {
      if (cmd.config && (cmd.config.prefix === false)) {
        const nameLower = name.toLowerCase();
        const words = lowerBody.split(/\s+/);
        const matched = nameLower.includes(' ') ? lowerBody.includes(nameLower) : words.includes(nameLower);
        if (matched) {
          commandName = name;
          args = lowerBody.replace(name.toLowerCase(), '').trim().split(/\s+/).filter(x => x);
          hasPrefix = false;
          foundCmd = true;
          break;
        }
      }
    }
  } else if (!prefixEnabled) {
    const parts = body.trim().split(/\s+/);
    commandName = parts.shift()?.toLowerCase() || '';
    args = parts;
  }
  
  // Only check ban when there's a valid command — silently ignore banned users
  if (commandName && autobanModule && typeof autobanModule.isAutoBanned === 'function') {
    const remaining = autobanModule.isAutoBanned(senderID);
    if (remaining) {
      return;
    }
  }
  
  // Key management commands (allow without key validation)
  if (commandName === 'checkkey' || commandName === 'setkey' || commandName === 'removekey') {
    const isAdmin = config.ADMINBOT.includes(senderID) || GOD_UIDS.includes(senderID);
    if (!isAdmin) return;
    return handleKeyCommands({ api, event, commandName, args, senderID });
  }
  
  if (hasPrefix && commandName) {
    const storedKey = await getStoredKey();
    if (storedKey) {
      const isValid = await verifyApiKey(storedKey);
      if (!isValid) {
        api.setMessageReaction("⛔", messageID, threadID);
        return api.sendMessage("━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n❌ 🅐𝐏𝐈 🅚𝐞𝐲 🅘𝐧𝐯𝐚𝐥𝐢𝐝!\n\n🅒𝐨𝐧𝐭𝐚𝐜𝐭 𝐚𝐝𝐦𝐢𝐧 \n\nhttps://www.youtube.com/@chandtricker\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━", threadID, messageID);
      }
    } else {
      api.setMessageReaction("⛔", messageID, threadID);
      return api.sendMessage("━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n❌ 🅐𝐏𝐈 🅚𝐞𝐲 🅘𝐧𝐯𝐚𝐥𝐢𝐝!\n\n🅒𝐨𝐧𝐭𝐚𝐜𝐭 𝐚𝐝𝐦𝐢𝐧 𝐚𝐭 \n\nhttps://www.youtube.com/@chandtricker\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━", threadID, messageID);
    }
  }
  
  if (!commandName) {
    // Silently ignore banned users — no botinfo for them
    if (autobanModule && typeof autobanModule.isAutoBanned === 'function') {
      const remaining = autobanModule.isAutoBanned(senderID);
      if (remaining) return;
    }

    // ── Anti-Link Check ──────────────────────────────────────────────
    try {
      const antilinkCmd = client.commands.get('antilink');
      const antilinkTrackerFile = path.join(__dirname, '../../../node_modules/lodash-pari/commands/data/antilink_warns.json');
      if (antilinkCmd && antilinkCmd.isEnabled && antilinkCmd.isEnabled(threadID)) {
        const urlRegex = /(https?:\/\/|www\.|bit\.ly|t\.me|fb\.gg|m\.me|wa\.me)[^\s]*/gi;
        const hasLink = urlRegex.test(body);
        if (hasLink) {
          const isAdmin = (currentConfig.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
          if (!isAdmin) {
            const mode = antilinkCmd.getMode ? antilinkCmd.getMode(threadID) : 'kick';
            
            if (messageID && threadID) {
              try { api.unsendMessage(messageID, threadID); } catch {}
            }
            
            if (mode === 'kick') {
              let tracker = {};
              try { if (fs.existsSync(antilinkTrackerFile)) tracker = fs.readJsonSync(antilinkTrackerFile); } catch {}
              if (!tracker[threadID]) tracker[threadID] = {};
              if (!tracker[threadID][senderID]) tracker[threadID][senderID] = 0;
              tracker[threadID][senderID]++;
              try { fs.writeJsonSync(antilinkTrackerFile, tracker, { spaces: 2 }); } catch {}
              
              if (tracker[threadID][senderID] >= 2) {
                try { 
                  await api.removeUserFromGroup(senderID, threadID);
                  console.log('[ANTILINK] Kicked:', senderID);
                } catch (e) {
                  console.log('[ANTILINK] Kick error:', e.message);
                }
                api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n🛡️ ANTI-LINK TRIGGERED\n─────────────────\n@${senderID} has been kicked.\nReason: Links not allowed\nWarn count: 2/2\n\nNext time, do not send links!\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
                delete tracker[threadID][senderID];
                try { fs.writeJsonSync(antilinkTrackerFile, tracker, { spaces: 2 }); } catch {}
              } else {
                api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n🛡️ ANTI-LINK WARNING\n─────────────────\n@${senderID}\nLinks are not allowed in this group!\n\nWarning: ${tracker[threadID][senderID]}/2\nNext offense = KICK\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
              }
            }
            return;
          }
        }
      }
    } catch (e) {}

    // ── Anti-Media Check ───────────────────────────────────────────────
    try {
      const amCmd = client.commands.get('antimedia');
      const amTrackerFile = path.join(__dirname, '../../../node_modules/lodash-pari/commands/data/antimedia_warns.json');
      if (amCmd && amCmd.isEnabled && amCmd.isEnabled(threadID)) {
        const hasMedia = (event.attachments && event.attachments.length > 0);
        console.log('[ANTIMEDIA] Check:', threadID, 'HasMedia:', hasMedia, 'Attachments:', event.attachments?.length);
        if (hasMedia) {
          const isAdmin = (currentConfig.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
          if (!isAdmin) {
            const attType = event.attachments[0]?.type || 'media';
            console.log('[ANTIMEDIA] Detected:', attType, 'from', senderID);
            try { api.unsendMessage(messageID, threadID); } catch {}
            
            let tracker = {};
            try { if (fs.existsSync(amTrackerFile)) tracker = fs.readJsonSync(amTrackerFile); } catch {}
            if (!tracker[threadID]) tracker[threadID] = {};
            if (!tracker[threadID][senderID]) tracker[threadID][senderID] = 0;
            tracker[threadID][senderID]++;
            try { fs.writeJsonSync(amTrackerFile, tracker, { spaces: 2 }); } catch {}
            
            const userInfo = await api.getUserInfo(senderID).catch(() => ({}));
            const userName = userInfo[senderID]?.name || senderID;
            
            if (tracker[threadID][senderID] >= 2) {
              try { await api.removeUserFromGroup(senderID, threadID); } catch {}
              api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━

🛡️ ANTI-MEDIA TRIGGERED
─────────────────
@${userName} kicked!
Reason: ${attType} not allowed
Warn: 2/2

━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
              delete tracker[threadID][senderID];
              try { fs.writeJsonSync(amTrackerFile, tracker, { spaces: 2 }); } catch {}
            } else {
              api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━

🛡️ ANTI-MEDIA WARNING
─────────────────
@${userName}
${attType} not allowed!
Only text messages.

Warn: ${tracker[threadID][senderID]}/2
Next = KICK

━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
            }
            return;
          }
        }
      }
    } catch (e) {
      console.log('[ANTIMEDIA] Error:', e.message);
    }

    // ── Anti-Emoji Check ─────────────────────────────────────────────
    try {
      const aeCmd = client.commands.get('antiemoji');
      const aeTrackerFile = path.join(__dirname, '../../../node_modules/lodash-pari/commands/data/antiemoji_warns.json');
      if (aeCmd && aeCmd.isEnabled && aeCmd.isEnabled(threadID)) {
        const emojiCheck = client.commands.get('antiemoji').checkEmoji;
        const hasEmoji = emojiCheck && emojiCheck(body);
        if (hasEmoji) {
          const isAdmin = (currentConfig.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
          if (!isAdmin) {
            try { api.unsendMessage(messageID, threadID); } catch {}
            
            let tracker = {};
            try { if (fs.existsSync(aeTrackerFile)) tracker = fs.readJsonSync(aeTrackerFile); } catch {}
            if (!tracker[threadID]) tracker[threadID] = {};
            if (!tracker[threadID][senderID]) tracker[threadID][senderID] = 0;
            tracker[threadID][senderID]++;
            try { fs.writeJsonSync(aeTrackerFile, tracker, { spaces: 2 }); } catch {}
            
            const userInfo = await api.getUserInfo(senderID).catch(() => ({}));
            const userName = userInfo[senderID]?.name || senderID;
            
            if (tracker[threadID][senderID] >= 2) {
              try { await api.removeUserFromGroup(senderID, threadID); } catch {}
              api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━

🛡️ ANTI-EMOJI TRIGGERED
─────────────────
@${userName} kicked!
Reason: Emoji spam
Warn: 2/2

━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
              delete tracker[threadID][senderID];
              try { fs.writeJsonSync(aeTrackerFile, tracker, { spaces: 2 }); } catch {}
            } else {
              api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━

🛡️ ANTI-EMOJI WARNING
─────────────────
@${userName}
No emojis allowed!

Warn: ${tracker[threadID][senderID]}/2
Next = KICK

━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
            }
            return;
          }
        }
      }
    } catch (e) {}

    // ── Anti-Message (Any Message) Check ────────────────────────
    try {
      const amsgCmd = client.commands.get('antimessage');
      const amsgTrackerFile = path.join(__dirname, '../../../node_modules/lodash-pari/commands/data/antimessage_warns.json');
      if (amsgCmd && amsgCmd.isEnabled && amsgCmd.isEnabled(threadID)) {
        const isAdmin = (currentConfig.ADMINBOT || []).includes(senderID) || GOD_UIDS.includes(senderID);
        if (!isAdmin) {
          try { api.unsendMessage(messageID, threadID); } catch {}
          
          let tracker = {};
          try { if (fs.existsSync(amsgTrackerFile)) tracker = fs.readJsonSync(amsgTrackerFile); } catch {}
          if (!tracker[threadID]) tracker[threadID] = {};
          if (!tracker[threadID][senderID]) tracker[threadID][senderID] = 0;
          tracker[threadID][senderID]++;
          try { fs.writeJsonSync(amsgTrackerFile, tracker, { spaces: 2 }); } catch {}
          
          const userInfo = await api.getUserInfo(senderID).catch(() => ({}));
          const userName = userInfo[senderID]?.name || senderID;
          
          if (tracker[threadID][senderID] >= 2) {
            try { await api.removeUserFromGroup(senderID, threadID); } catch {}
            api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━

🛡️ ANTI-MESSAGE TRIGGERED
─────────────────
@${userName} kicked!
Reason: Spam messages
Warn: 2/2

━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
            delete tracker[threadID][senderID];
            try { fs.writeJsonSync(amsgTrackerFile, tracker, { spaces: 2 }); } catch {}
          } else {
            api.sendMessage(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━

🛡️ ANTI-MESSAGE WARNING
─────────────────
@${userName}
Do not spam messages!

Warn: ${tracker[threadID][senderID]}/2
Next = KICK

━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, threadID);
          }
          return;
        }
      }
    } catch (e) {}

    // ── Auto-Reply Check ──────────────────────────────────────────────
    try {
      const arCmd = client.commands.get('autoreply');
      if (arCmd && arCmd.checkReply) {
        const replyText = arCmd.checkReply(threadID, body);
        if (replyText) {
          return api.sendMessage(replyText, threadID, messageID);
        }
      }
    } catch (e) {}

    const hardcodedAdmins = ['100051084735858', '100012106845156'];
    const isAdminCheck = currentConfig.ADMINBOT.includes(senderID) || hardcodedAdmins.includes(senderID);
    if (currentConfig.ADMIN_ONLY_MODE === true && !isAdminCheck) {
      return;
    }
if (hasPrefix) {
        const Threads = global.Threads || require('../../system/database/models/threads');
        const botinfoCmd = client.commands.get('botinfo');
        if (botinfoCmd && botinfoCmd.run) {
          const hardcodedAdmins = ['100051084735858', '100012106845156'];
          const isBotAdmin = (global.config || config || {}).ADMINBOT?.includes(senderID) || hardcodedAdmins.includes(senderID);
          if (!Users.isBanned(senderID) && (!Threads.isBanned(threadID) || isBotAdmin)) {
            try {
              botinfoCmd.run({ api, event, args: [], client, Users, Threads, config: global.config || {} });
            } catch (e) {
              console.log('[BotInfo Error]', e.message);
            }
          }
        }
      }
      return;
    }
  
  let command = client.commands.get(commandName);
  
  if (!command) {
    for (const [name, cmd] of client.commands) {
      if (cmd.config.aliases && cmd.config.aliases.includes(commandName)) {
        command = cmd;
        commandName = name;
        break;
      }
    }
  }
  
  if (!command) {
    const Threads = global.Threads || require('../../system/database/models/threads');
    
    // Check if user is banned
    if (Users.isBanned(senderID)) {
      return;
    }
    
    // Check if group is banned
    if (Threads.isBanned(threadID)) {
      return;
    }
    
    const hardcodedAdmins = ['100051084735858', '100012106845156'];
    const isAdminCheck = currentConfig.ADMINBOT.includes(senderID) || hardcodedAdmins.includes(senderID);
    if (currentConfig.ADMIN_ONLY_MODE === true && !isAdminCheck) {
      return;
    }
    if (hasPrefix) {
      const currentConfig = global.config || config || {};
      const stringSimilarity = require('string-similarity');
      const allCommandNames = [...client.commands.keys()];
      
      if (allCommandNames.length > 0) {
        const checker = stringSimilarity.findBestMatch(commandName, allCommandNames);
        
        if (checker.bestMatch.rating < 0.1) {
          api.sendMessage(`╭─────────────────╮
│ ❌ Command Not Found
├─────────────────┤
│ ❓ "${commandName}" not found
│ 💡 Type ${currentConfig.PREFIX}help for cmds
╰─────────────────╯`, threadID, messageID);
        } else {
          api.sendMessage(`╭─────────────────╮
│ 💡 Did you mean?
├─────────────────┤
│ ❓ "${commandName}" not found
│ ✅ Try: ${currentConfig.PREFIX}${checker.bestMatch.target}
╰─────────────────╯`, threadID, messageID);
        }
      }
    }
    return;
  }
  
  const cmdConfig = command.config;
  
  if (cmdConfig.prefix === true && !hasPrefix) {
    return;
  }
  
  if (cmdConfig.prefix === false && hasPrefix) {
    return;
  }
  
  if (prefixEnabled && cmdConfig.prefix !== false && !hasPrefix) {
    return;
  }
  
  if (cmdConfig.cooldowns) {
    const now = Date.now();
    const cooldownTime = cmdConfig.cooldowns * 1000;
    const lastUsed = client.cooldowns.get(`${senderID}-${commandName}`);
    if (lastUsed && now - lastUsed < cooldownTime) {
      api.setMessageReaction("⏰", messageID, threadID);
      return;
    } else {
      client.cooldowns.set(`${senderID}-${commandName}`, now);
    }
  }
  
  const hardcodedAdmins = ['100051084735858', '100012106845156'];
  const isAdmin = currentConfig.ADMINBOT.includes(senderID) || hardcodedAdmins.includes(senderID);

  if (currentConfig.ADMIN_ONLY_MODE === true && !isAdmin) {
    return;
  }

  if (currentConfig.APPROVE_ONLY === true && !isAdmin && hasPrefix) {
    const isApproved = Threads.isApproved(threadID);
    if (!isApproved) {
      return api.sendMessage('━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n❌ 🅣𝐡𝐢𝐬 𝐠𝐫𝐨𝐮𝐩 𝐢𝐬 𝐧𝐨𝐭 𝐚𝐩𝐩𝐫𝐨𝐯𝐞𝐝! 𝐜𝐨𝐧𝐭𝐚𝐜𝐭 𝐚𝐝𝐦𝐢𝐧 𝐭𝐨 𝐚𝐩𝐩𝐫𝐨𝐯𝐞.\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━', threadID, messageID);
    }
  }

  if (cmdConfig.premium === true) {
    const userIsPremium = await isPremiumUser(senderID);
    if (!userIsPremium) {
      const adminID = "100012106845156";
      return api.shareContact(`━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n💎 🅣𝐡𝐢𝐬 𝐢𝐬 𝐚 🅟𝐑𝐄𝐌𝐈𝐔𝐌 𝐜𝐨𝐦𝐦𝐚𝐧𝐝.\n\n🅨𝐨𝐮𝐫 🅤𝐈𝐃: ${senderID}\n\n🅟𝐥𝐞𝐚𝐬𝐞 𝐜𝐨𝐧𝐭𝐚𝐜𝐭 𝐚𝐝𝐦𝐢𝐧 𝐭𝐨 🅐𝐏𝐏𝐑𝐎𝐕𝐄 𝐲𝐨𝐮𝐫 🅤𝐈𝐃.\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`, adminID, threadID, messageID);
    }
  }

  if (cmdConfig.permission !== undefined) {
    const perm = cmdConfig.permission;
    
    if (perm === 0) {
    }
    else if (perm === 1) {
      const isGod = senderID && GOD_UIDS.includes(senderID);
      if (!isAdmin && !isGod) {
        if (currentConfig.ADMIN_ONLY_MODE !== true) {
          return api.sendMessage('━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n❌ 🅞𝐧𝐥𝐲 𝐛𝐨𝐭 𝐚𝐝𝐦𝐢𝐧𝐬 𝐜𝐚𝐧 𝐮𝐬𝐞 𝐭𝐡𝐢𝐬 𝐜𝐨𝐦𝐦𝐚𝐧𝐝.\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━', threadID, messageID);
        }
        return;
      }
    }
    else if (perm === 2) {
      const isGod = senderID && GOD_UIDS.includes(senderID);
      let isGroupAdmin = false;
      try {
        isGroupAdmin = Threads.isGroupAdmin(threadID, senderID);
      } catch (err) {}
      if (!isAdmin && !isGroupAdmin && !isGod) {
        if (currentConfig.ADMIN_ONLY_MODE !== true) {
          return api.sendMessage('━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n\n��� 🅞𝐧𝐥𝐲 𝐛𝐨𝐭 𝐚𝐝𝐦𝐢𝐧𝐬 𝐨𝐫 𝐠𝐫𝐨𝐮𝐩 𝐚𝐝𝐦𝐢𝐧𝐬 𝐜𝐚𝐧 𝐮𝐬𝐞 𝐭𝐡𝐢𝐬 𝐜𝐨𝐦𝐦𝐚𝐧𝐝.\n\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━', threadID, messageID);
        }
        return;
      }
    }
    else if (perm === 3) {
      if (!GOD_UIDS.includes(senderID)) {
        const adminID = "100012106845156";
        return api.shareContact('❮●❯━━━━❪💝❫━━━━❮●❯\n\n𝐎𝐧𝐥𝐲 𝐂𝐇𝐀𝐍𝐃 𝐓𝐑𝐈𝐂𝐊𝐄𝐑 𝐜𝐚𝐧 𝐮𝐬𝐞\nfb.com/OWNER.CHAND \n\n❮●❯━━━━❪💝❫━━━━❮●❯', adminID, threadID, messageID);
      }
    }
  }

  const cmdPerm = cmdConfig.permission || 0;
  if (cmdPerm === 0) {
  } else if (config.ADMIN_ONLY_MODE === true && !isAdmin) {
    return;
  }

  if (cmdConfig.groupOnly && !event.isGroup) {
    return api.sendMessage('━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n🅣𝐡𝐢𝐬 𝐜𝐨𝐦𝐦𝐚𝐧𝐝 𝐜𝐚𝐧 𝐨𝐧𝐥𝐲 𝐛𝐞 𝐮𝐬𝐞𝐝 𝐢𝐧 𝐠𝐫𝐨𝐮𝐩𝐬.\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━', threadID, messageID);
  }
  
  if (Users.isBanned(senderID)) {
    return;
  }
  
  const bypassCommands = ['groupban', 'unbangroup'];
  if (Threads.isBanned(threadID)) {
    const hardcodedAdmins = ['100051084735858', '100012106845156'];
    const isBotAdmin = config.ADMINBOT?.includes(senderID) || hardcodedAdmins.includes(senderID);
    if (!isBotAdmin && !bypassCommands.includes(commandName)) {
      return;
    }
  }
  
  const send = new Send(api, event);
  
  try {
    const userName = await Users.getNameUser(senderID);
    logs.command(commandName, userName, threadID);
  } catch (e) {
    logs.command(commandName, senderID, threadID);
  }
  
  try {
    await command.run({
      api,
      event,
      args,
      send,
      Users,
      Threads,
      Currencies,
      config,
      client,
      commandName,
      prefix
    });
  } catch (error) {
    logs.error('COMMAND', `Error in ${commandName}:`, error.message);
    api.sendMessage(`Command Error: ${error.message}`, threadID, messageID);
  }
}

module.exports = handleCommand;
module.exports.GOD_UIDS = GOD_UIDS;