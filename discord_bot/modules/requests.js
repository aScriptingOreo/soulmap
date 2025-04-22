const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { getMapVersionInfo, validateCoordinates, formatCoordinates, generateMapLinks, parseMarkerSelection } = require('./utils');

/**
 * Handler for /request new
 */
async function handleRequestNew(interaction, client, prisma, dbFunctions, CHANNEL_ID) {
  // Get name only from the command options
  const userProvidedName = interaction.options.getString('name');
  
  // Don't defer the reply anymore - we need to show a modal
  let nameToUse = userProvidedName;
  let matchMessage = '';
  
  try {
    const { enhancedMarkerNameSearchWithContext } = require('./utils');
    
    // Get the best match using AI
    const matches = await enhancedMarkerNameSearchWithContext(userProvidedName, prisma, 1);
    if (matches && matches.length > 0) {
      // Found a match - use it
      nameToUse = matches[0];
      matchMessage = `Found similar marker: "${nameToUse}"`;
    } else {
      // No match found - use the original name
      matchMessage = `Creating new marker: "${nameToUse}"`;
    }
  } catch (error) {
    console.error('Error in AI name matching:', error);
    // If there's an error, just use the original name
    matchMessage = `Creating new marker: "${nameToUse}"`;
  }
  
  // Create a modal to collect additional details from the user
  // Store only brief essential info in the customId to avoid hitting Discord's 100 char limit
  const modal = new ModalBuilder()
    .setCustomId(`new_loc_${Buffer.from(userProvidedName).toString('base64').substring(0, 20)}`)
    .setTitle(matchMessage); // Use the title to convey the match message instead

  // Add name field pre-filled with suggested or original name
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Name')
    .setStyle(TextInputStyle.Short)
    .setValue(nameToUse)
    .setPlaceholder('Location name')
    .setRequired(true);
  
  // Add input fields for coordinates and description
  const coordsInput = new TextInputBuilder()
    .setCustomId('coordinates')
    .setLabel('Coordinates')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('[X, Y] format, can use multiple like [X,Y],[X,Y]')
    .setRequired(true);
  
  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe what this location is and why it\'s important (helps determine type)')
    .setRequired(true);
  
  // Create action rows
  const nameRow = new ActionRowBuilder().addComponents(nameInput);
  const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
  const descRow = new ActionRowBuilder().addComponents(descInput);
  
  // Add the components to the modal
  modal.addComponents(nameRow, coordsRow, descRow);
  
  // Show the modal directly - without deferring first
  await interaction.showModal(modal);
}

/**
 * Show disambiguation menu for multiple matches
 */
function showDisambiguationMenu(interaction, exactMatch, closeMatches, originalName) {
  // Create options for the select menu - first the create new option
  const selectOptions = [
    {
      label: `Create new marker: "${originalName}"`,
      description: 'Create a completely new marker with this name',
      value: `new_${Buffer.from(originalName).toString('base64')}`
    }
  ];
  
  // Add options for each matching location
  closeMatches.forEach(loc => {
    selectOptions.push({
      label: `Add to: ${loc.name}`,
      description: `Add coordinates to this existing marker${loc.isMultiCoord ? ' (multi-point)' : ''}`,
      value: `add_${loc.id}`
    });
  });
  
  // Create the select menu
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`loc_disambig_selection`)
        .setPlaceholder('Select an option or create new marker')
        .addOptions(selectOptions)
    );
  
  const cancelRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('cancel_request')
        .setLabel('Cancel Request')
        .setStyle(ButtonStyle.Secondary)
    );
  
  interaction.reply({
    content: `I found ${closeMatches.length} existing marker(s) with similar names. Would you like to add to one of these or create a new marker?`,
    components: [row, cancelRow],
    ephemeral: true
  });
}

/**
 * Handle name confirmation modal submission
 */
async function handleNameConfirmationSubmission(interaction, client, prisma, dbFunctions, CHANNEL_ID) {
  // Get the values from the modal
  const customId = interaction.customId;
  const parts = customId.split('_');
  const originalNameBase64 = parts[3];
  const suggestedMarkerId = parts[4];
  
  const originalName = Buffer.from(originalNameBase64, 'base64').toString();
  const confirmedName = interaction.fields.getTextInputValue('name');
  
  console.log(`Name confirmation: original="${originalName}", confirmed="${confirmedName}", suggestedId=${suggestedMarkerId}`);
  
  // Check if the user kept the suggested name or changed it
  if (confirmedName.toLowerCase() === originalName.toLowerCase() || 
      await isExactMarkerMatch(dbFunctions, confirmedName, suggestedMarkerId)) {
    // User confirmed adding to the existing marker
    // Show a modal to collect coordinates and optional description
    const modal = new ModalBuilder()
      .setCustomId(`add_to_existing_${suggestedMarkerId}`)
      .setTitle(`Add Coordinate to: ${confirmedName}`);
    
    // Add input fields for coordinates and description
    const coordsInput = new TextInputBuilder()
      .setCustomId('coordinates')
      .setLabel('New Coordinates')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('[X, Y] format, can use multiple like [X,Y],[X,Y]')
      .setRequired(true);
    
    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Updated Description (Optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Leave blank to keep existing description')
      .setRequired(false);
    
    // Create action rows
    const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
    const descRow = new ActionRowBuilder().addComponents(descInput);
    
    // Add the components to the modal
    modal.addComponents(coordsRow, descRow);
    
    await interaction.showModal(modal);
  } else {
    // User changed the name - create a new marker
    const modal = new ModalBuilder()
      .setCustomId(`new_location_details_${Buffer.from(confirmedName).toString('base64')}`)
      .setTitle(`New Location: ${confirmedName}`);
    
    // Add input fields for coordinates and description
    const coordsInput = new TextInputBuilder()
      .setCustomId('coordinates')
      .setLabel('Coordinates')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('[X, Y] format, can use multiple like [X,Y],[X,Y]')
      .setRequired(true);
    
    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Describe what this location is and why it\'s important (helps determine category)')
      .setRequired(true); // Make description required again
    
    // Create action rows
    const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
    const descRow = new ActionRowBuilder().addComponents(descInput);
    
    // Add the components to the modal
    modal.addComponents(coordsRow, descRow);
    
    await interaction.showModal(modal);
  }
}

/**
 * Helper function to check if name exactly matches a marker by ID
 */
async function isExactMarkerMatch(dbFunctions, name, markerId) {
  try {
    const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
    const marker = locations.find(loc => loc.id === markerId);
    
    if (marker && marker.name.toLowerCase() === name.toLowerCase()) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking exact marker match:', error);
    return false;
  }
}

// Add new handler function for the modal submission
async function handleNewLocationDetailsSubmission(interaction, client, prisma, dbFunctions, CHANNEL_ID) {
  // Get the values from the modal - simplified customId parsing
  const userProvidedName = interaction.customId.startsWith('new_loc_') ? 
    Buffer.from(interaction.customId.split('_')[2], 'base64').toString() : 
    'Unknown';
  
  // Get the actual name from the modal (may be different from original if user edited it)
  const name = interaction.fields.getTextInputValue('name');
  const coordinates = interaction.fields.getTextInputValue('coordinates');
  const description = interaction.fields.getTextInputValue('description');
  
  // Now we can defer the reply for processing - use flags instead of ephemeral
  await interaction.deferReply({ flags: 64 });
  
  // Show what action we're taking based on name change
  const initialResponse = name !== userProvidedName ? 
    `You changed the name to: "${name}"` : 
    `Processing request for "${name}"`;
    
  await interaction.editReply(initialResponse);
  
  // Validate coordinates format
  if (!validateCoordinates(coordinates)) {
    await interaction.editReply({ 
      content: 'Error: Coordinates must be in the format [X, Y] or multiple coordinates like [X, Y], [X, Y]'
      // No flags needed for editReply
    });
    return;
  }

  // Format coordinates for display and extract coordinate data
  const { formatted: formattedCoords, coordinates: coordData } = formatCoordinates(coordinates);
  if (!formattedCoords) {
    await interaction.editReply({ 
      content: 'Error: Could not parse the coordinates. Please check your input.'
      // No flags needed for editReply
    });
    return;
  }
  
  // Determine the marker category using AI prediction
  const { predictMarkerCategory } = require('./utils');
  const predictedCategory = await predictMarkerCategory(name, description);
  
  // Submit the new marker request with predicted category
  await submitNewMarkerRequest(
    interaction, 
    client, 
    name, 
    coordinates, 
    formattedCoords, 
    coordData, 
    description,
    null, // No screenshot since we're using a modal
    dbFunctions.saveRequest, 
    CHANNEL_ID,
    predictedCategory // Pass the predicted category
  );
}

// Add handler for disambiguation selection
async function handleLocationDisambigSelectionResponse(interaction, client, prisma, dbFunctions, CHANNEL_ID) {
  const selectedValue = interaction.values[0];
  
  if (selectedValue.startsWith('new_')) {
    // User wants to create a new marker
    const encodedName = selectedValue.split('_')[1];
    const name = Buffer.from(encodedName, 'base64').toString();
    
    // Show the modal to collect details
    const modal = new ModalBuilder()
      .setCustomId(`new_location_details_${encodedName}`)
      .setTitle('New Location Details');
    
    // Add input fields for coordinates and description
    const coordsInput = new TextInputBuilder()
      .setCustomId('coordinates')
      .setLabel('Coordinates')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('[X, Y] format, can use multiple like [X,Y],[X,Y]')
      .setRequired(true);
    
    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Describe what this location is and why it\'s important (helps determine category)')
      .setRequired(true); // Make description required again
    
    // Create action rows
    const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
    const descRow = new ActionRowBuilder().addComponents(descInput);
    
    // Add the components to the modal
    modal.addComponents(coordsRow, descRow);
    
    await interaction.showModal(modal);
  } 
  else if (selectedValue.startsWith('add_')) {
    // User wants to add coordinates to an existing marker
    const markerId = selectedValue.split('_')[1];
    
    // Show a modal to get the coordinates and updated description
    const modal = new ModalBuilder()
      .setCustomId(`add_to_existing_${markerId}`)
      .setTitle('Add Coordinate to Existing Marker');
    
    // Add input fields for coordinates and description
    const coordsInput = new TextInputBuilder()
      .setCustomId('coordinates')
      .setLabel('New Coordinates')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('[X, Y] format, can use multiple like [X,Y],[X,Y]')
      .setRequired(true);
    
    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Updated Description (Optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Leave blank to keep existing description')
      .setRequired(false);
    
    // Create action rows
    const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
    const descRow = new ActionRowBuilder().addComponents(descInput);
    
    // Add the components to the modal
    modal.addComponents(coordsRow, descRow);
    
    await interaction.showModal(modal);
  }
}

/**
 * Submit a new marker request to the channel
 */
async function submitNewMarkerRequest(
  interaction, client, name, coordinatesRaw, formattedCoords, coordData, 
  description, screenshot, saveRequest, CHANNEL_ID, predictedCategory = 'user_submitted'
) {
  // REMOVED: Remove the deferReply since interaction is already deferred in the calling function
  // await interaction.deferReply({ flags: 64 });
  
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
      { name: 'Type', value: predictedCategory, inline: true }, // Changed from 'Category' to 'Type' to match DB schema
      { name: 'Coordinates', value: '```yml\n' + formattedCoords + '\n```' },
      { name: 'Map Links', value: mapLinks },
      { name: 'Description', value: description || '*(No description provided)*' }
    )
    .setFooter({ 
      text: `Soulmap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Requested by ${interaction.user.tag} (${interaction.user.id})`, 
      iconURL: interaction.user.displayAvatarURL() 
    })
    .setTimestamp();
  
  // Add screenshot if provided
  if (screenshot) {
    embed.setImage(screenshot.url);
  }
  
  // Send the embed to the specified channel
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    // Send temporary message first to get the message ID
    const tempMessage = await channel.send({ content: 'Processing request...' });
    
    // Create buttons for the request AFTER tempMessage is defined
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          // Now tempMessage.id is available
          .setCustomId(`approve_new_${tempMessage.id}`) 
          .setLabel('✅ Implement')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`dismiss_${interaction.user.id}`) // Keep dismiss as is for now
          .setLabel('❌ Dismiss')
          .setStyle(ButtonStyle.Danger)
      );

    // Update the message with actual content and correct buttons
    await tempMessage.edit({ content: null, embeds: [embed], components: [row] });
    
    // Save request to database with the message ID
    const screenshotUrl = screenshot ? screenshot.url : null;
    // Ensure reason is empty string if not provided
    await saveRequest(tempMessage.id, interaction.user.id, 'new', '', { 
      newData: JSON.stringify({
        name,
        coordinates: coordData,
        description,
        type: predictedCategory, // Use the AI predicted category
        mediaUrl: screenshotUrl ? [screenshotUrl] : undefined
      })
    });
    
    await interaction.editReply('Your location request has been submitted!');
  } else {
    await interaction.editReply('Error: Could not find the specified channel.');
  }
}

/**
 * Submit a coordinate addition request to an existing marker
 */
async function submitCoordinateAddRequest(interaction, client, existingMarkerId, coordinatesRaw, formattedCoords, coordData, description, screenshot, dbFunctions, CHANNEL_ID) {
  // UPDATED: Use flags instead of ephemeral
  await interaction.deferReply({ flags: 64 });
  
  // Fetch the existing marker
  const locations = await dbFunctions.searchLocationsForAutocomplete(existingMarkerId);
  const marker = locations.find(loc => loc.id === existingMarkerId);
  
  if (!marker) {
    await interaction.editReply('Error: Could not find the existing marker. It may have been deleted.');
    return;
  }
  
  // Determine if this is a single-to-multi conversion or just adding to multi
  const isConversion = !marker.isMultiCoord;
  
  // Generate map links
  const mapLinks = generateMapLinks(coordData);

  // Get version information
  const versionInfo = getMapVersionInfo();
  
  // Create an embed for the request
  const embed = new EmbedBuilder()
    .setTitle(`Add Coordinate to ${marker.name}`)
    .setColor('#4287f5')
    .addFields(
      { name: 'Existing Marker', value: marker.name },
      { name: 'New Coordinates', value: '```yml\n' + formattedCoords + '\n```' },
      { name: 'Map Links', value: mapLinks },
      { name: 'Description Update', value: description || 'No changes to description' }
    )
    .setFooter({ 
      text: `Soulmap v${versionInfo.mapVersion} | Preludes ${versionInfo.gameVersion} | Requested by ${interaction.user.tag} (${interaction.user.id})`, 
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
        .setCustomId(`approve_coord_add_${interaction.user.id}_${existingMarkerId}`)
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
    const tempMessage = await channel.send({ content: 'Processing coordinate addition request...' });
    
    // Update the message with actual content
    await tempMessage.edit({ content: null, embeds: [embed], components: [row] });
    
    // Create the currentData and newData for the edit request
    const currentData = { ...marker };
    let newData = { ...marker };
    
    // Update coordinates in newData based on whether this is a conversion or addition
    if (isConversion) {
      // Converting from single coordinate to multi-coordinate
      newData.coordinates = [
        marker.coordinates, // The original coordinate
        coordData // The new coordinate
      ];
    } else {
      // Already multi-coordinate, just add the new one
      newData.coordinates = [
        ...(Array.isArray(marker.coordinates[0]) ? marker.coordinates : [marker.coordinates]), 
        ...(Array.isArray(coordData[0]) ? coordData : [coordData])
      ];
    }
    
    // Update description if provided
    if (description && description.trim()) {
      newData.description = description;
    }
    
    // Update mediaUrl if screenshot provided
    if (screenshot) {
      const screenshotUrl = screenshot.url;
      if (marker.mediaUrl) {
        // If mediaUrl already exists and is an array, add to it
        if (Array.isArray(marker.mediaUrl)) {
          newData.mediaUrl = [...marker.mediaUrl, screenshotUrl];
        } 
        // If mediaUrl is a string, convert to array
        else if (typeof marker.mediaUrl === 'string') {
          newData.mediaUrl = [marker.mediaUrl, screenshotUrl];
        }
        // Otherwise just set as new array
        else {
          newData.mediaUrl = [screenshotUrl];
        }
      } else {
        // No existing mediaUrl, create new array
        newData.mediaUrl = [screenshotUrl];
      }
    }
    
    // Save the edit request
    await dbFunctions.saveRequest(
      tempMessage.id, 
      interaction.user.id, 
      'edit', 
      `Adding new coordinates to ${marker.name}`,
      {
        currentData,
        newData,
        markerId: marker.id,
        markerName: marker.name
      }
    );
    
    await interaction.editReply(`Your request to add a coordinate to "${marker.name}" has been submitted!`);
  } else {
    await interaction.editReply('Error: Could not find the specified channel.');
  }
}

/**
 * Handle location disambiguation select menu selection
 */
async function handleLocationDisambiguation(interaction, client, prisma, dbFunctions, CHANNEL_ID) {
  // Parse the selection value
  const selectedValue = interaction.values[0];
  const customIdParts = interaction.customId.split('_');
  
  // Get the encoded data from the customId
  const encodedCoordinates = customIdParts[2];
  const encodedDescription = customIdParts[3];
  let encodedScreenshot = customIdParts[4];
  
  // Decode the data
  const coordinates = Buffer.from(encodedCoordinates, 'base64').toString();
  const description = Buffer.from(encodedDescription, 'base64').toString();
  
  // Get screenshot from either attachment or encoded URL
  let screenshot = null;
  if (interaction.message.attachments.size > 0) {
    screenshot = interaction.message.attachments.first();
  } else if (encodedScreenshot) {
    try {
      const screenshotUrl = Buffer.from(encodedScreenshot, 'base64').toString();
      if (screenshotUrl) {
        screenshot = { url: screenshotUrl };
      }
    } catch (error) {
      console.error('Error decoding screenshot URL:', error);
    }
  }
  
  // Format coordinates for display and extraction
  const { formatted: formattedCoords, coordinates: coordData } = formatCoordinates(coordinates);
  
  // Handle based on the selected value
  if (selectedValue.startsWith('new_')) {
    // User wants to create a new marker
    const encodedName = selectedValue.split('_')[1];
    const name = Buffer.from(encodedName, 'base64').toString();
    
    // Submit a new marker request
    await submitNewMarkerRequest(
      interaction, 
      client, 
      name, 
      coordinates, 
      formattedCoords, 
      coordData, 
      description, 
      screenshot, 
      dbFunctions.saveRequest, 
      CHANNEL_ID
    );
  } else if (selectedValue.startsWith('add_')) {
    // User wants to add coordinates to an existing marker
    const markerId = selectedValue.split('_')[1];
    
    // Submit a coordinate addition request
    await submitCoordinateAddRequest(
      interaction, 
      client, 
      markerId, 
      coordinates, 
      formattedCoords, 
      coordData, 
      description, 
      screenshot, 
      dbFunctions, 
      CHANNEL_ID
    );
  } else {
    await interaction.reply({
      content: 'Invalid selection. Please try submitting your request again.',
      flags: 64 // Use flags instead of ephemeral
    });
  }
}

/**
 * Handler for /request edit
 */
async function handleRequestEdit(interaction, prisma, searchLocationsForAutocomplete) {
  const markerName = interaction.options.getString('name');
  // Send the embed to the specified channel
  try {
    // Get marker info from the database
    const locations = await searchLocationsForAutocomplete(markerName);
    let marker = null;
    
    // First look for exact match
    marker = locations.find(loc => 
      loc.name.toLowerCase() === markerName.toLowerCase()
    );
    
    // If not found, take first result
    if (!marker && locations.length > 0) {
      marker = locations[0];
    }
    
    if (!marker) {
      await interaction.reply({ 
        content: `Marker "${markerName}" not found.`,
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // Check if this is a multi-coordinate marker
    let isMultiCoord = false;
    let coordCount = 1;
    
    try {
      const coords = marker.coordinates;
      if (Array.isArray(coords)) {
        if (coords.length === 2 && typeof coords[0] === 'number') {
          // Single coordinate pair
          isMultiCoord = false;
        } else if (coords.length > 1) {
          // Multiple coordinates
          isMultiCoord = true;
          coordCount = coords.length;
        }
      }
    } catch (e) {
      console.error('Error processing coordinates:', e);
    }
    
    // For multi-coordinate markers, show the coordinate selection modal first
    if (isMultiCoord && coordCount > 1) {
      // Create a modal for coordinate selection
      const modal = new ModalBuilder()
        .setCustomId(`coord_select_modal_${marker.id}_${interaction.user.id}`)
        .setTitle(`Select Coordinate for ${marker.name}`);
      
      // Add input field for the coordinate index
      const indexInput = new TextInputBuilder()
        .setCustomId('coord_index')
        .setLabel(`Enter coordinate number (1-${coordCount}) or * for all`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: 2 or *')
        .setRequired(true);
      
      // Create action row
      const indexRow = new ActionRowBuilder().addComponents(indexInput);
      
      // Add the component to the modal
      modal.addComponents(indexRow);
      
      // Show the modal to the user
      await interaction.showModal(modal);
      return;
    }
    
    // For single-coordinate markers, proceed with normal editing flow
    await showMarkerEditOptions(interaction, marker);
  } catch (error) {
    console.error('Error in handleRequestEdit:', error);
    await interaction.reply({
      content: 'An error occurred while retrieving marker information.',
      flags: 64 // Use flags instead of ephemeral
    });
  }
}

/**
 * Helper function to show marker edit options after handling coordinate selection
 */
async function showMarkerEditOptions(interaction, marker, coordIndex) {
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
  
  // Process coordinates for display
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
        if (coordIndex !== undefined && coordIndex !== '*') {
          // Show only the selected coordinate
          const idx = parseInt(coordIndex);
          if (idx >= 0 && idx < coords.length) {
            const coord = coords[idx];
            if (Array.isArray(coord) && coord.length === 2) {
              embed.addFields({ 
                name: `Coordinate #${idx + 1}`, 
                value: `[${coord[0]}, ${coord[1]}]` 
              });
            }
          }
        } else if (coords.length > 10) {
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
    // Show a select menu of all editable fields
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

    // Add submit and cancel buttons
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`submit_edits_${marker.id}_${interaction.user.id}`)
          .setLabel('Submit Changes')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cancel_edit_session`) // IMPORTANT: Match the ID in buttonHandler.js
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  // Determine the appropriate reply method
  const replyMethod = interaction.deferred ? interaction.editReply : interaction.reply;
  
  await replyMethod.call(interaction, {
    embeds: [embed],
    content: "📝 Please select what you'd like to edit for this marker" + 
             (coordIndex !== undefined ? ` (Coordinate #${parseInt(coordIndex) + 1})` : 
              (coordIndex === '*' ? " (All metadata)" : ".")),
    components: components,
    flags: 64 // Use flags instead of ephemeral
  });
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
      flags: 64 // Use flags instead of ephemeral
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
      flags: 64 // Use flags instead of ephemeral
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
  syncDatabase,
  showMarkerEditOptions,
  handleLocationDisambiguation,
  submitNewMarkerRequest,
  submitCoordinateAddRequest,
  handleNewLocationDetailsSubmission,
  handleLocationDisambigSelectionResponse,
  handleNameConfirmationSubmission
};
