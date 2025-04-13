const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const { initializeDatabase, saveRequest, updateRequestStatus, getRequestsByStatus, getAllRequests, getContributorLeaderboard, getLeaderboardInfo, setLeaderboardInfo, deleteRequestByMessageId } = require('./database');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// Initialize Prisma client
const prisma = new PrismaClient();

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Get environment variables with validation
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;

// Validate required environment variables
if (!TOKEN) {
  console.error('ERROR: DISCORD_TOKEN environment variable is not set.');
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.warn('WARNING: CHANNEL_ID environment variable is not set. Request submissions will not work.');
}

if (!ADMIN_ROLE_ID) {
  console.warn('WARNING: ADMIN_ROLE_ID environment variable is not set. Admin permissions will not work correctly.');
}

if (!LEADERBOARD_CHANNEL_ID) {
  console.warn('WARNING: LEADERBOARD_CHANNEL_ID environment variable is not set. Leaderboard functionality will be disabled.');
}

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
    if (!LEADERBOARD_CHANNEL_ID) {
      console.log('Skipping leaderboard update: LEADERBOARD_CHANNEL_ID not configured');
      return;
    }
    
    // Get leaderboard data from database - now with await
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
      await deleteRequestByMessageId(messageId); // Now with await
      return null;
    }
    throw error; // Re-throw if it's a different error
  }
}

// Function to notify the web application of database changes
async function notifyDatabaseChange() {
  try {
    await prisma.$executeRaw`NOTIFY location_changes`;
    console.log('Notified application of database changes');
  } catch (error) {
    console.error('Failed to notify about database changes:', error);
  }
}

// Ready event
client.once(Events.ClientReady, async client => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // More detailed validation of channel IDs
  if (CHANNEL_ID) {
    const requestChannel = client.channels.cache.get(CHANNEL_ID);
    if (!requestChannel) {
      console.warn(`WARNING: Could not find request channel with ID ${CHANNEL_ID}. Request submissions will not work.`);
    } else {
      console.log(`Request channel found: #${requestChannel.name || 'unknown'}`);
    }
  }
  
  if (LEADERBOARD_CHANNEL_ID) {
    const leaderboardChannel = client.channels.cache.get(LEADERBOARD_CHANNEL_ID);
    if (!leaderboardChannel) {
      console.warn(`WARNING: Could not find leaderboard channel with ID ${LEADERBOARD_CHANNEL_ID}. Leaderboard updates will not work.`);
    } else {
      console.log(`Leaderboard channel found: #${leaderboardChannel.name || 'unknown'}`);
    }
  }
  
  // Test reading version info
  const versionInfo = getMapVersionInfo();
  console.log(`Map version: ${versionInfo.mapVersion}, Game version: ${versionInfo.gameVersion}`);
  
  // Initialize database - now with await since it's async
  try {
    await initializeDatabase();
    console.log('Database initialized');
    
    // Initialize leaderboard
    await updateLeaderboard();
    
    // Sync database on startup (after a short delay to ensure everything is loaded)
    setTimeout(() => syncDatabase(), 10000);
    
    // Schedule daily sync (24 hours)
    setInterval(() => syncDatabase(), 24 * 60 * 60 * 1000);
    
    // Register slash commands
    try {
      const commands = [
        // User request command with subcommands
        {
          name: 'request',
          description: 'Submit location requests for SoulMap',
          options: [
            {
              name: 'new',
              description: 'Submit a new location request',
              type: ApplicationCommandOptionType.Subcommand,
              options: [
                {
                  name: 'name',
                  description: 'Name for the location',
                  type: ApplicationCommandOptionType.String,
                  required: true
                },
                {
                  name: 'coordinates',
                  description: 'Coordinates in [X, Y] format, can use multiple like [X,Y],[X,Y]',
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
              name: 'edit',
              description: 'Request to edit an existing location',
              type: ApplicationCommandOptionType.Subcommand,
              options: [
                {
                  name: 'name',
                  description: 'Name of the location to edit',
                  type: ApplicationCommandOptionType.String,
                  required: true,
                  autocomplete: true
                },
                {
                  name: 'description',
                  description: 'New description for the location',
                  type: ApplicationCommandOptionType.String,
                  required: false
                }
              ]
            },
            {
              name: 'remove',
              description: 'Request to remove a location or coordinate',
              type: ApplicationCommandOptionType.Subcommand,
              options: [
                {
                  name: 'name',
                  description: 'Name of the location to remove',
                  type: ApplicationCommandOptionType.String,
                  required: true,
                  autocomplete: true
                }
              ]
            }
          ]
        },
        
        // Admin command with subcommands
        {
          name: 'admin',
          description: 'Manage SoulMap locations (admin only)',
          options: [
            {
              name: 'new',
              description: 'Add a new location to the database',
              type: ApplicationCommandOptionType.Subcommand,
              options: [
                {
                  name: 'name',
                  description: 'Location name',
                  type: ApplicationCommandOptionType.String,
                  required: true
                },
                {
                  name: 'coordinates',
                  description: 'Coordinates in [X, Y] format, can use multiple like [X,Y],[X,Y]',
                  type: ApplicationCommandOptionType.String,
                  required: true
                },
                {
                  name: 'type',
                  description: 'Location type/category',
                  type: ApplicationCommandOptionType.String,
                  required: true,
                  choices: [
                    { name: 'Location', value: 'location' },
                    { name: 'POI', value: 'poi' },
                    { name: 'Quest', value: 'quest' },
                    { name: 'Camp', value: 'camp' },
                    { name: 'Dungeon', value: 'dungeon' },
                    { name: 'Resource', value: 'resource' },
                    { name: 'User Submitted', value: 'user_submitted' }
                  ]
                },
                {
                  name: 'description',
                  description: 'Location description',
                  type: ApplicationCommandOptionType.String,
                  required: true
                },
                {
                  name: 'icon',
                  description: 'Icon (e.g. fa-solid fa-house)',
                  type: ApplicationCommandOptionType.String,
                  required: false
                },
                {
                  name: 'media_url',
                  description: 'URL to media (image/video)',
                  type: ApplicationCommandOptionType.String,
                  required: false
                }
              ]
            },
            {
              name: 'edit',
              description: 'Edit an existing location',
              type: ApplicationCommandOptionType.Subcommand,
              options: [
                {
                  name: 'name',
                  description: 'Name of the location to edit',
                  type: ApplicationCommandOptionType.String,
                  required: true,
                  autocomplete: true
                }
              ]
            },
            {
              name: 'delete',
              description: 'Delete a location or coordinate',
              type: ApplicationCommandOptionType.Subcommand,
              options: [
                {
                  name: 'name',
                  description: 'Name of the location to delete',
                  type: ApplicationCommandOptionType.String,
                  required: true,
                  autocomplete: true
                }
              ]
            }
          ]
        },
        
        // List requests command (keep this as is)
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
        },
        
        // Import locations command (keep this as is)
        {
          name: 'importlocations',
          description: 'Import locations from YAML files to database (admin only)',
          options: []
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
  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Handle slash commands
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // Handle request command and its subcommands
    if (interaction.commandName === 'request') {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'new':
          await handleRequestNew(interaction);
          break;
        case 'edit':
          await handleRequestEdit(interaction);
          break;
        case 'remove':
          await handleRequestRemove(interaction);
          break;
      }
    }
    // Handle soulmap (admin) command and its subcommands
    else if (interaction.commandName === 'soulmap') {
      // Check admin permissions first
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasAdminRole = member.roles.cache.has(ADMIN_ROLE_ID);
      
      if (!hasAdminRole) {
        await interaction.reply({ 
          content: 'You do not have permission to use this command. Only administrators can manage locations directly.',
          ephemeral: true 
        });
        return;
      }
      
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'new':
          await handleSoulmapNew(interaction);
          break;
        case 'edit':
          await handleSoulmapEdit(interaction);
          break;
        case 'delete':
          await handleSoulmapDelete(interaction);
          break;
      }
    }
    // Handle listrequests command (keeping existing functionality)
    else if (interaction.commandName === 'listrequests') {
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
    // Handle importlocations command (keeping existing functionality)
    else if (interaction.commandName === 'importlocations') {
      // ... existing importlocations command handler code ...
    }
  } catch (error) {
    console.error(`Error handling command ${interaction.commandName}:`, error);
    
    // Send error message if we haven't already replied
    try {
      const replyMethod = interaction.deferred ? interaction.editReply : interaction.reply;
      await replyMethod.call(interaction, { 
        content: 'An error occurred while processing this command.',
        ephemeral: true 
      });
    } catch (followupError) {
      console.error('Error sending error response:', followupError);
    }
  }
});

// Define handler functions for subcommands

// Handler for /request new
async function handleRequestNew(interaction) {
  // Get command options
  const name = interaction.options.getString('name');
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
  
  // Check if a location with this name already exists
  const existingLocation = await prisma.location.findFirst({
    where: { 
      name: {
        equals: name,
        mode: 'insensitive'
      }
    }
  });
  
  // If a location with this name exists, show options to user
  if (existingLocation) {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`append_${name}_${Buffer.from(coordinates).toString('base64')}`)
          .setLabel('Add to existing marker')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rename_${name}_${Buffer.from(coordinates).toString('base64')}`)
          .setLabel('Create with new name')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('cancel_request')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      );
    
    return await interaction.reply({
      content: `A marker with the name "${name}" already exists. What would you like to do?`,
      components: [row],
      ephemeral: true
    });
  }
  
  // If no duplicates, proceed with normal request submission
  await interaction.deferReply({ ephemeral: true });
  
  // Generate map links
  const mapLinks = generateMapLinks(coordData);

  // Get version information
  const versionInfo = getMapVersionInfo();
  
  // Create an embed for the request
  const embed = new EmbedBuilder()
    .setTitle('New Location Request')
    .setColor('#0099ff')
    .addFields(
      { name: 'Name', value: name },
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
        .setCustomId(`approve_${interaction.user.id}_${Buffer.from(name).toString('base64')}`)
        .setLabel('✅ Implement')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dismiss_${interaction.user.id}`)
        .setLabel('❌ Dismiss')
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
    saveRequest(tempMessage.id, interaction.user.id, name, coordinates, description, screenshotUrl);
    
    await interaction.editReply('Your location request has been submitted!');
  } else {
    await interaction.editReply('Error: Could not find the specified channel.');
  }
}

// Handler for /request edit
async function handleRequestEdit(interaction) {
  const markerSelection = interaction.options.getString('name');
  const description = interaction.options.getString('description');
  
  // Parse marker name and index if provided
  let { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
  // Check if marker exists
  const marker = await prisma.location.findFirst({
    where: { name: markerName }
  });
  
  if (!marker) {
    await interaction.reply({ 
      content: `Marker "${markerName}" not found.`,
      ephemeral: true 
    });
    return;
  }

  // For edit requests, show a modal
  const modal = new ModalBuilder()
    .setCustomId(`request_edit_${marker.id}_${coordIndex || '*'}_${interaction.user.id}`)
    .setTitle(`Request Edit: ${markerName}`);
  
  // Add input fields for the edit request
  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Describe your requested changes')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Please explain what changes you would like to make to this location...')
    .setRequired(true)
    .setValue(description || '');
  
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for request')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Why should this location be edited?')
    .setRequired(true);
  
  // Create action rows
  const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
  const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
  
  // Add the components to the modal
  modal.addComponents(descriptionRow, reasonRow);
  
  // Show the modal to the user
  await interaction.showModal(modal);
}

// Handler for /request remove
async function handleRequestRemove(interaction) {
  const markerSelection = interaction.options.getString('name');
  
  // Parse marker name and index if provided (cannot use wildcard here)
  let { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
  // Check if it's a wildcard request
  if (coordIndex === '*') {
    await interaction.reply({ 
      content: 'You cannot use the wildcard (*) in removal requests. Please specify a specific coordinate to remove.',
      ephemeral: true 
    });
    return;
  }
  
  // Check if marker exists
  const marker = await prisma.location.findFirst({
    where: { name: markerName }
  });
  
  if (!marker) {
    await interaction.reply({ 
      content: `Marker "${markerName}" not found.`,
      ephemeral: true 
    });
    return;
  }
  
  // For removal requests, show a modal to provide reason
  const modal = new ModalBuilder()
    .setCustomId(`request_remove_${marker.id}_${coordIndex || 'all'}_${interaction.user.id}`)
    .setTitle(`Request Removal: ${markerName}`);
  
  // Add input field for the removal reason
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for removal')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Please explain why this location/coordinate should be removed...')
    .setRequired(true);
  
  // Create action row
  const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
  
  // Add the component to the modal
  modal.addComponents(reasonRow);
  
  // Show the modal to the user
  await interaction.showModal(modal);
}

// Handler for /soulmap new
async function handleSoulmapNew(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const name = interaction.options.getString('name');
  const coordsString = interaction.options.getString('coordinates');
  const type = interaction.options.getString('type');
  const description = interaction.options.getString('description');
  const icon = interaction.options.getString('icon');
  const mediaUrl = interaction.options.getString('media_url');
  
  // Validate coordinates
  if (!validateCoordinates(coordsString)) {
    await interaction.editReply('Invalid coordinates format. Please use [X, Y] format.');
    return;
  }
  
  // Parse coordinates
  const { coordinates } = formatCoordinates(coordsString);
  
  // Check if location with same name already exists
  const existingLocation = await prisma.location.findFirst({
    where: { 
      name: {
        equals: name,
        mode: 'insensitive'
      }
    }
  });
  
  if (existingLocation) {
    // If a location with this name exists, provide options
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`admin_append_${existingLocation.id}_${Buffer.from(coordsString).toString('base64')}`)
          .setLabel('Append coordinates to existing marker')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('admin_new_name')
          .setLabel('Create with different name')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('admin_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      );
    
    await interaction.editReply({
      content: `A location with the name "${name}" already exists. What would you like to do?`,
      components: [row]
    });
    return;
  }
  
  // Create the location in the database
  await prisma.location.create({
    data: {
      name,
      coordinates: coordinates.length === 1 
        ? [coordinates[0].x, coordinates[0].y]  // Single coordinate pair
        : coordinates.map(c => [c.x, c.y]),     // Array of coordinate pairs
      type,
      description,
      icon,
      mediaUrl: mediaUrl ? [mediaUrl] : undefined,
      createdBy: interaction.user.id,
      lastModified: new Date()
    }
  });
  
  // Notify web application of the change
  await notifyDatabaseChange();
  
  await interaction.editReply(`Location "${name}" added successfully to the ${type} category.`);
}

// Handler for /soulmap edit
async function handleSoulmapEdit(interaction) {
  const markerSelection = interaction.options.getString('name');
  
  // Call shared function to handle marker editing with modals
  await handleEditMarker(interaction);
}

// Handler for /soulmap delete
async function handleSoulmapDelete(interaction) {
  const markerSelection = interaction.options.getString('name');
  
  // Parse marker name and index if provided
  let { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
  // Check if marker exists
  const marker = await prisma.location.findFirst({
    where: { name: markerName }
  });
  
  if (!marker) {
    await interaction.reply({ 
      content: `Marker "${markerName}" not found.`,
      ephemeral: true 
    });
    return;
  }
  
  // Determine if this is a multi-coordinate marker
  const isMultiCoord = Array.isArray(marker.coordinates) && 
    !(marker.coordinates.length === 2 && typeof marker.coordinates[0] === 'number');
  
  // If this is a multi-coordinate marker and we have a specific index
  if (isMultiCoord && coordIndex !== undefined && coordIndex !== '*') {
    // Confirm deletion of specific coordinate
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_delete_coord_${marker.id}_${coordIndex}`)
          .setLabel(`Delete Point #${parseInt(coordIndex) + 1}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_delete_marker')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
    
    await interaction.reply({
      content: `Are you sure you want to delete coordinate #${parseInt(coordIndex) + 1} from marker "${markerName}"?`,
      components: [row],
      ephemeral: true
    });
  } 
  // If this is deleting the entire marker or using wildcard
  else if (coordIndex === '*' || !isMultiCoord) {
    // Confirm deletion of entire marker
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_delete_marker_${marker.id}`)
          .setLabel('Delete Entire Marker')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_delete_marker')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
    
    await interaction.reply({
      content: `Are you sure you want to delete the entire marker "${markerName}"? This action cannot be undone.`,
      components: [row],
      ephemeral: true
    });
  }
}

// Function to sync database on a schedule
async function syncDatabase() {
  try {
    console.log('Starting database sync...');
    
    // Get all requests - now with await
    const allRequests = await getAllRequests();
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
        // Corrected property name from messageId to message_id
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

// Handle autocomplete interactions
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isAutocomplete()) return;
  
  try {
    if (interaction.commandName === 'soulmap' || 
        (interaction.commandName === 'request' && 
         (interaction.options.getSubcommand() === 'edit' || interaction.options.getSubcommand() === 'remove'))) {
      const focusedOption = interaction.options.getFocused(true);
      
      if (focusedOption.name === 'name') {
        const searchTerm = focusedOption.value.toLowerCase();
        const isAdminCommand = interaction.commandName === 'soulmap';
        
        // Check if user has admin role for admin commands
        let isAdmin = false;
        if (isAdminCommand) {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          isAdmin = member.roles.cache.has(ADMIN_ROLE_ID);
        }
        
        // Search for locations in the database
        const locations = await prisma.location.findMany({
          where: {
            name: {
              contains: searchTerm,
              mode: 'insensitive'
            }
          },
          take: 25,
          select: {
            id: true,
            name: true,
            type: true,
            coordinates: true
          },
          orderBy: {
            name: 'asc'
          }
        });
        
        const choices = [];
        
        // Process each location and format options according to requirements
        for (const location of locations) {
          // Determine if this is a multi-coordinate location
          let isMultiCoord = false;
          let coordCount = 1;
          
          if (Array.isArray(location.coordinates)) {
            // Check if it's a single coordinate pair [x, y]
            if (location.coordinates.length === 2 && typeof location.coordinates[0] === 'number') {
              isMultiCoord = false;
            } 
            // Must be an array of coordinate pairs
            else {
              isMultiCoord = true;
              coordCount = location.coordinates.length;
            }
          }
          
          if (isMultiCoord && coordCount > 1) {
            // First add the wildcard option for the entire marker (for all users)    
            choices.push({
              name: `${location.name} * (All ${coordCount} points)`,
              value: `${location.name}|*`
            });
            
            // Then add individual coordinate options
            for (let i = 0; i < coordCount; i++) {
              choices.push({
                name: `${location.name} #${i+1}`,
                value: `${location.name}|${i}`
              });
            }
          } else {
            // Regular single-coordinate location
            choices.push({
              name: `${location.name} (${location.type})`,
              value: `${location.name}`
            });
          }
        }
        
        await interaction.respond(choices);
      }
    }
  } catch (error) {
    console.error('Error handling autocomplete:', error);
    // Respond with empty choices on error to prevent Discord API timeout
    await interaction.respond([]);
  }
});

// Helper function to parse marker name and index from selection
function parseMarkerSelection(selection) {
  // Check if this is a composite value with an index
  if (selection.includes('|')) {
    const [name, indexStr] = selection.split('|');
    const index = indexStr === '*' ? '*' : parseInt(indexStr, 10);
    return { name, index };
  }
  
  // Regular marker without index specification
  return { name: selection, index: undefined };
}

// Handle marker editing with improved wildcard support
async function handleEditMarker(interaction) {
  const markerSelection = interaction.options.getString('name');
  let markerName, coordIndex;
  
  // Parse the marker selection
  const parsedSelection = parseMarkerSelection(markerSelection);
  markerName = parsedSelection.name;
  coordIndex = parsedSelection.index;
  
  // Check if marker exists
  const marker = await prisma.location.findFirst({
    where: { name: markerName }
  });
  
  if (!marker) {
    await interaction.reply({
      content: `Marker "${markerName}" not found.`,
      ephemeral: true
    });
    return;
  }
  
  // Determine if this is a multi-coordinate marker
  const isMultiCoord = Array.isArray(marker.coordinates) && 
    !(marker.coordinates.length === 2 && typeof marker.coordinates[0] === 'number');
  
  // Prepare the modal title based on selection
  let modalTitle;
  if (coordIndex === '*') {
    modalTitle = `Edit All Points: ${markerName}`;
  } else if (isMultiCoord && coordIndex !== undefined) {
    modalTitle = `Edit Point #${parseInt(coordIndex) + 1}: ${markerName}`;
  } else {
    modalTitle = `Edit Marker: ${markerName}`;
  }
  
  // Create a modal for editing the marker
  const modal = new ModalBuilder()
    .setCustomId(`edit_marker_${marker.id}_${coordIndex === undefined ? '' : coordIndex}`) // Ensure coordIndex is string or empty
    .setTitle(modalTitle);
  
  // Add input fields with current values
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Name')
    .setStyle(TextInputStyle.Short)
    .setValue(marker.name)
    .setRequired(true);
  
  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(marker.description || '')
    .setRequired(true);
  
  const typeInput = new TextInputBuilder()
    .setCustomId('type')
    .setLabel('Type')
    .setStyle(TextInputStyle.Short)
    .setValue(marker.type || '')
    .setRequired(true);
  
  const iconInput = new TextInputBuilder()
    .setCustomId('icon')
    .setLabel('Icon (e.g., fa-solid fa-house)')
    .setStyle(TextInputStyle.Short)
    .setValue(marker.icon || '')
    .setRequired(false);
  
  // Format coordinates field based on selection
  let coordsValue = '';
  if (coordIndex === '*') {
    // For wildcard, show all coordinates
    coordsValue = formatStoredCoordinatesToString(marker.coordinates);
  } else if (isMultiCoord && coordIndex !== undefined) {
    // For specific index, show only that coordinate
    const coordData = marker.coordinates[parseInt(coordIndex)];
    if (Array.isArray(coordData) && coordData.length === 2) {
      coordsValue = `[${coordData[0]}, ${coordData[1]}]`;
    } else if (coordData && typeof coordData === 'object' && coordData.coordinates) { // Check if it's an object with coordinates property
      coordsValue = `[${coordData.coordinates[0]}, ${coordData.coordinates[1]}]`;
    }
  } else {
    // Single coordinate, show as is
    coordsValue = formatStoredCoordinatesToString(marker.coordinates);
  }
  
  const coordsInput = new TextInputBuilder()
    .setCustomId('coordinates')
    .setLabel('Coordinates')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(coordsValue)
    .setRequired(true);
  
  // Add rows to modal
  const nameRow = new ActionRowBuilder().addComponents(nameInput);
  const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
  const typeRow = new ActionRowBuilder().addComponents(typeInput);
  const iconRow = new ActionRowBuilder().addComponents(iconInput);
  const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
  
  modal.addComponents(nameRow, descriptionRow, typeRow, iconRow, coordsRow);
  
  // Show the modal
  await interaction.showModal(modal);
}

// Updated handler for removing markers (this was previously mixed with handleEditMarker)
async function handleRemoveMarker(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const markerSelection = interaction.options.getString('name');
  const { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
  // Check if marker exists
  const marker = await prisma.location.findFirst({
    where: { name: markerName }
  });
  
  if (!marker) {
    await interaction.editReply(`Marker "${markerName}" not found.`);
    return;
  }
  
  // Determine if this is a multi-coordinate marker
  const isMultiCoord = Array.isArray(marker.coordinates) && 
    !(marker.coordinates.length === 2 && typeof marker.coordinates[0] === 'number');
  
  // If this is a multi-coordinate marker and we have a specific index
  if (isMultiCoord && coordIndex !== undefined && coordIndex !== '*') {
    // Confirm deletion of specific coordinate
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_delete_coord_${marker.id}_${coordIndex}`)
          .setLabel(`Delete Point #${coordIndex + 1}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_delete_marker')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
    await interaction.editReply({
      content: `Are you sure you want to delete coordinate #${coordIndex + 1} from marker "${markerName}"?`,
      components: [row]
    });
  } 
  // If this is deleting the entire marker or a single-coordinate marker
  else {
    // Confirm deletion of entire marker
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_delete_marker_${marker.id}`)
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_delete_marker')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
    
    await interaction.editReply({
      content: `Are you sure you want to delete the marker "${markerName}"? This action cannot be undone.`,
      components: [row]
    });
  }
}

// Handle modal submissions for editing markers
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;

  try {
    // Handle edit marker modals (from admin command)
    if (interaction.customId.startsWith('edit_marker_')) {
      const customIdParts = interaction.customId.split('_');
      const markerId = customIdParts[2];
      // Correctly handle coordIndex potentially being empty string or '*'
      const coordIndexStr = customIdParts.length > 3 ? customIdParts[3] : ''; 
      const coordIndex = (coordIndexStr === '' || coordIndexStr === undefined) ? undefined : (coordIndexStr === '*' ? '*' : parseInt(coordIndexStr));

      // Get values from modal
      const name = interaction.fields.getTextInputValue('name');
      const description = interaction.fields.getTextInputValue('description');
      const type = interaction.fields.getTextInputValue('type');
      const icon = interaction.fields.getTextInputValue('icon');
      const coordsString = interaction.fields.getTextInputValue('coordinates');
      
      // Get the original marker for comparison and validation
      const marker = await prisma.location.findUnique({
        where: { id: markerId }
      });
      
      if (!marker) {
        await interaction.reply({ 
          content: 'Marker not found. It may have been deleted.',
          ephemeral: true 
        });
        return;
      }
      
      // Validate coordinates
      if (!validateCoordinates(coordsString)) {
        await interaction.reply({ 
          content: 'Invalid coordinates format. Please use [X, Y] format, multiple coordinates can be comma-separated.',
          ephemeral: true 
        });
        return;
      }
      
      // Parse and format coordinates
      const { coordinates } = formatCoordinates(coordsString);
      
      // Prepare update data
      const updateData = {
        name,
        description,
        type,
        icon,
        lastModified: new Date(),
        coordinates: marker.coordinates // Default to original coordinates
      };
      
      // Handle coordinates based on selection type
      if (coordIndex === '*') {
        // Update all coordinates
        updateData.coordinates = coordinates.length === 1 
          ? [coordinates[0].x, coordinates[0].y]  // Single coordinate pair
          : coordinates.map(c => [c.x, c.y]);     // Array of coordinate pairs
      } else if (coordIndex !== undefined && typeof coordIndex === 'number') {
        // Update specific coordinate in multi-coordinate marker
        // Ensure marker.coordinates is an array before trying to spread it
        if (Array.isArray(marker.coordinates)) {
            const newCoordinates = [...marker.coordinates];
            if (coordinates.length > 0 && coordIndex >= 0 && coordIndex < newCoordinates.length) {
              newCoordinates[coordIndex] = [coordinates[0].x, coordinates[0].y];
              updateData.coordinates = newCoordinates;
            } else {
                console.warn(`Invalid coordinate index or data for update: index=${coordIndex}, data=${JSON.stringify(coordinates)}`);
                // Optionally reply to user about invalid index/data
            }
        } else {
            console.warn(`Attempted to update specific index on non-array coordinates for marker ${markerId}`);
            // Optionally reply to user
        }
      } else {
        // Single coordinate marker or index is undefined (should mean single coord marker)
        updateData.coordinates = coordinates.length === 1 
          ? [coordinates[0].x, coordinates[0].y]  // Single coordinate pair
          : coordinates.map(c => [c.x, c.y]);     // Array of coordinate pairs
      }
      
      // Check if updated name conflicts with an existing marker
      if (updateData.name && updateData.name !== marker.name) {
        const existingMarker = await prisma.location.findFirst({
          where: {
            name: updateData.name,
            id: { not: markerId }
          }
        });
        
        if (existingMarker) {
          await interaction.reply({
            content: `A different marker with the name "${updateData.name}" already exists. Please choose a unique name.`,
            ephemeral: true
          });
          return;
        }
      }
      
      await interaction.deferReply({ ephemeral: true });
      
      // Generate diff for visualization
      const diffText = generateEditDiff(marker, updateData);
      
      // Create an embed with the diff for confirmation
      const embed = new EmbedBuilder()
        .setTitle(`Marker Edit: ${marker.name}`)
        .setColor('#FFA500')
        .setDescription('Review the changes below before confirming:')
        .addFields({ name: 'Changes', value: diffText })
        .setFooter({ text: `Marker ID: ${marker.id}` })
        .setTimestamp();
      
      // Create confirmation buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_edit_${markerId}_${Buffer.from(JSON.stringify(updateData)).toString('base64')}`)
            .setLabel('Confirm Changes')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('cancel_edit')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    }
    // ... other modal handlers ...
  } catch (error) {
    console.error('Error handling modal submission:', error);
    try {
      const replyMethod = interaction.deferred ? interaction.editReply : interaction.reply;
      await replyMethod.call(interaction, { 
        content: `An error occurred: ${error.message}`,
        ephemeral: true 
      });
    } catch (followupError) {
      console.error('Error sending error response:', followupError);
    }
  }
});

// Generate a diff visualization for edits
function generateEditDiff(originalData, newData) {
  let diff = '```diff\n';
  
  // Compare name
  if (originalData.name !== newData.name) {
    diff += `- Name: ${originalData.name}\n+ Name: ${newData.name}\n\n`;
  }
  
  // Compare type
  if (originalData.type !== newData.type) {
    diff += `- Type: ${originalData.type}\n+ Type: ${newData.type}\n\n`;
  }
  
  // Compare description (truncate if too long)
  if (originalData.description !== newData.description) {
    const oldDesc = truncateText(originalData.description, 100);
    const newDesc = truncateText(newData.description, 100);
    diff += `- Description: ${oldDesc}\n+ Description: ${newDesc}\n\n`;
  }
  
  // Compare icon
  if (originalData.icon !== newData.icon) {
    diff += `- Icon: ${originalData.icon || 'none'}\n+ Icon: ${newData.icon || 'none'}\n\n`;
  }
  
  // Compare coordinates
  const oldCoords = formatStoredCoordinatesToString(originalData.coordinates).replace(/\n/g, ', ');
  const newCoords = formatStoredCoordinatesToString(newData.coordinates).replace(/\n/g, ', ');
  
  if (oldCoords !== newCoords) {
    diff += `- Coordinates: ${oldCoords}\n+ Coordinates: ${newCoords}\n\n`;
  }
  
  diff += '```';
  
  // If no changes, show a message
  if (diff === '```diff\n```') {
    return 'No changes detected.';
  }
  
  return diff;
}

// Helper function to truncate text
function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

// Helper function to format stored coordinates to string
function formatStoredCoordinatesToString(coordinates) {
  if (!Array.isArray(coordinates)) {
    return '';
  }
  
  if (coordinates.length === 2 && typeof coordinates[0] === 'number') {
    return `[${coordinates[0]}, ${coordinates[1]}]`;
  }
  
  return coordinates.map(coord => `[${coord[0]}, ${coord[1]}]`).join('\n');
}

// Handle button interactions for specific coordinate deletion
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  try {
    // Handle confirm delete coordinate button
    if (interaction.customId.startsWith('confirm_delete_coord_')) {
      // Parse the marker ID and coordinate index
      const parts = interaction.customId.split('_');
      const markerId = parts[3];
      const coordIndex = parseInt(parts[4], 10);
      
      // Check if user has admin role
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasAdminRole = member.roles.cache.has(ADMIN_ROLE_ID);
      
      if (!hasAdminRole) {
        await interaction.reply({ 
          content: 'You do not have permission to delete marker coordinates.',
          ephemeral: true 
        });
        return;
      }
      
      // Get marker info
      const marker = await prisma.location.findUnique({
        where: { id: markerId }
      });
      
      if (!marker) {
        await interaction.update({ 
          content: 'Marker not found or already deleted.',
          components: [] 
        });
        return;
      }
      
      // Remove the specific coordinate
      const newCoordinates = [...marker.coordinates];
      if (coordIndex >= 0 && coordIndex < newCoordinates.length) {
        newCoordinates.splice(coordIndex, 1);
        
        // If all coordinates are removed, delete the marker
        if (newCoordinates.length === 0) {
          await prisma.location.delete({
            where: { id: markerId }
          });
          
          await interaction.update({ 
            content: `All coordinates removed. Marker "${marker.name}" has been deleted.`,
            components: [] 
          });
        } else {
          // Update with remaining coordinates
          await prisma.location.update({
            where: { id: markerId },
            data: {
              coordinates: newCoordinates.length === 1 ? newCoordinates[0] : newCoordinates,
              lastModified: new Date()
            }
          });
          
          await interaction.update({ 
            content: `Coordinate #${coordIndex + 1} removed from marker "${marker.name}".`,
            components: [] 
          });
        }
        
        // Notify web application of the change
        await notifyDatabaseChange();
      } else {
        await interaction.update({ 
          content: `Invalid coordinate index. The marker "${marker.name}" only has ${marker.coordinates.length} coordinate points.`,
          components: [] 
        });
      }
    }
  } catch (error) {
    console.error('Error handling button interaction:', error);
    try {
      await interaction.reply({ 
        content: `An error occurred: ${error.message}`,
        ephemeral: true 
      });
    } catch (replyError) {
      console.error('Could not send error response:', replyError);
    }
  }
});

// Add graceful shutdown handler for Prisma
process.on('SIGINT', async () => {
  console.log('Received SIGINT, closing database connection...');
  try {
    await closeDatabase();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, closing database connection...');
  try {
    await closeDatabase();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Login with token
client.login(TOKEN).catch(error => {
  console.error('Failed to login:', error);
});
