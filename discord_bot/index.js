const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const { initializeDatabase, saveRequest, updateRequestStatus, getRequestsByStatus, getAllRequests, getContributorLeaderboard, getLeaderboardInfo, setLeaderboardInfo, deleteRequestByMessageId } = require('./database');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Get environment variables
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const LEADERBOARD_CHANNEL_ID = '1359095534358630440';

let leaderboardMessageId = null; // Track the leaderboard message to update it

// Function to get map version information
function getMapVersionInfo() {
  try {
    const versionFilePath = path.join(__dirname, 'src', 'mapversion.yml');
    if (fs.existsSync(versionFilePath)) {
      const versionData = yaml.load(fs.readFileSync(versionFilePath, 'utf8'));
      return {
        mapVersion: versionData.version || 'unknown',
        gameVersion: versionData.game_version || 'unknown'
      };
    } else {
      console.warn(`Map version file not found at ${versionFilePath}`);
      return { mapVersion: 'unknown', gameVersion: 'unknown' };
    }
  } catch (error) {
    console.error('Error reading map version file:', error);
    return { mapVersion: 'unknown', gameVersion: 'unknown' };
  }
}

// Function to format coordinates and extract individual coordinate data
function formatCoordinates(coordsString) {
  // Remove all whitespace
  coordsString = coordsString.replace(/\s+/g, '');
  
  // Match all coordinate pairs [x,y]
  const coordPairs = coordsString.match(/\[-?\d+,-?\d+\]/g);
  
  if (!coordPairs) return { formatted: null, coordinates: [] };
  
  const coordinates = [];
  
  // Format each pair with proper spacing
  const formatted = coordPairs.map(pair => {
    // Extract x and y values
    const [x, y] = pair.slice(1, -1).split(',').map(num => parseInt(num.trim()));
    coordinates.push({ x, y });
    return `- [${x}, ${y}]`;
  }).join('\n');
  
  return { formatted, coordinates };
}

// Function to validate coordinates
function validateCoordinates(coordsString) {
  // Match one or more coordinate pairs separated by commas: [x,y], [x,y]
  const coordRegex = /^(\[\s*-?\d+\s*,\s*-?\d+\s*\])(\s*,\s*\[\s*-?\d+\s*,\s*-?\d+\s*\])*$/;
  return coordRegex.test(coordsString);
}

// Function to generate clickable map links for coordinates
function generateMapLinks(coordinates) {
  return coordinates.map(coord => {
    return `[View [${coord.x}, ${coord.y}] on map](https://soulmap.avakot.org/?coord=${coord.x},${coord.y})`;
  }).join('\n');
}

// Function to update the leaderboard
async function updateLeaderboard() {
  try {
    // Get leaderboard data from database
    const leaderboardData = getContributorLeaderboard();
    
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
    const leaderboardInfo = getLeaderboardInfo();
    
    try {
      // First try to fetch the stored message if we have one
      if (leaderboardInfo.message_id) {
        try {
          const leaderboardMessage = await leaderboardChannel.messages.fetch(leaderboardInfo.message_id);
          await leaderboardMessage.edit({ embeds: [embed] });
          console.log('Updated existing leaderboard message');
          return;
        } catch (messageError) {
          console.log('Stored leaderboard message not found, creating new one');
          // Continue to create a new message
        }
      }
      
      // If we get here, we need to create a new message
      
      // Optional: clear the channel first (uncomment if desired)
      // const messages = await leaderboardChannel.messages.fetch({ limit: 10 });
      // await leaderboardChannel.bulkDelete(messages);
      
      // Send new leaderboard message
      const newMessage = await leaderboardChannel.send({ embeds: [embed] });
      
      // Store the new message ID
      setLeaderboardInfo(newMessage.id, LEADERBOARD_CHANNEL_ID);
      console.log('Created and stored new leaderboard message');
      
    } catch (channelError) {
      console.error('Error updating leaderboard message:', channelError);
    }
  } catch (error) {
    console.error('Error updating leaderboard:', error);
  }
}

// Function to safely fetch a message, with database sync if message is missing
async function safeMessageFetch(channel, messageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch (error) {
    if (error.code === 10008) { // Unknown Message error code
      console.log(`Message ${messageId} not found in Discord, removing from database`);
      deleteRequestByMessageId(messageId);
      return null;
    }
    throw error; // Re-throw if it's a different error
  }
}

// Ready event
client.once(Events.ClientReady, async client => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // Verify required environment variables
  if (!ADMIN_ROLE_ID) {
    console.warn('WARNING: ADMIN_ROLE_ID environment variable is not set. Admin permissions will not work correctly.');
  }
  
  // Test reading version info
  const versionInfo = getMapVersionInfo();
  console.log(`Map version: ${versionInfo.mapVersion}, Game version: ${versionInfo.gameVersion}`);
  
  // Initialize database
  initializeDatabase();
  
  // Initialize leaderboard
  updateLeaderboard();
  
  // Sync database on startup (after a short delay to ensure everything is loaded)
  setTimeout(() => syncDatabase(), 10000);
  
  // Schedule daily sync (24 hours)
  setInterval(() => syncDatabase(), 24 * 60 * 60 * 1000);
  
  // Register slash commands
  try {
    const commands = [
      {
        name: 'request',
        description: 'Submit a location request for SoulMap',
        options: [
          {
            name: 'coordinates',
            description: 'Coordinates in [X, Y] format',
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: 'description',
            description: 'Brief description of the location/marker',
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: 'screenshot',
            description: 'Optional screenshot of the location',
            type: ApplicationCommandOptionType.Attachment,
            required: false
          }
        ]
      },
      {
        name: 'listrequests',
        description: 'List all location requests (admin only)',
        options: [
          {
            name: 'status',
            description: 'Filter by status (pending, implemented, dismissed)',
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
              { name: 'Pending', value: 'pending' },
              { name: 'Implemented', value: 'implemented' },
              { name: 'Dismissed', value: 'dismissed' },
              { name: 'All', value: 'all' }
            ]
          }
        ]
      }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

// Handle slash commands
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'request') {
    try {
      // Get command options
      const coordinates = interaction.options.getString('coordinates');
      const description = interaction.options.getString('description');
      const screenshot = interaction.options.getAttachment('screenshot');
      
      // Validate coordinates format
      if (!validateCoordinates(coordinates)) {
        return await interaction.reply({ 
          content: 'Error: Coordinates must be in the format [X, Y] or multiple coordinates like [X, Y], [X, Y]',
          ephemeral: true 
        });
      }

      // Format coordinates for display and extract coordinate data
      const { formatted: formattedCoords, coordinates: coordData } = formatCoordinates(coordinates);
      if (!formattedCoords) {
        return await interaction.reply({ 
          content: 'Error: Could not parse the coordinates. Please check your input.',
          ephemeral: true 
        });
      }
      
      // Generate map links
      const mapLinks = generateMapLinks(coordData);

      // Acknowledge the interaction first to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      // Get version information
      const versionInfo = getMapVersionInfo();
      
      // Create an embed for the request
      const embed = new EmbedBuilder()
        .setTitle('New Location Request')
        .setColor('#0099ff')
        .addFields(
          { name: 'Coordinates', value: '```yml\n' + formattedCoords + '\n```' },
          { name: 'Map Links', value: mapLinks },
          { name: 'Description', value: description }
        )
        .setFooter({ 
          text: `SoulMap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Requested by ${interaction.user.tag} (${interaction.user.id})`, 
          iconURL: interaction.user.displayAvatarURL() 
        })
        .setTimestamp();
      
      // Add screenshot if provided
      if (screenshot) {
        embed.setImage(screenshot.url);
      }
      
      // Create buttons for the request
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_${interaction.user.id}`)
            .setLabel('✅ Implemented')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`dismiss_${interaction.user.id}`)
            .setLabel('❌ Dismissed')
            .setStyle(ButtonStyle.Danger)
        );
      
      // Send the embed to the specified channel
      const channel = client.channels.cache.get(CHANNEL_ID);
      if (channel) {
        // Send temporary message first to get the message ID
        const tempMessage = await channel.send({ content: 'Processing request...' });
        
        // Update the message with actual content
        await tempMessage.edit({ content: null, embeds: [embed], components: [row] });
        
        // Save request to database with the message ID
        const screenshotUrl = screenshot ? screenshot.url : null;
        saveRequest(tempMessage.id, interaction.user.id, coordinates, description, screenshotUrl);
        
        await interaction.editReply('Your location request has been submitted!');
      } else {
        await interaction.editReply('Error: Could not find the specified channel.');
      }
    } catch (error) {
      console.error('Error processing request command:', error);
      // Handle the case where interaction might have already been replied to
      try {
        if (interaction.deferred) {
          await interaction.editReply('An error occurred while processing your request.');
        } else {
          await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
      } catch (followupError) {
        console.error('Error sending error response:', followupError);
      }
    }
  } else if (interaction.commandName === 'listrequests') {
    // Check if user has admin role
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const hasAdminRole = member.roles.cache.has(ADMIN_ROLE_ID);
    
    if (!hasAdminRole) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      return;
    }
    
    try {
      // Get status filter
      const status = interaction.options.getString('status') || 'pending';
      
      // Get requests based on status
      let requests;
      if (status === 'all') {
        requests = getAllRequests();
      } else {
        requests = getRequestsByStatus(status);
      }
      
      // Filter out requests with deleted messages and clean up database
      if (requests && requests.length > 0) {
        const channel = client.channels.cache.get(CHANNEL_ID);
        if (channel) {
          const validRequests = [];
          
          // Process in batches to avoid rate limits
          for (let i = 0; i < requests.length; i++) {
            try {
              const request = requests[i];
              const message = await safeMessageFetch(channel, request.message_id);
              
              if (message) {
                validRequests.push(request);
              }
              // If message is null, safeMessageFetch already deleted it from the database
              
              // Add a small delay every few requests to avoid rate limiting
              if (i % 5 === 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (messageError) {
              console.error(`Error processing request ${i}:`, messageError);
            }
          }
          
          requests = validRequests;
        }
      }
      
      if (!requests || requests.length === 0) {
        await interaction.reply({ content: `No ${status} requests found.`, ephemeral: true });
        return;
      }
      
      // Get version information
      const versionInfo = getMapVersionInfo();
      
      // Create embed with request information
      const embed = new EmbedBuilder()
        .setTitle(`Location Requests (${status})`)
        .setColor('#0099ff')
        .setDescription(`Found ${requests.length} requests`)
        .setTimestamp()
        .setFooter({ 
          text: `SoulMap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Showing ${requests.length} of ${requests.length} requests` 
        });
        
      // Add up to 10 requests to the embed
      const displayRequests = requests.slice(0, 10);
      for (const request of displayRequests) {
        embed.addFields({
          name: `Request #${request.id}`,
          value: `**Coordinates:** ${request.coordinates}\n` +
                `**Description:** ${request.description.substring(0, 100)}${request.description.length > 100 ? '...' : ''}\n` +
                `**Status:** ${request.status}\n` +
                `**Date:** ${new Date(request.created_at).toLocaleString()}\n` +
                `[Jump to Message](https://discord.com/channels/${interaction.guild.id}/${CHANNEL_ID}/${request.message_id})`
        });
      }
      
      if (requests.length > 10) {
        embed.setFooter({ text: `Showing 10 of ${requests.length} requests` });
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      console.error('Error listing requests:', error);
      await interaction.reply({ content: 'An error occurred while retrieving requests.', ephemeral: true });
    }
  }
});

// Handle button interactions
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  
  try {
    // Check if user has admin role
    const member = await interaction.guild.members.fetch(interaction.user.id);
    
    if (!ADMIN_ROLE_ID) {
      console.error('ADMIN_ROLE_ID is not configured. Cannot verify admin permissions.');
      await interaction.reply({ content: 'Error: Admin role is not configured on the server. Please contact the administrator.', ephemeral: true });
      return;
    }
    
    const hasAdminRole = member.roles.cache.has(ADMIN_ROLE_ID);
    
    if (!hasAdminRole) {
      console.log(`User ${interaction.user.tag} (${interaction.user.id}) attempted to use admin button without permission`);
      await interaction.reply({ content: 'You do not have permission to use these buttons. This action requires admin role.', ephemeral: true });
      return;
    }
    
    console.log(`Admin ${interaction.user.tag} (${interaction.user.id}) used button: ${interaction.customId}`);
    
    const [action, userId] = interaction.customId.split('_');
    
    if (action === 'approve') {
      // Get version information
      const versionInfo = getMapVersionInfo();
      
      // Update the embed to show it's implemented
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor('#00FF00')
        .setTitle('Location Request (Implemented)')
        .setFooter({ 
          text: `SoulMap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Implemented by ${interaction.user.tag}` 
        });
      
      // Disable buttons
      const row = new ActionRowBuilder();
      row.addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0])
          .setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[1])
          .setDisabled(true)
      );
      
      await interaction.update({ embeds: [embed], components: [row] });
      
      // Update in database
      updateRequestStatus(interaction.message.id, 'implemented');
      
      // Update the leaderboard
      updateLeaderboard();
      
      // Notify the user who requested it
      try {
        const requester = await client.users.fetch(userId);
        await requester.send({ content: 'Your location request has been implemented!' });
      } catch (error) {
        console.error('Could not notify user:', error);
      }
    } 
    else if (action === 'dismiss') {
      // Create a modal for dismissal reason
      const modal = new ModalBuilder()
        .setCustomId(`dismissModal_${userId}_${interaction.message.id}`)
        .setTitle('Dismiss Location Request');
      
      const reasonInput = new TextInputBuilder()
        .setCustomId('dismissReason')
        .setLabel('Reason (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Enter a reason for dismissal...')
        .setRequired(false)
        .setMaxLength(1000);
      
      const actionRow = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(actionRow);
      
      await interaction.showModal(modal);
    }
  } catch (error) {
    console.error('Error handling button interaction:', error);
    try {
      await interaction.reply({ content: 'An error occurred while processing this action.', ephemeral: true });
    } catch (replyError) {
      console.error('Could not send error response:', replyError);
    }
  }
});

// Handle modal submissions
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;
  
  try {
    if (interaction.customId.startsWith('dismissModal_')) {
      const [, userId, messageId] = interaction.customId.split('_');
      const reason = interaction.fields.getTextInputValue('dismissReason') || 'No reason provided';
      
      // Get version information
      const versionInfo = getMapVersionInfo();
      
      // Get the original message with database sync
      const channel = client.channels.cache.get(CHANNEL_ID);
      const message = await safeMessageFetch(channel, messageId);
      
      if (!message) {
        // If message was deleted, inform the admin
        await interaction.reply({ 
          content: 'This request message was deleted. The database has been updated accordingly.', 
          ephemeral: true 
        });
        return;
      }
      
      // Update the embed to show it's dismissed
      const embed = EmbedBuilder.from(message.embeds[0])
        .setColor('#FF0000')
        .setTitle('Location Request (Dismissed)')
        .addFields({ name: 'Dismissal Reason', value: reason })
        .setFooter({ 
          text: `SoulMap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Dismissed by ${interaction.user.tag}` 
        });
      
      // Disable buttons
      const row = new ActionRowBuilder();
      row.addComponents(
        ButtonBuilder.from(message.components[0].components[0])
          .setDisabled(true),
        ButtonBuilder.from(message.components[0].components[1])
          .setDisabled(true)
      );
      
      await message.edit({ embeds: [embed], components: [row] });
      
      // Update in database
      updateRequestStatus(messageId, 'dismissed', reason);
      
      // Reply to the interaction
      await interaction.reply({ content: 'Location request dismissed.', ephemeral: true });
      
      // Notify the user who requested it
      try {
        const requester = await client.users.fetch(userId);
        await requester.send({ 
          content: `Your location request has been dismissed with reason: ${reason}` 
        });
      } catch (error) {
        console.error('Could not notify user:', error);
      }
    }
  } catch (error) {
    console.error('Error handling modal submission:', error);
    await interaction.reply({ content: 'An error occurred while processing your submission.', ephemeral: true });
  }
});

// Add a function to sync on a schedule if needed
async function syncDatabase() {
  try {
    console.log('Starting database sync...');
    
    // Get all requests
    const allRequests = getAllRequests();
    const channel = client.channels.cache.get(CHANNEL_ID);
    
    if (!channel) {
      console.error('Cannot sync database: Request channel not found');
      return;
    }
    
    let deletedCount = 0;
    
    // Process in batches to avoid rate limits
    for (let i = 0; i < allRequests.length; i++) {
      try {
        const request = allRequests[i];
        const message = await safeMessageFetch(channel, request.message_id);
        
        if (!message) {
          deletedCount++;
        }
        
        // Add a small delay every few requests to avoid rate limiting
        if (i % 5 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error processing request during sync:`, error);
      }
    }
    
    console.log(`Database sync complete. Removed ${deletedCount} orphaned entries.`);
  } catch (error) {
    console.error('Error syncing database:', error);
  }
}

// Login with token
client.login(TOKEN).catch(error => {
  console.error('Failed to login:', error);
});
