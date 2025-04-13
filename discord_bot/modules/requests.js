const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { getMapVersionInfo, validateCoordinates, formatCoordinates, generateMapLinks, parseMarkerSelection } = require('./utils');

/**
 * Handler for /request new
 */
async function handleRequestNew(interaction, client, prisma, saveRequest, CHANNEL_ID) {
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
  const existingLocation = await prisma.Location.findFirst({
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

/**
 * Handler for /request edit
 */
async function handleRequestEdit(interaction, prisma, searchLocationsForAutocomplete) {
  const markerSelection = interaction.options.getString('name');
  
  // Parse marker name and index if provided
  let { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
  try {
    // Get marker info from the database using searchLocationsForAutocomplete
    const locations = await searchLocationsForAutocomplete(markerName);
    const marker = locations.find(loc => loc.name.toLowerCase() === markerName.toLowerCase());
    
    if (!marker) {
      await interaction.reply({ 
        content: `Marker "${markerName}" not found.`,
        ephemeral: true 
      });
      return;
    }

    // Create an embed with marker information
    const embed = new EmbedBuilder()
      .setTitle(`Marker Information: ${marker.name}`)
      .setColor('#3498db')
      .addFields(
        { name: 'Type', value: marker.type || 'Unknown', inline: true },
        { name: 'ID', value: marker.id || 'Unknown', inline: true }
      );

    // Add description if available
    if (marker.description) {
      embed.addFields({ 
        name: 'Description', 
        value: marker.description.length > 1024 ? 
          marker.description.substring(0, 1020) + '...' : 
          marker.description 
      });
    }

    // Process coordinates for display and determine if this is a multi-coordinate marker
    let isMultiCoord = false;
    let coordCount = 1;
    
    try {
      const coords = marker.coordinates;
      
      // Handle different coordinate formats
      if (Array.isArray(coords)) {
        if (coords.length === 2 && typeof coords[0] === 'number') {
          // Single coordinate pair
          const coordsString = `[${coords[0]}, ${coords[1]}]`;
          embed.addFields({ name: 'Coordinates', value: coordsString });
        } else {
          // Multiple coordinates
          isMultiCoord = true;
          coordCount = coords.length;
          
          if (coords.length > 10) {
            // If too many coordinates, show a summary
            embed.addFields({ name: 'Coordinates', value: `${coords.length} coordinate points (showing first 10)` });
            
            // Show first 10 coordinates
            const firstTen = coords.slice(0, 10).map((coord, index) => {
              if (Array.isArray(coord) && coord.length === 2) {
                return `${index + 1}. [${coord[0]}, ${coord[1]}]`;
              }
              return `${index + 1}. [Invalid format]`;
            });
            
            embed.addFields({ name: 'Preview', value: firstTen.join('\n') });
          } else {
            // Show all coordinates if 10 or fewer
            const allCoords = coords.map((coord, index) => {
              if (Array.isArray(coord) && coord.length === 2) {
                return `${index + 1}. [${coord[0]}, ${coord[1]}]`;
              }
              return `${index + 1}. [Invalid format]`;
            });
            
            embed.addFields({ name: 'Coordinates', value: allCoords.join('\n') });
          }
        }
      }
      // ...additional coordinate handling code...
    } catch (e) {
      console.error('Error processing coordinates:', e);
      embed.addFields({ name: 'Coordinates', value: 'Error processing coordinates' });
    }

    // Create components array for buttons and select menus
    const components = [];
    
    // For specific coordinate index edits, only show coordinate editing
    if (coordIndex !== undefined && coordIndex !== '*') {
      // Add button specifically for this coordinate
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`req_edit_coord_${marker.id}_${coordIndex}_${interaction.user.id}`)
            .setLabel(`Edit Coordinate #${parseInt(coordIndex) + 1}`)
            .setStyle(ButtonStyle.Primary)
        )
      );
    } else {
      // For wildcard or full marker edits, show a select menu of all editable fields
      const editFieldsMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_edit_field_${marker.id}_${coordIndex || '*'}_${interaction.user.id}`)
        .setPlaceholder('Select field to edit')
        .addOptions([
          {
            label: 'Name',
            description: 'Edit the marker name',
            value: 'name'
          },
          {
            label: 'Description',
            description: 'Edit the marker description',
            value: 'description'
          },
          {
            label: 'Type',
            description: 'Edit the marker type/category',
            value: 'type'
          },
          {
            label: 'Icon',
            description: 'Edit the marker icon',
            value: 'icon'
          },
          {
            label: 'Coordinates',
            description: isMultiCoord ? 'Edit all coordinates' : 'Edit the coordinates',
            value: 'coordinates'
          }
        ]);
      
      components.push(new ActionRowBuilder().addComponents(editFieldsMenu));

      // Also add a coordinate select menu for multi-coordinate markers if not using a specific index
      if (isMultiCoord && coordCount > 1 && coordIndex === undefined) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_coord_req_${marker.id}_${interaction.user.id}`)
          .setPlaceholder('Or select a specific coordinate to edit')
          .addOptions([
            {
              label: `All coordinates (${coordCount} points)`,
              description: 'Submit edit request for all coordinates',
              value: '*'
            },
            ...Array.from({ length: Math.min(coordCount, 24) }, (_, i) => ({
              label: `Coordinate #${i + 1}`,
              description: `Submit edit request for coordinate #${i + 1}`,
              value: i.toString()
            }))
          ]);
        
        components.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      // Add a cancel button
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cancel_edit_request`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }

    // For edit requests, show info and components
    await interaction.reply({
      embeds: [embed],
      content: "📝 Please select what you'd like to edit for this marker" + 
               (isMultiCoord && coordCount > 1 && coordIndex === undefined ? 
                ". You can edit a specific property or select a specific coordinate to edit." : 
                "."),
      components: components,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Error in handleRequestEdit:', error);
    await interaction.reply({
      content: 'An error occurred while retrieving marker information.',
      ephemeral: true
    });
  }
}

/**
 * Handler for /request remove
 */
async function handleRequestRemove(interaction, prisma) {
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
  const marker = await prisma.Location.findFirst({
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

  // Save the request to the database
  await dbFunctions.saveRequest(
    requestId,
    userId,
    marker.name,
    coordIndex !== 'all' ? JSON.stringify(marker.coordinates[parseInt(coordIndex)]) : '',
    description,
    null,
    'remove', // Using "remove" (not "remove_request")
    reason
  );
}

/**
 * Function to safely fetch a message, with database sync if message is missing
 */
async function safeMessageFetch(channel, messageId, deleteRequestByMessageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch (error) {
    if (error.code === 10008) { // Unknown Message error code
      console.log(`Message ${messageId} not found in Discord, removing from database`);
      await deleteRequestByMessageId(messageId);
      return null;
    }
    throw error; // Re-throw if it's a different error
  }
}

/**
 * Function to sync database on a schedule
 */
async function syncDatabase(client, getAllRequests, deleteRequestByMessageId, CHANNEL_ID) {
  try {
    console.log('Starting database sync...');
    
    // Get all requests
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
        const message = await safeMessageFetch(channel, request.message_id, deleteRequestByMessageId); 
        
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

module.exports = {
  handleRequestNew,
  handleRequestEdit,
  handleRequestRemove,
  safeMessageFetch,
  syncDatabase
};
