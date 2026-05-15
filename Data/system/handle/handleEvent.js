const logs = require('../../utility/logs');
const Send = require('../../utility/send');
const fs = require('fs-extra');
const path = require('path');

async function handleEvent({ api, event, client, Users, Threads, config }) {
  const { threadID, logMessageType, logMessageData, logMessageBody } = event;
  
  if (!logMessageType) return;
  
  logs.event(logMessageType, threadID);
  
  // ── Auto Update Users & Threads Database ───────────────────────────
  try {
    // User JOIN - Create/Update user in database
    if (logMessageType === 'log:subscribe') {
      const added = logMessageData?.addedParticipants || [];
      for (const participant of added) {
        const uid = String(participant.userFbId);
        const name = participant.fullName || 'Unknown';
        
        // Create or update user in database
        const existingUser = Users.get(uid);
        if (!existingUser) {
          Users.create(uid, name);
        } else if (existingUser.name !== name) {
          Users.setName(uid, name);
        }
        
        // Update user's group list and lastActive
        const userData = Users.getData(uid);
        const groups = userData.groups || {};
        if (!groups[String(threadID)]) {
          groups[String(threadID)] = { joinedAt: Date.now() };
        }
        groups[String(threadID)].lastActive = Date.now();
        Users.setData(uid, { ...userData, groups });
      }
      
      // Update thread member count
      try {
        const tInfo = await api.getThreadInfo(threadID);
        const existingThread = Threads.get(threadID);
        if (!existingThread) {
          Threads.create(threadID, tInfo.threadName || 'Unknown Group');
        }
        Threads.update(threadID, { 
          members: tInfo.participantIDs?.length || 0,
          name: tInfo.threadName || existingThread?.name || 'Unknown Group'
        });
        
        // Auto sync all members to database (slowly)
        const memberIDs = tInfo.participantIDs || [];
        const batchSize = 5;
        for (let i = 0; i < Math.min(memberIDs.length, 50); i += batchSize) {
          const batch = memberIDs.slice(i, i + batchSize);
          try {
            const userInfos = await api.getUserInfo(batch);
            for (const uid of batch) {
              const uName = userInfos[uid]?.name || 'Unknown';
              try {
                Users.create(uid, uName);
              } catch {}
            }
          } catch {}
          await new Promise(r => setTimeout(r, 100));
        }
      } catch {}
    }
    
    // User LEAVE - Update last seen
    if (logMessageType === 'log:unsubscribe') {
      const leftUID = String(logMessageData?.leftParticipantFbId || logMessageData?.userFbId || '');
      if (leftUID) {
        const userData = Users.getData(leftUID);
        
        // Update last seen and remove from group
        const groups = userData.groups || {};
        if (groups[String(threadID)]) {
          groups[String(threadID)].leftAt = Date.now();
          groups[String(threadID)].lastActive = 0;
        }
        Users.setData(leftUID, { 
          ...userData, 
          lastSeen: Date.now(),
          lastGroup: String(threadID),
          groups
        });
      }
      
      // Update thread member count after leave
      try {
        const tInfo = await api.getThreadInfo(threadID);
        Threads.update(threadID, { members: tInfo.participantIDs?.length || 0 });
      } catch {}
    }
    
    // Thread info update (name/emoji/theme change)
    if (['change_thread_name', 'change_thread_theme', 'thread_data'].includes(logMessageType)) {
      try {
        const tInfo = await api.getThreadInfo(threadID);
        const existingThread = Threads.get(threadID);
        if (!existingThread) {
          Threads.create(threadID, tInfo.threadName || 'Unknown Group');
        }
        Threads.update(threadID, {
          name: tInfo.threadName || existingThread?.name || 'Unknown Group',
          emoji: tInfo.emoji || '',
          color: tInfo.color || '',
          members: tInfo.participantIDs?.length || 0
        });
      } catch {}
    }

    // Auto refresh thread info when bot is added to group (fix admin detection issue)
    if (logMessageType === 'log:subscribe') {
      try {
        await api.getThreadInfo(threadID);
        console.log('[AUTO-REFRESH] Thread info refreshed for:', threadID);
      } catch {}
    }
  } catch (e) {
    console.log('[DB-AUTO-UPDATE] Error:', e.message);
  }
  // ── End Auto Update ────────────────────────────────────────────────
  
  // Check for locked nicknames (nicklock detection)
  if (logMessageType === 'log:user-nickname' || logMessageType === 'log:thread-nickname') {
    console.log(`[NICKLOCK-EVENT] Detected ${logMessageType} in thread ${threadID}`);
    try {
      const nicklockPath = path.join(__dirname, '../../nicklock.json');
      console.log(`[NICKLOCK-EVENT] Checking file: ${nicklockPath}`);
      
      if (fs.existsSync(nicklockPath)) {
        const nickData = fs.readJsonSync(nicklockPath);
        console.log(`[NICKLOCK-EVENT] Locks data loaded:`, JSON.stringify(nickData.locks || {}));
        
        if (nickData.locks && Object.keys(nickData.locks).length > 0) {
          // Get thread info
          const threadInfo = await api.getThreadInfo(threadID);
          console.log(`[NICKLOCK-EVENT] Got thread info, checking ${Object.keys(nickData.locks).length} locks`);
          
          // Check each lock
          for (const [key, lock] of Object.entries(nickData.locks)) {
            const [keyThreadID, userID] = key.split('_');
            console.log(`[NICKLOCK-EVENT] Checking lock ${key}: threadID ${keyThreadID} vs ${threadID}`);
            
            if (String(keyThreadID) === String(threadID)) {
              try {
                const userNickname = threadInfo.userInfo?.[userID]?.nickname;
                console.log(`[NICKLOCK-EVENT] ${userID} current: "${userNickname}", locked: "${lock.nickname}"`);
                
                // Restore if changed
                if (userNickname && userNickname !== lock.nickname) {
                  console.log(`[NICKLOCK-EVENT] RESTORING ${userID}!`);
                  
                  setTimeout(async () => {
                    try {
                      await api.changeNickname(lock.nickname, threadID, userID);
                      console.log(`[NICKLOCK-EVENT] ✅ Restored ${userID} to "${lock.nickname}"`);
                    } catch (e) {
                      console.log(`[NICKLOCK-EVENT] ❌ Failed: ${e.message}`);
                    }
                  }, 500);
                } else {
                  console.log(`[NICKLOCK-EVENT] No change needed for ${userID}`);
                }
              } catch (e) {
                console.log(`[NICKLOCK-EVENT] Error: ${e.message}`);
              }
            }
          }
        } else {
          console.log(`[NICKLOCK-EVENT] No locks found`);
        }
      } else {
        console.log(`[NICKLOCK-EVENT] File not found: ${nicklockPath}`);
      }
    } catch (e) {
      console.log(`[NICKLOCK-EVENT] Exception: ${e.message}`);
    }
  }
  
  // Check for lockgroup settings (theme/emoji/name restoration)
  if (logMessageType === 'change_thread_theme' || logMessageType === 'change_thread_name' || logMessageType === 'thread_data') {
    try {
      const lockgroupPath = path.join(__dirname, '../../node_modules/inii2-chand-bot/commands/data/lockgroup_data.json');
      if (fs.existsSync(lockgroupPath)) {
        const lockData = fs.readJsonSync(lockgroupPath);
        const locks = lockData[threadID];
        
        if (locks && Object.keys(locks).length > 0) {
          try {
            const threadInfo = await api.getThreadInfo(threadID);
            
            // Restore name if locked
            if (locks.lockName && locks.originalName && threadInfo.threadName !== locks.originalName) {
              try {
                await api.setThreadName(locks.originalName, threadID);
              } catch (e) {}
            }
            
            // Restore emoji if locked
            if (locks.lockEmoji && locks.originalEmoji && threadInfo.emoji !== locks.originalEmoji) {
              try {
                await api.changeThreadTheme(locks.originalEmoji, threadID);
              } catch (e) {}
            }
            
            // Restore theme if locked
            if (locks.lockTheme && locks.originalTheme) {
              const currentTheme = threadInfo.color || threadInfo.threadThemeID;
              if (currentTheme !== locks.originalTheme) {
                try {
                  await api.changeThreadTheme(locks.originalTheme, threadID);
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  
  // ── log:subscribe → AddBan auto-kick + JoinNoti ───────────────────
  if (logMessageType === 'log:subscribe') {
    const added = logMessageData?.addedParticipants || [];
    for (const participant of added) {
      const uid = String(participant.userFbId);
      const fullName = participant.fullName || uid;

      

      // 2a. Newcomer — record join timestamp
      try {
        const ncCmd = client.commands.get('newcomer');
        if (ncCmd && ncCmd.recordJoin) ncCmd.recordJoin(threadID, uid, fullName);
      } catch {}

      // 2b. AntiRaid — mass-join detection + auto-kick
      try {
        const raidCmd = client.commands.get('antiraid');
        if (raidCmd && raidCmd.isEnabled && raidCmd.isEnabled(threadID)) {
          await raidCmd.checkJoin(api, threadID, uid, fullName);
        }
      } catch {}

      // 2c. SetJoinMsg — custom text welcome
      try {
        const sjmCmd = client.commands.get('setjoinmsg');
        if (sjmCmd && sjmCmd.getMessage) {
          const tmpl = sjmCmd.getMessage(threadID);
          if (tmpl) {
            let threadName = 'This Group', memberCount = '?';
            try {
              const tI = await api.getThreadInfo(threadID);
              threadName  = tI.threadName || 'This Group';
              memberCount = tI.participantIDs?.length || '?';
            } catch {}
            const msg = tmpl
              .replace(/{name}/g, fullName)
              .replace(/{group}/g, threadName)
              .replace(/{count}/g, memberCount)
              .replace(/{uid}/g, uid);
            api.sendMessage({ body: msg, mentions: [{ tag: fullName, id: uid }] }, threadID);
          }
        }
      } catch {}

      // 2d. Mute — auto-kick if muted user rejoins
      try {
        const muteDataPath = path.join(__dirname, '../../../node_modules/lodash-pari/commands/data/muted.json');
        if (fs.existsSync(muteDataPath)) {
          const muteData = fs.readJsonSync(muteDataPath);
          const entry = muteData?.[threadID]?.[uid];
          if (entry) {
            const expired = entry.until && Date.now() > entry.until;
            if (!expired) {
              await new Promise(r => setTimeout(r, 1500));
              await api.removeUserFromGroup(uid, threadID);
            }
          }
        }
      } catch {}

      // 2. JoinNoti — send custom welcome message
      try {
        const jnCmd = client.commands.get('joinnoti');
        if (jnCmd && jnCmd.isEnabled && jnCmd.isEnabled(threadID)) {
          let threadName = 'This Group';
          let memberCount = '?';
          try {
            const tInfo = await api.getThreadInfo(threadID);
            threadName = tInfo.threadName || 'This Group';
            memberCount = tInfo.participantIDs?.length || '?';
          } catch {}
          const template = jnCmd.getMessage ? jnCmd.getMessage(threadID) : '{name} joined!';
          const welcomeMsg = template
            .replace(/{name}/g, fullName)
            .replace(/{group}/g, threadName)
            .replace(/{count}/g, memberCount)
            .replace(/{uid}/g, uid);
          api.sendMessage(
            { body: welcomeMsg, mentions: [{ tag: fullName, id: uid }] },
            threadID
          );
        }
      } catch {}
    }
  }
  // ── End log:subscribe hooks ────────────────────────────────────────

  // ── log:unsubscribe → KickAdd + AntiOut kick-bypass ──────────────
  let _wasKicked = false;
  if (logMessageType === 'log:unsubscribe') {
    const leftUID  = String(logMessageData?.leftParticipantFbId || logMessageData?.userFbId || '');
    const actorUID = String(logMessageData?.author || logMessageData?.actorFbId || '');
    _wasKicked = !!(actorUID && leftUID && actorUID !== leftUID);

    if (_wasKicked && leftUID) {
      // KickAdd — auto re-add kicked member if enabled
      try {
        const kaCmd = client.commands.get('kickadd');
        if (kaCmd && kaCmd.isEnabled && kaCmd.isEnabled(threadID)) {
          let uName = leftUID;
          try {
            const tI = await api.getThreadInfo(threadID);
            const u  = (tI.userInfo || []).find(u => String(u.id) === leftUID);
            if (u?.name) uName = u.name;
          } catch {}
          kaCmd.addBack(api, threadID, leftUID, uName);
        }
      } catch {}
    }
  }
  // ── End log:unsubscribe hooks ──────────────────────────────────────

  for (const [name, eventHandler] of client.events) {
    try {
      if (eventHandler.config.eventType) {
        if (Array.isArray(eventHandler.config.eventType)) {
          if (!eventHandler.config.eventType.includes(logMessageType)) continue;
        } else if (eventHandler.config.eventType !== logMessageType) {
          continue;
        }
      }

      // AntiOut: skip if member was kicked (not voluntary leave)
      if (name === 'antiout' && _wasKicked) continue;

      const send = new Send(api, event);
      
      await eventHandler.run({
        api,
        event,
        send,
        Users,
        Threads,
        config,
        client,
        logMessageType,
        logMessageData,
        logMessageBody
      });
    } catch (error) {
      logs.error('EVENT', `Error in ${name}:`, error.message);
    }
  }
}

module.exports = handleEvent;
