const { handleSlashCommand } = require('./commandHandler');
const { handleButtonInteraction } = require('./buttonHandler');
const { handleModalSubmit } = require('./modalHandler');
const { handleSelectMenuInteraction } = require('./selectMenuHandler');
const { updateLeaderboard } = require('../modules/leaderboard');
const { syncDatabase } = require('../modules/requests');
const { parseMarkerSelection } = require('../modules/utils');

/**
 * Centralized event handler for Discord interactions
 */
function setupEventHandlers(client, prisma, dbFunctions, config) {
  // Handle slash commands
  client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
      try {
        await handleSlashCommand(interaction, client, prisma, dbFunctions, config);
      } catch (error) {
        console.error(`Error handling slash command ${interaction.commandName}:`, error);
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
    }
  });

  // Handle button interactions
  client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
      try {
        // Pass client, prisma, dbFunctions, and config to the handler
        await handleButtonInteraction(interaction, client, prisma, dbFunctions, config);
      } catch (error) {
        console.error(`Error handling button interaction ${interaction.customId}:`, error);
        try {
          await interaction.reply({ 
            content: 'An error occurred while processing this button action.',
            ephemeral: true 
          });
        } catch (followupError) {
          console.error('Error sending button error response:', followupError);
        }
      }
    }
  });

  // Handle modal submissions
  client.on('interactionCreate', async interaction => {
    if (interaction.isModalSubmit()) {
      try {
        console.log(`Modal submission received: ${interaction.customId}`);
        
        // More detailed logging to help with debugging
        const modalData = {};
        interaction.fields.fields.forEach((value, key) => {
          modalData[key] = value.value;
        });
        console.log('Modal submission data:', modalData);
        
        await handleModalSubmit(interaction, prisma, dbFunctions);
      } catch (error) {
        console.error(`Error handling modal submission ${interaction.customId}:`, error);
        try {
          // Always respond to the interaction to prevent it from hanging
          await interaction.reply({ 
            content: 'An error occurred while processing your submission. Please try again later.',
            ephemeral: true 
          });
        } catch (followupError) {
          console.error('Failed to send error response for modal:', followupError);
          
          // If the error is because we've already replied, try to follow up instead
          try {
            await interaction.followUp({
              content: 'An error occurred while processing your submission. Please try again later.',
              ephemeral: true
            });
          } catch (finalError) {
            console.error('Could not send any response for error:', finalError);
          }
        }
      }
    }
  });

  // Handle select menu interactions
  client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu()) {
      try {
        // Pass prisma AND dbFunctions to handleSelectMenuInteraction
        await handleSelectMenuInteraction(interaction, prisma, dbFunctions);
      } catch (error) {
        console.error(`Error handling select menu ${interaction.customId}:`, error);
        try {
          await interaction.update({
            content: `An error occurred: ${error.message}`,
            components: [],
            embeds: []
          });
        } catch (updateError) {
          console.error('Error sending error response for select menu:', updateError);
          try {
            // Use flags instead of ephemeral
            await interaction.reply({
              content: `An error occurred: ${error.message}`,
              flags: 64  // Use flags instead of ephemeral: true
            });
          } catch (replyError) {
            console.error('Could not respond to interaction:', replyError);
          }
        }
      }
    }
  });

  // Handle autocomplete interactions
  client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
      try {
        await handleAutocomplete(interaction, dbFunctions, config);
      } catch (error) {
        console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
        // Don't send a response for autocomplete errors, just log them
        // Discord will just show no results
      }
    }
  });

  // Ready event
  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    try {
      await handleReady(client, dbFunctions, config);
    } catch (error) {
      console.error('Error in ready event handler:', error);
    }
  });
}

/**
 * Handle autocomplete interactions
 */
async function handleAutocomplete(interaction, dbFunctions, config) {
  const { searchLocationsForAutocomplete } = dbFunctions;
  const { ADMIN_ROLE_ID } = config;
  
  try {
    // Handle admin and request edit/remove autocomplete
    if (interaction.commandName === 'admin' || 
       (interaction.commandName === 'request' && 
        (interaction.options.getSubcommand() === 'edit' || interaction.options.getSubcommand() === 'remove'))) {
      
      const focusedOption = interaction.options.getFocused(true);
      
      if (focusedOption.name === 'name') {
        const searchTerm = focusedOption.value.toLowerCase();
        const isAdminCommand = interaction.commandName === 'admin';
        
        // Check if user has admin role for admin commands
        let isAdmin = false;
        if (isAdminCommand) {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          isAdmin = member.roles.cache.has(ADMIN_ROLE_ID);
        }
        
        // Use our new database function instead of direct Prisma access
        const locations = await searchLocationsForAutocomplete(searchTerm);
        
        const choices = [];
        
        // Process each location and format options
        for (const location of locations) {
          // Determine if this is a multi-coordinate location
          let isMultiCoord = false;
          let coordCount = 1;
          
          try {
            if (location.coordinates) {
              // Parse coordinates if they're stored as a string
              const coords = typeof location.coordinates === 'string' 
                ? JSON.parse(location.coordinates) 
                : location.coordinates;
                
              // Check if it's a single coordinate pair [x, y]
              if (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number') {
                isMultiCoord = false;
              } 
              // Must be an array of coordinate pairs
              else if (Array.isArray(coords) && coords.length > 0) {
                isMultiCoord = true;
                coordCount = coords.length;
              }
            }
          } catch (parseError) {
            console.error('Error parsing coordinates for autocomplete:', parseError);
            isMultiCoord = false;
            coordCount = 1;
          }
          
          if (isMultiCoord && coordCount > 1) {
            // First add the wildcard option for the entire marker
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
              name: `${location.name} (${location.type || 'unknown'})`,
              value: `${location.name}`
            });
          }
        }
        
        await interaction.respond(choices.slice(0, 25)); // Discord limit is 25 choices
      }
    }
    // Handle whereis command autocomplete
    else if (interaction.commandName === 'whereis') {
      const focusedOption = interaction.options.getFocused(true);
      
      if (focusedOption.name === 'location') {
        const searchTerm = focusedOption.value.toLowerCase();
        
        // Get locations from database
        const locations = await searchLocationsForAutocomplete(searchTerm);
        
        const choices = [];
        
        // Process each location and format options
        for (const location of locations) {
          // Determine if this is a multi-coordinate location
          let isMultiCoord = false;
          let coordCount = 1;
          
          try {
            if (location.coordinates) {
              // Parse coordinates if they're stored as a string
              const coords = typeof location.coordinates === 'string' 
                ? JSON.parse(location.coordinates) 
                : location.coordinates;
                
              // Check if it's a single coordinate pair [x, y]
              if (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number') {
                isMultiCoord = false;
              } 
              // Must be an array of coordinate pairs
              else if (Array.isArray(coords) && coords.length > 0) {
                isMultiCoord = true;
                coordCount = coords.length;
              }
            }
          } catch (parseError) {
            console.error('Error parsing coordinates for autocomplete:', parseError);
            isMultiCoord = false;
            coordCount = 1;
          }
          
          if (isMultiCoord && coordCount > 1) {
            // Main location entry
            choices.push({
              name: `${location.name} (${location.type || 'unknown'})`,
              value: location.name
            });
            
            // Add individual coordinate points
            for (let i = 0; i < Math.min(coordCount, 10); i++) {
              choices.push({
                name: `${location.name} #${i+1} (Specific point)`,
                value: `${location.name} #${i+1}`
              });
            }
          } else {
            // Regular single-coordinate location
            choices.push({
              name: `${location.name} (${location.type || 'unknown'})`,
              value: location.name
            });
          }
        }
        
        await interaction.respond(choices.slice(0, 25)); // Discord limit is 25 choices
      }
    }
  } catch (error) {
    console.error('Error handling autocomplete:', error);
    // Respond with empty choices on error to prevent Discord API timeout
    await interaction.respond([]);
  }
}

/**
 * Handle client ready event
 */
async function handleReady(client, dbFunctions, config) {
  const { CHANNEL_ID, LEADERBOARD_CHANNEL_ID } = config;

  // Validate channel IDs
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
  
  try {
    // Initialize leaderboard
    await updateLeaderboard(client, dbFunctions.getContributorLeaderboard, 
                          dbFunctions.getLeaderboardInfo, dbFunctions.setLeaderboardInfo, 
                          LEADERBOARD_CHANNEL_ID);
    
    // Sync database on startup (after a short delay to ensure everything is loaded)
    setTimeout(() => syncDatabase(client, dbFunctions.getAllRequests, 
                                dbFunctions.deleteRequestByMessageId, CHANNEL_ID), 10000);
    
    // Schedule daily sync (24 hours)
    setInterval(() => syncDatabase(client, dbFunctions.getAllRequests, 
                                 dbFunctions.deleteRequestByMessageId, CHANNEL_ID), 24 * 60 * 60 * 1000);
    
    console.log('Bot initialization complete.');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

module.exports = {
  setupEventHandlers
};
