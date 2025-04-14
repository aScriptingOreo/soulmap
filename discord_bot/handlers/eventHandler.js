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
            flags: 64 // Use flags instead of ephemeral
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
            flags: 64 // Use flags instead of ephemeral
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
            flags: 64 // Use flags instead of ephemeral
          });
        } catch (followupError) {
          console.error('Failed to send error response for modal:', followupError);
          
          // If the error is because we've already replied, try to follow up instead
          try {
            await interaction.followUp({
              content: 'An error occurred while processing your submission. Please try again later.',
              flags: 64 // Use flags instead of ephemeral
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
        
        // Get locations from database
        const locations = await searchLocationsForAutocomplete(searchTerm);
        
        // Group locations by name to avoid duplicates (keep only unique names)
        const locationMap = new Map();
        
        // First pass: collect all unique locations
        for (const loc of locations) {
          const key = loc.name.toLowerCase();
          
          // If we found a multi-coordinate location, prefer it over single ones
          if (!locationMap.has(key) || (loc.isMultiCoord && !locationMap.get(key).isMultiCoord)) {
            locationMap.set(key, loc);
          }
        }
        
        const choices = [];
        
        // Second pass: create choice options - only include the main location name without indices
        for (const location of locationMap.values()) {
          // Simple location entry - always just use the base name
          choices.push({
            name: location.name,
            value: location.name
          });
        }
        
        // Sort choices to prioritize exact matches
        choices.sort((a, b) => {
          const aNameLower = a.name.toLowerCase();
          const bNameLower = b.name.toLowerCase();
          const searchTermLower = searchTerm.toLowerCase();
          
          // Check for exact match first
          if (aNameLower === searchTermLower && bNameLower !== searchTermLower) return -1;
          if (aNameLower !== searchTermLower && bNameLower === searchTermLower) return 1;
          
          // Then check for starts with
          if (aNameLower.startsWith(searchTermLower) && !bNameLower.startsWith(searchTermLower)) return -1;
          if (!aNameLower.startsWith(searchTermLower) && bNameLower.startsWith(searchTermLower)) return 1;
          
          // Default to alphabetical
          return a.name.localeCompare(b.name);
        });
        
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
        
        // Group locations by name to avoid duplicates
        const locationMap = new Map();
        
        // First pass: collect all unique locations
        for (const loc of locations) {
          const key = loc.name.toLowerCase();
          
          // If we found a multi-coordinate location, prefer it over single ones
          if (!locationMap.has(key) || (loc.isMultiCoord && !locationMap.get(key).isMultiCoord)) {
            locationMap.set(key, loc);
          }
        }
        
        // Second pass: create choice options
        for (const location of locationMap.values()) {
          // Basic location entry
          choices.push({
            name: location.name,
            value: location.name
          });
        }
        
        await interaction.respond(choices.slice(0, 25)); // Discord limit is 25 choices
      }
    }
  } catch (error) {
    console.error('Error handling autocomplete:', error);
    // Respond with empty choices on error
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
