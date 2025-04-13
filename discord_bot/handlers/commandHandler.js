const { EmbedBuilder } = require('discord.js');
const { getMapVersionInfo } = require('../modules/utils');
const { handleRequestNew, handleRequestEdit, handleRequestRemove } = require('../modules/requests');
const { handleSoulmapNew, handleSoulmapEdit, handleSoulmapDelete, handleEditMarker, handleAdminUndo, handleAdminInfo } = require('../modules/admin');

/**
 * Handle slash command interactions
 */
async function handleSlashCommand(interaction, client, prisma, dbFunctions, config) {
  const { getRequestsByStatus, getAllRequests, notifyDatabaseChange } = dbFunctions;
  const { CHANNEL_ID, ADMIN_ROLE_ID } = config;

  try {
    // Handle request command and its subcommands
    if (interaction.commandName === 'request') {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'new':
          await handleRequestNew(interaction, client, prisma, dbFunctions.saveRequest, CHANNEL_ID);
          break;
        case 'edit':
          // Fix parameter passing - pass searchLocationsForAutocomplete
          await handleRequestEdit(interaction, prisma, dbFunctions.searchLocationsForAutocomplete);
          break;
        case 'remove':
          await handleRequestRemove(interaction, prisma);
          break;
      }
    }
    // Handle admin command and its subcommands
    else if (interaction.commandName === 'admin') {
      await handleAdminCommand(interaction, prisma, dbFunctions, config);
    }
    // Handle listrequests command
    else if (interaction.commandName === 'listrequests') {
      // Check if user has admin role
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasAdminRole = member.roles.cache.has(ADMIN_ROLE_ID);
      
      if (!hasAdminRole) {
        await interaction.reply({ 
          content: 'You do not have permission to use this command.', 
          ephemeral: true 
        });
        return;
      }
      
      await handleListRequests(interaction, client, getRequestsByStatus, getAllRequests, dbFunctions.safeMessageFetch, CHANNEL_ID);
    }
    // Handle importlocations command (placeholder)
    else if (interaction.commandName === 'importlocations') {
      // Import locations implementation would go here
      await interaction.reply({ 
        content: 'Import locations functionality is not implemented yet.', 
        ephemeral: true 
      });
    }
    // Handle whereis command (accessible to everyone)
    else if (interaction.commandName === 'whereis') {
      await handleWhereIs(interaction, dbFunctions.searchLocationsForAutocomplete);
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
}

/**
 * Handle the listrequests command
 */
async function handleListRequests(interaction, client, getRequestsByStatus, getAllRequests, safeMessageFetch, CHANNEL_ID) {
  try {
    // Get status filter
    const status = interaction.options.getString('status') || 'pending';
    
    // Get requests based on status
    let requests;
    if (status === 'all') {
      requests = await getAllRequests(); // Make sure to await the result
    } else {
      requests = await getRequestsByStatus(status); // Make sure to await the result
    }
    
    // Validate requests is an array
    if (!Array.isArray(requests)) {
      console.error('Expected array of requests but got:', typeof requests);
      requests = []; // Ensure requests is an array
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
        text: `SoulMap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Showing ${Math.min(requests.length, 10)} of ${requests.length} requests` 
      });
      
    // Add up to 10 requests to the embed
    const displayRequests = requests.slice(0, 10); // This line caused the error if requests is not an array
    for (const request of displayRequests) {
      embed.addFields({
        name: `Request #${request.id || 'Unknown'}`,
        value: `**Coordinates:** ${request.coordinates || 'N/A'}\n` +
               `**Description:** ${request.description ? request.description.substring(0, 100) + (request.description.length > 100 ? '...' : '') : 'N/A'}\n` +
               `**Status:** ${request.status || 'N/A'}\n` +
               `**Date:** ${request.created_at ? new Date(request.created_at).toLocaleString() : 'N/A'}\n` +
               `[Jump to Message](https://discord.com/channels/${interaction.guild.id}/${CHANNEL_ID}/${request.message_id})`
      });
    }
    
    // Use flags instead of ephemeral parameter to fix deprecation warning
    await interaction.reply({ 
      embeds: [embed], 
      flags: 64 // This is the value for the EPHEMERAL flag
    });
  } catch (error) {
    console.error('Error listing requests:', error);
    await interaction.reply({ 
      content: 'An error occurred while retrieving requests.', 
      flags: 64
    });
  }
}

/**
 * Handle the whereis command to get map link for a location
 */
async function handleWhereIs(interaction, searchLocationsForAutocomplete) {
  const locationName = interaction.options.getString('location');
  
  try {
    // Defer reply while we search
    await interaction.deferReply({ ephemeral: false }); // Not ephemeral so results are shared with channel
    
    // Parse for potential index selection
    const indexMatch = locationName.match(/(.+)\s+#(\d+)$/);
    let baseName = locationName;
    let specificIndex = undefined;
    
    if (indexMatch) {
      baseName = indexMatch[1].trim();
      specificIndex = parseInt(indexMatch[2]) - 1; // Convert to 0-based index
    }
    
    // Search for the location
    const locations = await searchLocationsForAutocomplete(baseName);
    
    // Find exact match or handle index-specific selection
    let locationMatch;
    
    if (specificIndex !== undefined) {
      // Look for the location with the specific index
      locationMatch = locations.find(loc => 
        loc.name.toLowerCase() === baseName.toLowerCase()
      );
    } else {
      // Regular exact match first, then fallback to first result
      locationMatch = locations.find(loc => 
        loc.name.toLowerCase() === locationName.toLowerCase()
      ) || locations[0];
    }
    
    if (!locationMatch) {
      await interaction.editReply(`❌ Location "${locationName}" not found.`);
      return;
    }
    
    // Extract coordinates
    let coordinateLinks = [];
    try {
      const coords = locationMatch.coordinates;
      
      // Handle specific index request for multi-coordinate locations
      if (specificIndex !== undefined) {
        // Multiple coordinates with specific index request
        if (Array.isArray(coords)) {
          if (coords.length === 2 && typeof coords[0] === 'number') {
            // This is a single coordinate pair
            const [x, y] = coords;
            coordinateLinks.push(`[View on map](https://soulmap.avakot.org/?coord=${x},${y})`);
          } else if (specificIndex >= 0 && specificIndex < coords.length && 
                     Array.isArray(coords[specificIndex]) && coords[specificIndex].length === 2) {
            // This is a multi-coordinate location, get specific point
            const [x, y] = coords[specificIndex];
            coordinateLinks.push(`[View point #${specificIndex+1} on map](https://soulmap.avakot.org/?coord=${x},${y})`);
          }
        }
      } else {
        // Handle different coordinate formats without specific index
        if (Array.isArray(coords)) {
          if (coords.length === 2 && typeof coords[0] === 'number') {
            // Single coordinate pair
            const [x, y] = coords;
            coordinateLinks.push(`[View on map](https://soulmap.avakot.org/?coord=${x},${y})`);
          } else if (coords.length > 0) {
            // Multiple coordinates - get first 5 to avoid cluttering the response
            const maxCoords = Math.min(coords.length, 5);
            for (let i = 0; i < maxCoords; i++) {
              if (Array.isArray(coords[i]) && coords[i].length === 2) {
                const [x, y] = coords[i];
                coordinateLinks.push(`[Point #${i+1}](https://soulmap.avakot.org/?coord=${x},${y})`);
              }
            }
            
            if (coords.length > 5) {
              coordinateLinks.push(`*...and ${coords.length - 5} more points*`);
            }
          }
        } else if (typeof coords === 'string') {
          // Try to parse string as JSON
          try {
            const parsedCoords = JSON.parse(coords);
            if (Array.isArray(parsedCoords)) {
              // Handle like above
              if (parsedCoords.length === 2 && typeof parsedCoords[0] === 'number') {
                const [x, y] = parsedCoords;
                coordinateLinks.push(`[View on map](https://soulmap.avakot.org/?coord=${x},${y})`);
              } else {
                // Multiple coordinates - get first 5
                const maxCoords = Math.min(parsedCoords.length, 5);
                for (let i = 0; i < maxCoords; i++) {
                  if (Array.isArray(parsedCoords[i]) && parsedCoords[i].length === 2) {
                    const [x, y] = parsedCoords[i];
                    coordinateLinks.push(`[Point #${i+1}](https://soulmap.avakot.org/?coord=${x},${y})`);
                  }
                }
                
                if (parsedCoords.length > 5) {
                  coordinateLinks.push(`*...and ${parsedCoords.length - 5} more points*`);
                }
              }
            }
          } catch (e) {
            console.error('Error parsing coordinates string:', e);
          }
        }
      }
    } catch (e) {
      console.error('Error processing coordinates for location:', e);
    }
    
    if (coordinateLinks.length === 0) {
      coordinateLinks.push('*No valid coordinates found for this location*');
    }
    
    // Create embed with location information
    const embed = new EmbedBuilder()
      .setTitle(`📍 ${locationMatch.name}${specificIndex !== undefined ? ` (Point #${specificIndex+1})` : ''}`)
      .setColor('#3498db')
      .setDescription(locationMatch.description || '*No description available*')
      .addFields(
        { name: 'Type', value: locationMatch.type || 'Unknown', inline: true },
        { name: 'Map Links', value: coordinateLinks.join('\n'), inline: false }
      )
      .setFooter({ text: 'SoulMap Location Finder' })
      .setTimestamp();
      
    await interaction.editReply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Error in whereis command:', error);
    await interaction.editReply('An error occurred while searching for this location.');
  }
}

/**
 * Handle admin command and its subcommands
 */
async function handleAdminCommand(interaction, prisma, dbFunctions, config) {
  // Check if user has admin role
  if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
    return await interaction.reply({
      content: 'You need admin permissions to use this command.',
      ephemeral: true
    });
  }
  
  const subcommand = interaction.options.getSubcommand();
  
  if (subcommand === 'undo') {
    await handleAdminUndo(interaction, prisma, dbFunctions);
  } else if (subcommand === 'info') {
    await handleAdminInfo(interaction, prisma, dbFunctions);
  } else {
    await interaction.reply({
      content: `Unknown admin subcommand: ${subcommand}`,
      ephemeral: true
    });
  }
}

module.exports = {
  handleSlashCommand
};
