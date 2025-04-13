const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { validateCoordinates, formatCoordinates, parseMarkerSelection, formatStoredCoordinatesToString } = require('./utils');

/**
 * Handler for /soulmap new (admin command)
 */
async function handleSoulmapNew(interaction, prisma, notifyDatabaseChange) {
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
  const existingLocation = await prisma.Location.findFirst({
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
  await prisma.Location.create({
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

/**
 * Handler for /soulmap edit (admin command)
 */
async function handleSoulmapEdit(interaction, prisma, searchLocationsForAutocomplete) {
  const markerSelection = interaction.options.getString('name');
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
    
    // Determine if this is a multi-coordinate marker
    let isMultiCoord = false;
    let coordCount = 1;
    
    try {
      const coords = marker.coordinates;
      
      // Handle different coordinate formats
      if (Array.isArray(coords)) {
        if (coords.length === 2 && typeof coords[0] === 'number') {
          isMultiCoord = false;
        } else {
          isMultiCoord = true;
          coordCount = coords.length;
        }
      } else if (typeof coords === 'string') {
        try {
          const parsedCoords = JSON.parse(coords);
          if (Array.isArray(parsedCoords) && parsedCoords.length > 2) {
            isMultiCoord = true;
            coordCount = parsedCoords.length;
          }
        } catch {
          // Not valid JSON, assume single coordinate
          isMultiCoord = false;
        }
      }
    } catch (e) {
      console.error('Error processing coordinates for edit:', e);
      isMultiCoord = false;
    }

    // Create an embed with marker information
    const embed = new EmbedBuilder()
      .setTitle(`Editing Marker: ${marker.name}`)
      .setColor('#FFA500')
      .addFields(
        { name: 'Type', value: marker.type || 'Unknown', inline: true },
        { name: 'ID', value: marker.id, inline: true }
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

    // Process coordinates for display
    try {
      const coords = marker.coordinates;
      
      // Add coordinate information depending on selected index
      if (coordIndex === '*') {
        embed.addFields({ name: 'Mode', value: '✏️ Editing all coordinates' });
      } else if (isMultiCoord && coordIndex !== undefined) {
        embed.addFields({ name: 'Mode', value: `✏️ Editing coordinate #${parseInt(coordIndex) + 1}` });
      } else {
        embed.addFields({ name: 'Mode', value: '✏️ Editing marker' });
      }
      
      // Display coordinate summary
      if (isMultiCoord) {
        embed.addFields({ name: 'Coordinates', value: `${coordCount} coordinate points` });
        
        // If select mode or single coordinate edit, show more details
        if (coordIndex !== undefined && coordIndex !== '*') {
          try {
            const selectedCoord = Array.isArray(coords) ? coords[parseInt(coordIndex)] : null;
            if (selectedCoord && Array.isArray(selectedCoord) && selectedCoord.length === 2) {
              embed.addFields({ 
                name: `Selected Coordinate (#${parseInt(coordIndex) + 1})`, 
                value: `[${selectedCoord[0]}, ${selectedCoord[1]}]` 
              });
            }
          } catch (e) {
            console.error('Error showing selected coordinate:', e);
          }
        }
      } else {
        // Single coordinate
        let coordDisplay = '';
        if (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number') {
          coordDisplay = `[${coords[0]}, ${coords[1]}]`;
        } else {
          coordDisplay = 'Complex format (will be shown in edit modal)';
        }
        embed.addFields({ name: 'Coordinates', value: coordDisplay });
      }
    } catch (e) {
      console.error('Error processing coordinates for display:', e);
      embed.addFields({ name: 'Coordinates', value: 'Error processing coordinates' });
    }

    // For multi-coordinate markers, add a select menu if not already selecting a specific coordinate
    const components = [];
    
    if (isMultiCoord && coordCount > 1 && coordIndex === undefined) {
      // Create select menu to choose which coordinate to edit
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_coord_${marker.id}`)
        .setPlaceholder('Select a coordinate to edit')
        .addOptions([
          {
            label: `All coordinates (${coordCount} points)`,
            description: 'Edit all coordinates at once',
            value: '*'
          },
          ...Array.from({ length: Math.min(coordCount, 24) }, (_, i) => ({
            label: `Coordinate #${i + 1}`,
            description: `Edit only coordinate #${i + 1}`,
            value: i.toString()
          }))
        ]);
      
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
    
    // Add buttons
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit_marker_btn_${marker.id}_${coordIndex || ''}`)
          .setLabel('Edit This Marker')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`cancel_edit`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      )
    );
    
    // Send the response with embed and components
    await interaction.reply({
      embeds: [embed],
      components: components,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Error in handleSoulmapEdit:', error);
    await interaction.reply({
      content: 'An error occurred while retrieving marker information.',
      ephemeral: true
    });
  }
}

/**
 * Handler for /soulmap delete (admin command)
 */
async function handleSoulmapDelete(interaction, prisma) {
  const markerSelection = interaction.options.getString('name');
  
  // Parse marker name and index if provided
  let { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
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

/**
 * Shared function for editing markers (used by both admin and request handlers)
 */
async function handleEditMarker(interaction, prisma, searchLocationsForAutocomplete) {
  const markerSelection = interaction.options.getString('name');
  let { name: markerName, index: coordIndex } = parseMarkerSelection(markerSelection);
  
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
    .setCustomId(`edit_marker_${marker.id}_${coordIndex === undefined ? '' : coordIndex}`)
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
    } else if (coordData && typeof coordData === 'object' && coordData.coordinates) {
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

/**
 * Handler for /admin undo command
 */
async function handleAdminUndo(interaction, prisma, dbFunctions) {
  await interaction.deferReply({ ephemeral: true });
  
  const requestId = interaction.options.getString('id');
  
  if (!requestId) {
    return await interaction.editReply('Please provide a valid request ID.');
  }
  
  // Call the undo function
  const result = await dbFunctions.undoRequest(requestId);
  
  if (!result.success) {
    return await interaction.editReply(`Failed to undo request: ${result.error}`);
  }
  
  await interaction.editReply(`✅ Successfully reverted changes from request ${requestId}`);
}

/**
 * Handler for /admin info command
 */
async function handleAdminInfo(interaction, prisma, dbFunctions) {
  await interaction.deferReply({ ephemeral: true });
  
  const requestId = interaction.options.getString('id');
  
  if (!requestId) {
    return await interaction.editReply('Please provide a valid request ID.');
  }
  
  // Get the request
  const request = await dbFunctions.getRequestById(requestId);
  
  if (!request) {
    return await interaction.editReply(`Request with ID ${requestId} not found.`);
  }
  
  // Create an embed with the request details
  const embed = new EmbedBuilder()
    .setTitle('Request Information')
    .setColor('#0099ff')
    .addFields(
      { name: 'ID', value: request.id },
      { name: 'Type', value: request.request_type || 'Unknown' },
      { name: 'Status', value: request.status },
      { name: 'User ID', value: request.userId },
      { name: 'Created At', value: request.createdAt?.toISOString() || 'Unknown' }
    );
  
  if (request.implementedBy) {
    embed.addFields({ name: 'Implemented By', value: request.implementedBy });
  }
  
  if (request.implementedAt) {
    embed.addFields({ name: 'Implemented At', value: request.implementedAt.toISOString() });
  }
  
  if (request.reason) {
    embed.addFields({ name: 'Reason', value: request.reason });
  }
  
  // Add description (truncate if needed)
  if (request.description) {
    const desc = request.description.length > 1024 ? 
      request.description.substring(0, 1021) + '...' : request.description;
    embed.addFields({ name: 'Description', value: desc });
  }
  
  // Add marker info if available
  if (request.markerId) {
    embed.addFields({ name: 'Marker ID', value: request.markerId });
  }
  
  if (request.markerName) {
    embed.addFields({ name: 'Marker Name', value: request.markerName });
  }
  
  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  handleSoulmapNew,
  handleSoulmapEdit,
  handleSoulmapDelete,
  handleEditMarker,
  handleAdminUndo,
  handleAdminInfo
};
