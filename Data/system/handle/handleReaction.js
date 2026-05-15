const logs = require('../../utility/logs');

async function handleReaction({ api, event, config }) {
  const { threadID, messageID, userID, reaction } = event;
  
  if (!reaction) return;
  
  const deleteEmoji = config.REACT_DELETE_EMOJI || '😡';
  
  if (reaction === deleteEmoji) {
    try {
      const botID = api.getCurrentUserID();
      
      if (userID === botID) return;
      if (!messageID || !threadID) {
        console.log('[REACTION] Missing messageID or threadID');
        return;
      }
      
      await api.unsendMessage(messageID, threadID);
      logs.info('REACTION', `Message deleted by reaction ${deleteEmoji} from ${userID}`);
    } catch (error) {
      logs.error('REACTION', 'Failed to delete message:', error.message);
    }
    return;
  }

  if (!global.client.handleReaction) return;

  const reactionData = global.client.handleReaction.find(
    item => item.messageID === messageID
  );

  if (!reactionData) return;

  try {
    const command = global.client.commands.get(reactionData.name);

    if (!command || !command.handleReaction) return;

    const Threads = require('../../system/controllers/threads');
    const threadsController = new Threads(api);

    await command.handleReaction({
      api,
      event,
      config,
      handleReaction: reactionData,
      Threads: threadsController
    });
  } catch (error) {
    console.error('Reaction Handler Error:', error);
  }
}

module.exports = handleReaction;