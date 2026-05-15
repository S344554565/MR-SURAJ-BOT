module.exports = {
  config: {
    name: "kickadd",
    aliases: ["kickaddmode"],
    description: "Toggle kickadd mode - auto re-add kicked users",
    permission: 1,
    prefix: true,
    cooldown: 5
  },
  run: async ({ api, event, args, send, config, Threads }) => {
    const { threadID, messageID } = event;
    
    if (!args[0]) {
      const settings = Threads.getSettings(threadID) || {};
      const status = settings.kickadd ? 'ON' : 'OFF';
      return send.send(`╭─────────────────╮
│ 💫 KickAdd Mode
├─────────────────┤
│ Status: ${status}
╰─────────────────╯`);
    }
    
    const action = args[0].toLowerCase();
    if (action === 'on' || action === 'off') {
      const settings = Threads.getSettings(threadID) || {};
      settings.kickadd = action === 'on';
      Threads.setSettings(threadID, settings);
      
      return send.send(`✅ KickAdd mode ${action === 'on' ? 'ON' : 'OFF'} ho gaya!`);
    }
    
    return send.send('Usage: .kickadd on/off');
  }
};