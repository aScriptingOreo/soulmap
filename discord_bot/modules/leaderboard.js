const { EmbedBuilder } = require('discord.js');
const { getMapVersionInfo } = require('./utils');

/**
 * Function to update the leaderboard
 */
async function updateLeaderboard(client, getContributorLeaderboard, getLeaderboardInfo, setLeaderboardInfo, LEADERBOARD_CHANNEL_ID) {
  try {
    if (!LEADERBOARD_CHANNEL_ID) {
      console.log('Skipping leaderboard update: LEADERBOARD_CHANNEL_ID not configured');
      return;
    }
    
    // Get leaderboard data from database
    const leaderboardData = await getContributorLeaderboard();
    
    // Get version information
    const versionInfo = getMapVersionInfo();
    
    // Create embed for the leaderboard
    const embed = new EmbedBuilder()
      .setTitle('🏆 SoulMap Contributors Leaderboard 🏆')
      .setColor('#FFD700') // Gold color
      .setDescription('Top contributors based on implemented location coordinates')
      .setTimestamp()
      .setFooter({ 
        text: `SoulMap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion}` 
      });
    
    // Format contributors list
    if (leaderboardData.length === 0) {
      embed.addFields({ name: 'No contributors yet', value: 'Be the first to contribute!' });
    } else {
      // Take top 10
      const topContributors = leaderboardData.slice(0, 10);
      
      // Create leaderboard list
      let leaderboardText = '';
      for (let i = 0; i < topContributors.length; i++) {
        try {
          const contributor = topContributors[i];
          
          // Add medal for top 3
          let medal = '';
          if (i === 0) medal = '🥇 ';
          else if (i === 1) medal = '🥈 ';
          else if (i === 2) medal = '🥉 ';
          else medal = `${i+1}. `;
          
          // Format using Discord mention
          leaderboardText += `${medal}<@${contributor.userId}>: ${contributor.count} submission${contributor.count === 1 ? '' : 's'}\n`;
        } catch (innerError) {
          console.error('Error formatting contributor entry:', innerError);
        }
      }
      
      embed.addFields({ name: 'Top Contributors', value: leaderboardText || 'Error loading contributors' });
    }
    
    // Get the leaderboard channel
    const leaderboardChannel = client.channels.cache.get(LEADERBOARD_CHANNEL_ID);
    if (!leaderboardChannel) {
      console.error(`Could not find leaderboard channel with ID ${LEADERBOARD_CHANNEL_ID}`);
      return;
    }
    
    // Get stored leaderboard info
    const leaderboardInfo = await getLeaderboardInfo();
    console.log('Retrieved leaderboard info from database:', JSON.stringify(leaderboardInfo));
    
    let messageToEdit = null;

    // Try to fetch the existing message if an ID is stored
    if (leaderboardInfo && leaderboardInfo.message_id) {
      console.log(`Attempting to fetch existing leaderboard message: ${leaderboardInfo.message_id}`);
      try {
        messageToEdit = await leaderboardChannel.messages.fetch(leaderboardInfo.message_id);
        console.log(`Successfully fetched message ${leaderboardInfo.message_id}`);
      } catch (fetchError) {
        // If fetch fails for any reason, log it and clear the stored ID
        console.warn(`Failed to fetch leaderboard message ${leaderboardInfo.message_id}: ${fetchError.message} (${fetchError.code}). Assuming it needs replacement.`);
        try {
          await setLeaderboardInfo(null, null); // Clear invalid/inaccessible message ID
          console.log('Cleared leaderboard message ID from database due to fetch error.');
        } catch (dbError) {
          console.error('Failed to clear leaderboard message ID from database:', dbError);
        }
        messageToEdit = null; // Ensure we don't try to edit later
      }
    } else {
      console.log('No existing leaderboard message ID found in database.');
    }

    // Now, either edit the fetched message or send a new one
    try {
      if (messageToEdit) {
        // Edit the existing message
        await messageToEdit.edit({ embeds: [embed] });
        console.log(`Updated existing leaderboard message ${messageToEdit.id}`);
        // Successfully edited, no need to do anything else in this function run
        return;
      } else {
        // Send a new message if no valid existing message was found/fetched
        console.log('Sending new leaderboard message.');
        const newMessage = await leaderboardChannel.send({ embeds: [embed] });
        console.log(`Sent new leaderboard message ${newMessage.id}`);

        // Store the new message ID
        await setLeaderboardInfo(newMessage.id, LEADERBOARD_CHANNEL_ID);
        console.log('Stored new leaderboard message ID in database');
      }
    } catch (sendOrEditError) {
      console.error('Error sending or editing leaderboard message:', sendOrEditError);
    }
  } catch (error) {
    console.error('Error updating leaderboard:', error);
  }
}

module.exports = {
  updateLeaderboard
};
