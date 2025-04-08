const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const { initializeDatabase, saveRequest, updateRequestStatus, getRequestsByStatus, getAllRequests } = require('./database');
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
      const coordRegex = /^\[\s*-?\d+\s*,\s*-?\d+\s*\]$/;
      if (!coordRegex.test(coordinates)) {
        return await interaction.reply({ 
          content: 'Error: Coordinates must be in the format [X, Y]',
          ephemeral: true 
        });
      }

      // Acknowledge the interaction first to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      // Get version information
      const versionInfo = getMapVersionInfo();
      
      // Create an embed for the request
      const embed = new EmbedBuilder()
        .setTitle('New Location Request')
        .setColor('#0099ff')
        .addFields(
          { name: 'Coordinates', value: coordinates },
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
      
      // Get the original message
      const channel = client.channels.cache.get(CHANNEL_ID);
      const message = await channel.messages.fetch(messageId);
      
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

// Login with token
client.login(TOKEN).catch(error => {
  console.error('Failed to login:', error);
});
