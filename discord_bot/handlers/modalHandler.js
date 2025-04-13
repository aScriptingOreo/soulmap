const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { validateCoordinates, formatCoordinates, generateEditDiff } = require('../modules/utils');

/**
 * Handle modal submissions
 */
async function handleModalSubmit(interaction, prisma, dbFunctions) {
  console.log(`Modal submission received: ${interaction.customId}`);
  
  // Log field values for debugging
  const fieldValues = {};
  interaction.fields.fields.forEach((value, key) => {
    fieldValues[key] = value.value;
  });
  console.log('Modal field values:', fieldValues);
  
  try {
    // Handle edit request modals
    if (interaction.customId.startsWith('req_edit_')) {
      await handleEditRequestModal(interaction, dbFunctions);
    }
    // Handle submit reason modal (final submission)
    else if (interaction.customId.startsWith('submit_reason_')) {
      await handleSubmitReason(interaction, prisma, dbFunctions);
    }
    // Handle remove request modals
    else if (interaction.customId.startsWith('request_remove_')) {
      await handleRemoveRequestModal(interaction, dbFunctions);
    }
    // Handle deny reason modal
    else if (interaction.customId.startsWith('deny_reason_')) {
      await handleDenyReasonModal(interaction, prisma, dbFunctions);
    }
    // Handle admin edit field modal
    else if (interaction.customId.startsWith('admin_edit_field_modal_')) {
      await handleAdminEditFieldModal(interaction, prisma, dbFunctions);
    }
    // Other modal types
    else {
      console.log(`Unhandled modal type: ${interaction.customId}`);
      await interaction.reply({
        content: 'This action is not implemented.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error processing modal submission:', error);
    try {
      await interaction.reply({
        content: `An error occurred: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error('Could not reply to modal submission:', replyError);
    }
  }
}

/**
 * Handle edit request modal submissions
 */
async function handleEditRequestModal(interaction, dbFunctions) {
  const parts = interaction.customId.split('_');
  const editType = parts[2]; // name, description, type, icon, coordinates
  const markerId = parts[3];
  const coordIndex = parts[4];
  const userId = parts[5];
  
  console.log(`Processing edit request: type=${editType}, markerId=${markerId}, coordIndex=${coordIndex}`);
  
  // Get the marker details
  const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
  const marker = locations.find(loc => loc.id === markerId);
  
  if (!marker) {
    await interaction.reply({
      content: 'Error: Marker not found.',
      ephemeral: true
    });
    return;
  }
  
  // Get the new value from the form
  const newValue = interaction.fields.getTextInputValue(editType) || 
                  interaction.fields.getTextInputValue('coordinates') || '';
  
  // Get existing edit session or start a new one
  let editSession = await dbFunctions.getEditSession(userId, markerId);
  
  // Add or update the edit
  if (!editSession.edits) {
    editSession.edits = {};
  }
  
  // Store the edit with timestamp
  editSession.edits[editType] = {
    oldValue: editType === 'coordinates' && coordIndex !== '*' && coordIndex !== undefined ? 
      (Array.isArray(marker.coordinates) && marker.coordinates[parseInt(coordIndex)] || '') : 
      marker[editType] || '',
    newValue: newValue,
    coordIndex: coordIndex,
    timestamp: Date.now()
  };
  
  // Save updated session
  await dbFunctions.saveEditSession(userId, markerId, marker.name, editSession.edits);
  
  // Generate a diff display for the embed
  let diffText = '';
  for (const [field, data] of Object.entries(editSession.edits)) {
    const displayField = field.charAt(0).toUpperCase() + field.slice(1);
    const oldValueDisplay = typeof data.oldValue === 'object' ? 
      JSON.stringify(data.oldValue) : (data.oldValue || 'None');
    const newValueDisplay = typeof data.newValue === 'object' ? 
      JSON.stringify(data.newValue) : (data.newValue || 'None');
    
    diffText += `**${displayField}**:\n`;
    diffText += `- Old: ${oldValueDisplay}\n`;
    diffText += `+ New: ${newValueDisplay}\n\n`;
  }
  
  // Create an embed showing all the changes
  const embed = new EmbedBuilder()
    .setTitle(`Edit Request for ${marker.name}`)
    .setColor('#3498db')
    .setDescription('The following changes have been queued for review:')
    .addFields({ name: 'Changes', value: diffText || 'No changes yet.' })
    .setFooter({ text: 'Continue editing or submit your changes when ready' })
    .setTimestamp();

  // Determine if this is a multi-coordinate marker
  let isMultiCoord = false;
  let coordCount = 1;
  
  try {
    const coords = marker.coordinates;
    
    if (Array.isArray(coords)) {
      if (coords.length === 2 && typeof coords[0] === 'number') {
        isMultiCoord = false;
      } else {
        isMultiCoord = true;
        coordCount = coords.length;
      }
    }
  } catch (e) {
    console.error('Error processing coordinates:', e);
  }
  
  // Create components array
  const components = [];
  
  // Add field selection menu - keep it always visible
  const editFieldsMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_edit_field_${marker.id}_${coordIndex || '*'}_${userId}`)
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
  
  // Add coordinate selection menu if needed
  if (isMultiCoord && coordCount > 1) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_coord_req_${marker.id}_${userId}`)
      .setPlaceholder('Or select a specific coordinate to edit')
      .addOptions([
        {
          label: `All coordinates (${coordCount} points)`,
          description: 'Edit all coordinates at once',
          value: '*'
        },
        ...Array.from({ length: Math.min(coordCount, 24) }, (_, i) => ({
          label: `Coordinate #${i + 1}`,
          description: `Edit coordinate #${i + 1}`,
          value: i.toString()
        }))
      ]);
    
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }
  
  // Add submit and cancel buttons
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`submit_edits_${marker.id}_${userId}`)
        .setLabel('Submit Changes')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cancel_edit_session')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    )
  );
  
  try {
    // First try to update the original message
    await interaction.update({
      embeds: [embed],
      components: components,
      content: 'Your changes have been added to the edit request.'
    });
  } catch (error) {
    // If that fails, reply with a new message
    console.error('Failed to update message, sending new reply:', error);
    await interaction.reply({
      embeds: [embed],
      components: components,
      ephemeral: true
    });
  }
}

/**
 * Handle final submission with reason
 */
async function handleSubmitReason(interaction, client, prisma, dbFunctions, config) {
  const parts = interaction.customId.split('_');
  const markerId = parts[2];
  const userId = parts[3];
  
  // Get the reason from the form
  const reason = interaction.fields.getTextInputValue('reason');
  
  // Get the edit session
  const editSession = await dbFunctions.getEditSession(userId, markerId);
  
  if (!editSession || !editSession.edits || Object.keys(editSession.edits).length === 0) {
    await interaction.reply({
      content: 'No edits found to submit.',
      ephemeral: true
    });
    return;
  }
  
  // Get current marker data for storing the original state
  let currentMarker = null;
  
  try {
    const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
    currentMarker = locations.find(loc => loc.id === markerId);
    
    if (!currentMarker) {
      await interaction.reply({
        content: 'Error: Cannot find the marker you are trying to edit.',
        ephemeral: true
      });
      return;
    }
  } catch (error) {
    console.error('Error fetching current marker data:', error);
    await interaction.reply({
      content: 'Error: Unable to retrieve current marker data.',
      ephemeral: true
    });
    return;
  }
  
  // Create a copy of current marker data that will have the edits applied
  let newMarker = JSON.parse(JSON.stringify(currentMarker));
  
  // Apply each edit to the new marker data
  for (const [field, data] of Object.entries(editSession.edits)) {
    if (field === 'coordinates' && data.coordIndex !== undefined && data.coordIndex !== '*') {
      // Handle specific coordinate update
      if (Array.isArray(newMarker.coordinates) && 
          !(newMarker.coordinates.length === 2 && typeof newMarker.coordinates[0] === 'number')) {
        // Update a specific coordinate in a multi-coordinate marker
        const newCoordValue = typeof data.newValue === 'string' ? 
          JSON.parse(data.newValue) : data.newValue;
        newMarker.coordinates[parseInt(data.coordIndex)] = newCoordValue;
      } else {
        // Replace single coordinate
        newMarker.coordinates = typeof data.newValue === 'string' ? 
          JSON.parse(data.newValue) : data.newValue;
      }
    } else {
      // Standard field update
      newMarker[field] = data.newValue;
    }
  }
  
  // Send request to admin channel 
  const CHANNEL_ID = config.CHANNEL_ID;
  const channel = interaction.client.channels.cache.get(CHANNEL_ID);
  
  if (channel) {
    // Create a diff display for the embed
    let diffText = '';
    for (const [field, data] of Object.entries(editSession.edits)) {
      const displayField = field.charAt(0).toUpperCase() + field.slice(1);
      const oldValueDisplay = typeof data.oldValue === 'object' ? 
        JSON.stringify(data.oldValue) : (data.oldValue || 'None');
      const newValueDisplay = typeof data.newValue === 'object' ? 
        JSON.stringify(data.newValue) : (data.newValue || 'None');
      
      diffText += `**${displayField}**:\n`;
      diffText += `- Old: ${oldValueDisplay}\n`;
      diffText += `+ New: ${newValueDisplay}\n\n`;
    }
    
    // Create an embed for the admin channel
    const embed = new EmbedBuilder()
      .setTitle('Edit Request')
      .setColor('#FFA500')
      .addFields(
        { name: 'Marker', value: currentMarker.name },
        { name: 'Requested By', value: `<@${userId}>` },
        { name: 'Changes', value: diffText },
        { name: 'Reason', value: reason }
      )
      .setFooter({ text: `Marker ID: ${markerId}` })
      .setTimestamp();
    
    // Add admin buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_edit_${markerId}_${userId}`)
        .setLabel('✅ Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`modify_edit_${markerId}_${userId}`)
        .setLabel('✏️ Modify')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`deny_edit_${markerId}`)
        .setLabel('❌ Deny')
        .setStyle(ButtonStyle.Danger)
    );
    
    // Send the message to get its ID
    const message = await channel.send({ embeds: [embed], components: [row] });
    
    // Save request to database with the complete JSON data
    const saveSuccess = await dbFunctions.saveRequest(
      message.id, // Discord message ID for tracking
      userId,
      'edit', // Request type
      reason,
      {
        currentData: currentMarker, // Original marker as JSON
        newData: newMarker          // Modified marker as JSON
      }
    );
    
    // Delete the edit session
    await dbFunctions.deleteEditSession(userId, markerId);
    
    // Confirm to the user
    await interaction.reply({
      content: '✅ Your edit request has been submitted and will be reviewed by administrators.',
      ephemeral: true
    });
  } else {
    // Handle case where channel not found
    await interaction.reply({
      content: 'Error: Admin channel not found. Please contact an administrator.',
      ephemeral: true
    });
  }
}

/**
 * Handle removal request modal submissions 
 */
async function handleRemoveRequestModal(interaction, dbFunctions) {
  const parts = interaction.customId.split('_');
  const markerId = parts[2];
  const coordIndex = parts[3];
  const userId = parts[4];
  
  // Get the reason from the form
  const reason = interaction.fields.getTextInputValue('reason');
  
  // Get marker details
  const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
  const marker = locations.find(loc => loc.id === markerId);
  
  if (!marker) {
    await interaction.reply({
      content: 'Error: Marker not found.',
      ephemeral: true
    });
    return;
  }
  
  // Generate a unique request ID
  const requestId = `remove_${Date.now()}_${userId}`;
  
  // Format the request for the database
  const removalType = coordIndex === 'all' ? 'marker' : 'coordinate';
  const description = `Request to remove ${removalType}: ${marker.name}${coordIndex !== 'all' ? ` (coordinate #${parseInt(coordIndex) + 1})` : ''}`;
  
  // Prepare change information for removal request
  const changes = {
    type: removalType,
    coordIndex: coordIndex !== 'all' ? parseInt(coordIndex) : 'all'
  };
  
  // If removing a specific coordinate, include the coordinate value
  if (coordIndex !== 'all' && Array.isArray(marker.coordinates)) {
    try {
      changes.coordinate = marker.coordinates[parseInt(coordIndex)];
    } catch (e) {
      console.error('Error getting coordinate for removal:', e);
    }
  }
  
  // Save the request to the database with complete change information
  await dbFunctions.saveRequest(
    requestId,
    userId,
    marker.name,
    coordIndex !== 'all' ? JSON.stringify(marker.coordinates[parseInt(coordIndex)]) : '',
    description,
    null, // screenshot
    'remove',
    reason,
    {
      markerId: markerId,
      markerName: marker.name,
      changes: changes
    }
  );
  
  // Send a request to the admin channel
  const CHANNEL_ID = process.env.CHANNEL_ID;
  const channel = interaction.client.channels.cache.get(CHANNEL_ID);
  
  if (channel) {
    // Create an embed for the request
    const embed = new EmbedBuilder()
      .setTitle('Removal Request')
      .setColor('#FF5733')
      .addFields(
        { name: 'Marker', value: marker.name },
        { name: 'Type', value: removalType },
        { name: 'Requested By', value: `<@${userId}>` },
        { name: 'Reason', value: reason }
      )
      .setFooter({ text: `Request ID: ${requestId}` })
      .setTimestamp();
    
    // Add coordinate information if applicable
    if (coordIndex !== 'all' && Array.isArray(marker.coordinates)) {
      const coord = marker.coordinates[parseInt(coordIndex)];
      if (Array.isArray(coord) && coord.length === 2) {
        embed.addFields({ name: 'Coordinate', value: `[${coord[0]}, ${coord[1]}]` });
      }
    }
    
    // Create admin action buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_remove_${requestId}_${markerId}_${coordIndex}`)
        .setLabel('✅ Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`edit_remove_${requestId}_${markerId}_${coordIndex}`)
        .setLabel('✏️ Edit')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`deny_remove_${requestId}`)
        .setLabel('❌ Deny')
        .setStyle(ButtonStyle.Danger)
    );
    
    // Send the request to the channel
    await channel.send({ embeds: [embed], components: [row] });
  }
  
  // Reply to the user
  await interaction.reply({
    content: 'Your removal request has been submitted and will be reviewed by administrators.',
    ephemeral: true
  });
}

/**
 * Handle deny reason modal submission
 */
async function handleDenyReasonModal(interaction, prisma, dbFunctions) {
  const messageId = interaction.customId.split('_')[2];
  const reason = interaction.fields.getTextInputValue('reason');
  
  try {
    // Update request status to denied
    await prisma.discordLocationRequest.update({
      where: { messageId: messageId },
      data: {
        status: 'denied',
        reason: reason // Store the denial reason
      }
    });
    
    // Get the original message
    const originalMessage = interaction.message;
    
    // Create updated embed with denied status
    const originalEmbed = originalMessage.embeds[0];
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
        name: 'Denial Reason',
        value: reason
      });
    
    // Update message without buttons
    await originalMessage.edit({
      embeds: [updatedEmbed],
      components: [] // Remove all buttons
    });
    
    // Confirm to the admin
    await interaction.reply({
      content: '✅ Edit request has been denied.',
      ephemeral: true
    });
  } catch (error) {
    console.error('Error denying edit request:', error);
    await interaction.reply({
      content: `Error: ${error.message}`,
      ephemeral: true
    });
  }
}

/**
 * Handle admin edit field modal submission
 */
async function handleAdminEditFieldModal(interaction, prisma, dbFunctions) {
  const parts = interaction.customId.split('_');
  const messageId = parts[3];
  const markerId = parts[4];
  const fieldToEdit = parts[5];
  
  console.log(`Admin submitting edit for field: ${fieldToEdit}, message: ${messageId}, marker: ${markerId}`);
  
  // Get the new value from the form
  const newValue = interaction.fields.getTextInputValue('value');
  
  try {
    // Get admin's edit session
    const adminUserId = interaction.user.id;
    const adminEditSession = await dbFunctions.getEditSession(adminUserId, markerId);
    
    if (!adminEditSession || !adminEditSession.edits) {
      await interaction.reply({
        content: 'Your edit session has expired. Please try again.',
        ephemeral: true
      });
      return;
    }
    
    // Update the field in the admin's session
    if (adminEditSession.edits[fieldToEdit]) {
      adminEditSession.edits[fieldToEdit].newValue = newValue;
      
      // Save the updated session
      await dbFunctions.saveEditSession(
        adminUserId, 
        markerId, 
        adminEditSession.markerName, 
        adminEditSession.edits
      );
      
      // Show updated changes to the admin - pass the message ID from the original request
      await handleModifyEdit(interaction, prisma, dbFunctions, messageId);
    } else {
      await interaction.reply({
        content: `Field ${fieldToEdit} not found in your edit session.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error updating admin edit field:', error);
    await interaction.reply({
      content: `Error: ${error.message}`,
      ephemeral: true
    });
  }
}

module.exports = {
  handleModalSubmit
};
