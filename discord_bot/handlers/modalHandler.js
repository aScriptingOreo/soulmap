const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { validateCoordinates, formatCoordinates, generateEditDiff } = require('../modules/utils');
const { 
  handleNewLocationDetailsSubmission,
  handleNameConfirmationSubmission
} = require('../modules/requests');

/**
 * Handle modal submissions
 */
async function handleModalSubmit(interaction, prisma, dbFunctions) {
  try {
    console.log(`Modal submission: ${interaction.customId}`);
    const client = interaction.client; // Get client from interaction
    const CHANNEL_ID = process.env.CHANNEL_ID;
    
    // Handle location detail submissions - use more concise prefix match
    if (interaction.customId.startsWith('new_loc_')) {
      await handleNewLocationDetailsSubmission(interaction, client, prisma, dbFunctions, CHANNEL_ID);
    }
    // Handle name confirmation modal (for partial matches)
    else if (interaction.customId.startsWith('confirm_name_match_')) {
      const { handleNameConfirmationSubmission } = require('../modules/requests');
      
      await handleNameConfirmationSubmission(interaction, client, prisma, dbFunctions, CHANNEL_ID);
    }
    // Handle new location details submission
    else if (interaction.customId.startsWith('new_location_details_')) {
      const { handleNewLocationDetailsSubmission } = require('../modules/requests');
      
      await handleNewLocationDetailsSubmission(interaction, client, prisma, dbFunctions, CHANNEL_ID);
    }
    // Handle add to existing location submission
    else if (interaction.customId.startsWith('add_to_existing_')) {
      const markerId = interaction.customId.split('_')[3];
      const coordinates = interaction.fields.getTextInputValue('coordinates');
      const description = interaction.fields.getTextInputValue('description') || ''; // Handle empty description
      
      const { validateCoordinates, formatCoordinates } = require('../modules/utils');
      const { submitCoordinateAddRequest } = require('../modules/requests');
      
      // Validate coordinates format
      if (!validateCoordinates(coordinates)) {
        await interaction.reply({ 
          content: 'Error: Coordinates must be in the format [X, Y] or multiple coordinates like [X, Y], [X, Y]',
          flags: 64 // Use flags instead of ephemeral
        });
        return;
      }
      
      // Format coordinates for display and extract coordinate data
      const { formatted: formattedCoords, coordinates: coordData } = formatCoordinates(coordinates);
      if (!formattedCoords) {
        await interaction.reply({ 
          content: 'Error: Could not parse the coordinates. Please check your input.',
          flags: 64 // Use flags instead of ephemeral
        });
        return;
      }
      
      await submitCoordinateAddRequest(
        interaction, 
        client, 
        markerId, 
        coordinates, 
        formattedCoords, 
        coordData, 
        description, 
        null, // No screenshot since we're using a modal
        dbFunctions, 
        CHANNEL_ID
      );
    }
    // Handle coordinate selection modal
    else if (interaction.customId.startsWith('coord_select_modal_')) {
      await handleCoordinateSelection(interaction, prisma, dbFunctions);
    }
    // Handle edit submission modals
    else if (interaction.customId.startsWith('submit_reason_')) {
      await handleSubmitReason(interaction, prisma, dbFunctions);
    }
    // Handle field edit modals
    else if (interaction.customId.startsWith('req_edit_')) {
      await handleRequestEditField(interaction, prisma, dbFunctions);
    }
    // Handle denial reason modals
    else if (interaction.customId.startsWith('deny_reason_')) {
      await handleDenyReason(interaction, prisma, dbFunctions);
    }
    // Handle other types of modals
    else {
      console.warn(`Unhandled modal submission: ${interaction.customId}`);
      await interaction.reply({
        content: 'This type of submission is not yet implemented.',
        flags: 64 // Use flags instead of ephemeral
      });
    }
  } catch (error) {
    console.error('Error handling modal submission:', error);
    try {
      // Handle different response states
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ 
          content: 'An error occurred while processing your submission.',
          flags: 64 // Using flags instead of ephemeral: true
        });
      } else if (interaction.deferred) {
        await interaction.editReply('An error occurred while processing your submission.');
      }
    } catch (replyError) {
      console.error('Error sending modal error response:', replyError);
    }
  }
}

/**
 * Handle coordinate selection modal for multi-coordinate markers
 */
async function handleCoordinateSelection(interaction, prisma, dbFunctions) {
  const parts = interaction.customId.split('_');
  const markerId = parts[3];
  const userId = parts[4];
  
  // Get the coordinate index from the modal input
  const coordIndexInput = interaction.fields.getTextInputValue('coord_index');
  let coordIndex;
  
  // Process the input - could be a number or "*"
  if (coordIndexInput === '*') {
    coordIndex = '*';
  } else {
    // Convert to zero-based index
    const parsedIndex = parseInt(coordIndexInput);
    if (isNaN(parsedIndex) || parsedIndex < 1) {
      await interaction.reply({
        content: 'Invalid coordinate number. Please enter a positive number or *.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    coordIndex = (parsedIndex - 1).toString(); // Store as string for consistency
  }
  
  // Get the marker using searchLocationsForAutocomplete
  const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
  const marker = locations.find(loc => loc.id === markerId);
  
  if (!marker) {
    await interaction.reply({
      content: 'Marker not found. It may have been deleted.',
      flags: 64 // Use flags instead of ephemeral
    });
    return;
  }
  
  // Validate the coordinate index exists if not "*"
  if (coordIndex !== '*') {
    const idx = parseInt(coordIndex);
    try {
      const coords = marker.coordinates;
      if (!Array.isArray(coords) || idx < 0 || idx >= coords.length) {
        await interaction.reply({
          content: `Invalid coordinate index. Please choose a number between 1 and ${coords.length} or *`,
          flags: 64 // Use flags instead of ephemeral
        });
        return;
      }
    } catch (e) {
      console.error('Error validating coordinate index:', e);
      await interaction.reply({
        content: 'Error validating coordinate index.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
  }
  
  // Use the showMarkerEditOptions function to display edit options
  const { showMarkerEditOptions } = require('../modules/requests');
  await showMarkerEditOptions(interaction, marker, coordIndex);
}

/**
 * Handle field edit modal submissions (name, description, coordinates, etc.)
 */
async function handleRequestEditField(interaction, prisma, dbFunctions) {
  const parts = interaction.customId.split('_');
  const field = parts[2]; // name, description, type, icon, coordinates
  const markerId = parts[3];
  const coordIndex = parts[4]; // Could be a number index, '*', or undefined
  const userId = parts[5];

  console.log(`Field edit submission: field=${field}, markerId=${markerId}, coordIndex=${coordIndex}, userId=${userId}`);
  
  try {
    // Get the field value from the modal
    const value = interaction.fields.getTextInputValue(field);
    
    // Get the current edit session or create a new one
    let session = await dbFunctions.getEditSession(userId, markerId);
    
    if (!session || !session.edits) {
      session = { edits: {} };
    }
    
    // Get current marker data from the database
    const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
    const marker = locations.find(loc => loc.id === markerId);
    
    if (!marker) {
      await interaction.reply({
        content: 'Error: Marker not found in the database.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // Process the edit based on field type
    let oldValue;
    let newValue;
    let hasChanged = false;
    
    switch (field) {
      case 'coordinates':
        [oldValue, newValue, hasChanged] = processCoordinatesEdit(marker, coordIndex, value);
        break;
      case 'name':
      case 'description':
      case 'type':
      case 'icon':
        // Simple field edits
        oldValue = marker[field];
        newValue = value;
        hasChanged = oldValue !== newValue;
        break;
      default:
        await interaction.reply({
          content: `Editing field "${field}" is not supported.`,
          flags: 64 // Use flags instead of ephemeral
        });
        return;
    }
    
    // Only save changes if the value actually changed
    if (hasChanged) {
      // Save the edit to the session
      session.edits[field] = {
        oldValue,
        newValue,
        timestamp: Date.now()
      };
      
      // Save the edit session
      await dbFunctions.saveEditSession(userId, markerId, marker.name, session.edits);
    }
    
    // Generate a summary of ALL current edits in the session
    const editSummary = Object.entries(session.edits).map(([editField, data]) => {
      const fieldName = editField.charAt(0).toUpperCase() + editField.slice(1);
      const diffText = generateEditDiff(data.oldValue, data.newValue);
      return `**${fieldName}**\n${diffText}`;
    }).join('\n\n');
    
    // Create an embed with status information
    const embed = new EmbedBuilder()
      .setTitle(`Edit Session: ${marker.name}`)
      .setColor('#0099ff')
      .setDescription(hasChanged 
        ? `Your changes to the **${field}** field have been saved.`
        : `No changes detected for the **${field}** field - the value is identical.`)
      .addFields({
        name: 'Current Edits',
        value: editSummary || 'No changes have been made yet.'
      })
      .setFooter({ 
        text: `Click "Submit Changes" when you're done, or use the menu to edit more fields.`
      })
      .setTimestamp();
    
    // CRITICAL FIX: Get the original message components to preserve them
    const originalComponents = interaction.message.components;
    
    // Update ONLY the embeds, preserve ALL original components
    try {
      await interaction.update({
        embeds: [embed],
        components: originalComponents // Preserve all original components
      });
    } catch (updateError) {
      console.error('Could not update message embeds:', updateError);
      // If update fails, reply with a new message
      await interaction.reply({
        content: `Changes saved but couldn't update display. Use the select menu above to continue editing.`,
        flags: 64 // Use flags instead of ephemeral
      });
    }
    
  } catch (error) {
    console.error(`Error handling field edit:`, error);
    await interaction.reply({
      content: `An error occurred while processing your edit: ${error.message}`,
      flags: 64 // Use flags instead of ephemeral
    });
  }
}

/**
 * Process coordinates field edits
 * Returns [oldValue, newValue, hasChanged]
 */
function processCoordinatesEdit(marker, coordIndex, value) {
  const coords = marker.coordinates;
  let oldValue = coords;
  let newValue;
  let hasChanged = false;
  
  try {
    // Parse the coordinates from the input value
    const parsedCoords = parseCoordinatesInput(value);
    
    // Handle different edit modes based on coordIndex
    if (coordIndex === '*') {
      // Edit all coordinates
      newValue = parsedCoords;
      hasChanged = JSON.stringify(oldValue) !== JSON.stringify(newValue);
    } else if (coordIndex !== undefined) {
      // Edit specific coordinate
      const idx = parseInt(coordIndex);
      
      // Create a copy of the coordinates array
      const newCoords = [...coords];
      
      // Replace the specific coordinate
      if (Array.isArray(parsedCoords) && parsedCoords.length === 2 && typeof parsedCoords[0] === 'number') {
        // Single coordinate pair provided
        newCoords[idx] = parsedCoords;
      } else if (Array.isArray(parsedCoords) && parsedCoords.length >= 1) {
        // Multiple coordinates provided, use the first one
        newCoords[idx] = parsedCoords[0];
      }
      
      newValue = newCoords;
      hasChanged = JSON.stringify(oldValue) !== JSON.stringify(newValue);
    } else {
      // Replace all coordinates (standard edit)
      newValue = parsedCoords;
      hasChanged = JSON.stringify(oldValue) !== JSON.stringify(newValue);
    }
    
    return [oldValue, newValue, hasChanged];
  } catch (error) {
    console.error('Error processing coordinates:', error);
    throw error;
  }
}

/**
 * Parse coordinates from various input formats
 */
function parseCoordinatesInput(input) {
  // Remove any whitespace and check format
  const trimmed = input.trim();
  
  // Split by newlines or commas
  const lines = trimmed
    .replace(/\]\s*,\s*\[/g, ']\n[') // Normalize separators between coordinates
    .split(/\n/)
    .filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    throw new Error('No valid coordinates found in input');
  }
  
  if (lines.length === 1) {
    // Could be a single coordinate pair
    const match = lines[0].match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
    if (!match) {
      throw new Error('Invalid coordinate format. Expected [X, Y]');
    }
    return [parseFloat(match[1]), parseFloat(match[2])];
  } else {
    // Multiple coordinates
    return lines.map(line => {
      const match = line.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
      if (!match) {
        throw new Error(`Invalid coordinate format: ${line}. Expected [X, Y]`);
      }
      return [parseFloat(match[1]), parseFloat(match[2])];
    });
  }
}

/**
 * Create buttons for edit session actions
 */
function createEditSessionButtons(markerId, userId) {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`submit_edits_${markerId}_${userId}`)
        .setLabel('Submit Changes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`edit_more_${markerId}_${userId}`)
        .setLabel('Edit More')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cancel_edit_session')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
  
  return [row];
}

/**
 * Handle submit reason modal (when user submits edits with reason)
 */
async function handleSubmitReason(interaction, prisma, dbFunctions) {
  // Extract data from modal and customId
  const parts = interaction.customId.split('_');
  const markerId = parts[2];
  const userId = parts[3];
  const reason = interaction.fields.getTextInputValue('reason');
  
  console.log(`Submit reason modal: markerId=${markerId}, userId=${userId}`);
  
  try {
    // Defer reply while we process - use flags
    await interaction.deferReply({ flags: 64 });
    
    // Create a new message in the requests channel
    const CHANNEL_ID = process.env.CHANNEL_ID;
    const channel = interaction.client.channels.cache.get(CHANNEL_ID);
    
    if (!channel) {
      await interaction.editReply('Error: Could not find the requests channel.');
      return;
    }
    
    // Get the edit session data
    const session = await dbFunctions.getEditSession(userId, markerId);
    
    if (!session || !session.edits || Object.keys(session.edits).length === 0) {
      await interaction.editReply('No edit data found. Your session may have expired.');
      return;
    }
    
    // Get marker information
    const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
    const marker = locations.find(loc => loc.id === markerId);
    
    if (!marker) {
      await interaction.editReply('Error: Could not find the marker information.');
      return;
    }
    
    // Create a formatted message showing the edit request
    const { generateEditDiff } = require('../modules/utils');
    
    // Create an embed for the request
    const embed = new EmbedBuilder()
      .setTitle(`Edit Request: ${marker.name}`)
      .setColor('#0099ff')
      .setDescription(`User <@${userId}> has requested the following changes:`)
      .addFields(
        { name: 'Reason', value: reason }
      );
    
    // Add fields showing what's being changed
    for (const [field, data] of Object.entries(session.edits)) {
      const fieldName = field.charAt(0).toUpperCase() + field.slice(1);
      const diffText = generateEditDiff(data.oldValue, data.newValue);
      embed.addFields({ name: fieldName, value: diffText });
    }
    
    // Add footer
    embed.setFooter({ 
      text: `Marker ID: ${markerId}`,
      iconURL: interaction.user.displayAvatarURL() 
    });
    
    embed.setTimestamp();
    
    // Create buttons for the request
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_edit_${markerId}`)
          .setLabel('✅ Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`modify_edit_${markerId}`)
          .setLabel('🔧 Modify')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`deny_edit_${markerId}`)
          .setLabel('❌ Deny')
          .setStyle(ButtonStyle.Danger)
      );
    
    // Send the embed to the specified channel
    const requestMessage = await channel.send({ 
      embeds: [embed], 
      components: [row] 
    });
    
    console.log('Converting edit session to request:', {
      messageId: requestMessage.id,
      userId,
      markerId,
      reason
    });
    
    // Save the request to the database with currentData and newData
    const result = await dbFunctions.saveEditSessionAsRequest(
      requestMessage.id,
      userId,
      markerId,
      reason
    );
    
    if (result) {
      await interaction.editReply('Your edit request has been submitted! Admins will review it soon.');
    } else {
      await interaction.editReply('There was an error submitting your request. Please try again later.');
      // Try to delete the message if we couldn't save to database
      try {
        await requestMessage.delete();
      } catch (deleteError) {
        console.error('Error deleting request message after failure:', deleteError);
      }
    }
  } catch (error) {
    console.error('Error handling submit reason:', error);
    try {
      // Check if we've already replied
      if (interaction.deferred) {
        await interaction.editReply(`Error: ${error.message}`);
      } else {
        await interaction.reply({ content: `Error: ${error.message}`, flags: 64 }); // Use flags
      }
    } catch (replyError) {
      console.error('Error replying to interaction:', replyError);
    }
  }
}

/**
 * Handle deny reason modal submission
 */
async function handleDenyReason(interaction, prisma, dbFunctions) {
  const parts = interaction.customId.split('_');
  const messageId = parts[2];
  const reason = interaction.fields.getTextInputValue('reason');
  
  console.log(`Deny reason modal for message: ${messageId}, reason: ${reason}`);
  
  try {
    // Get the request
    const request = await dbFunctions.getRequestByMessageId(messageId);
    
    if (!request) {
      await interaction.reply({
        content: 'Request not found in database.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // Update the request status
    await prisma.discordLocationRequest.update({
      where: { messageId: messageId },
      data: {
        status: 'denied',
        approvedBy: interaction.user.id, // Using approvedBy for the admin who denied it
        approvedAt: new Date()
      }
    });
    
    console.log('Request status updated to denied');
    
    // Update message to show it's been denied
    try {
      const message = await interaction.channel.messages.fetch(messageId);
      
      // Create updated embed with denial status
      const originalEmbed = message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor('#FF0000')
        .setTitle(`❌ DENIED: ${originalEmbed.title}`)
        .addFields({
          name: 'Denied By',
          value: `<@${interaction.user.id}>`,
          inline: true
        })
        .addFields({
          name: 'Denied At',
          value: `<t:${Math.floor(Date.now()/1000)}:F>`,
          inline: true
        })
        .addFields({
          name: 'Reason for Denial',
          value: reason
        });
      
      // Update message without buttons
      await message.edit({
        embeds: [updatedEmbed],
        components: [] // Remove all buttons
      });
      
      console.log('Message updated to show denial');
    } catch (messageError) {
      console.error('Error updating message:', messageError);
    }
    
    // Reply to the interaction - NO DMs
    await interaction.reply({
      content: `❌ Edit request has been denied.`,
      flags: 64 // Use flags instead of ephemeral
    });
    
  } catch (error) {
    console.error('Error denying edit request:', error);
    await interaction.reply({
      content: `Error denying edit request: ${error.message}`,
      flags: 64 // Use flags instead of ephemeral
    });
  }
}

module.exports = {
  handleModalSubmit
};
