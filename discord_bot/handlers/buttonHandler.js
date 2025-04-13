const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { generateEditDiff, formatStoredCoordinatesToString } = require('../modules/utils');

/**
 * Handle button interactions
 */
async function handleButtonInteraction(interaction, client, prisma, dbFunctions, config) {
  console.log(`Button interaction: ${interaction.customId}`);
  
  try {
    // Handle submit edits button
    if (interaction.customId.startsWith('submit_edits_')) {
      await handleSubmitEdits(interaction, client, prisma, dbFunctions, config);
    }
    // Handle cancel edit session button
    else if (interaction.customId === 'cancel_edit_session') {
      await handleCancelEditSession(interaction, prisma, dbFunctions);
    }
    // Handle approve edit request button
    else if (interaction.customId.startsWith('approve_edit_')) {
      // Check for admin role
      if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
        await interaction.reply({
          content: 'You need admin permissions to approve requests.',
          ephemeral: true
        });
        return;
      }
      await handleApproveEdit(interaction, prisma, dbFunctions);
    }
    // Handle modify edit request button
    else if (interaction.customId.startsWith('modify_edit_')) {
      // Check for admin role
      if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
        await interaction.reply({
          content: 'You need admin permissions to modify edit requests.',
          ephemeral: true
        });
        return;
      }
      await handleModifyEdit(interaction, prisma, dbFunctions);
    }
    // Handle deny edit request button
    else if (interaction.customId.startsWith('deny_edit_')) {
      // Check for admin role
      if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
        await interaction.reply({
          content: 'You need admin permissions to deny requests.',
          ephemeral: true
        });
        return;
      }
      await handleDenyEdit(interaction, prisma, dbFunctions);
    }
    // Other button handlers
    else {
      console.log(`Unhandled button type: ${interaction.customId}`);
      await interaction.reply({
        content: 'This action is not implemented yet.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error handling button interaction:', error);
    try {
      await interaction.reply({
        content: `An error occurred: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error('Could not reply to button interaction:', replyError);
    }
  }
}

/**
 * Handle submitting all edits
 */
async function handleSubmitEdits(interaction, client, prisma, dbFunctions, config) {
  const parts = interaction.customId.split('_');
  const markerId = parts[2];
  const userId = parts[3];
  
  // Get the edit session
  const session = await dbFunctions.getEditSession(userId, markerId);
  
  if (!session || !session.edits || Object.keys(session.edits).length === 0) {
    await interaction.reply({
      content: 'No edits found to submit.',
      ephemeral: true
    });
    return;
  }
  
  // Create a summary of edits for the modal
  let editSummary = '';
  for (const [field, data] of Object.entries(session.edits)) {
    const displayField = field.charAt(0).toUpperCase() + field.slice(1);
    const newValueDisplay = typeof data.newValue === 'object' ? 
      JSON.stringify(data.newValue) : data.newValue;
    editSummary += `${displayField}: ${newValueDisplay}\n`;
  }
  
  // Show a modal to get the overall reason for the edits
  const modal = new ModalBuilder()
    .setCustomId(`submit_reason_${markerId}_${userId}`)
    .setTitle('Finalize Edit Request');
  
  // Add summary field (read-only)
  const summaryInput = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('Edit Summary (Read Only)')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(editSummary)
    .setRequired(false);
  
  // Add reason field
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for Changes')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Please explain why these changes should be made...')
    .setRequired(true);
  
  // Create action rows
  const summaryRow = new ActionRowBuilder().addComponents(summaryInput);
  const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
  
  // Add the components to the modal
  modal.addComponents(summaryRow, reasonRow);
  
  // Show the modal to get the reason
  await interaction.showModal(modal);
}

/**
 * Handle "Edit More" button
 */
async function handleEditMore(interaction, prisma, dbFunctions) {
  const parts = interaction.customId.split('_');
  const markerId = parts[2];
  const userId = parts[3];
  
  // Get marker info
  const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
  const marker = locations.find(loc => loc.id === markerId);
  
  if (!marker) {
    await interaction.reply({
      content: 'Marker not found. It may have been deleted.',
      ephemeral: true
    });
    return;
  }
  
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
  
  // Show a select menu of all editable fields
  const editFieldsMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_edit_field_${markerId}_*_${userId}`)
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
  
  const components = [new ActionRowBuilder().addComponents(editFieldsMenu)];
  
  // Add coordinate selection menu if needed
  if (isMultiCoord && coordCount > 1) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_coord_req_${markerId}_${userId}`)
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
  
  // Add back button
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`back_to_summary_${markerId}_${userId}`)
        .setLabel('Back to Summary')
        .setStyle(ButtonStyle.Secondary)
    )
  );
  
  await interaction.update({
    content: 'Select a field to edit:',
    components: components
  });
}

/**
 * Handle cancel edit session button
 */
async function handleCancelEditSession(interaction, prisma, dbFunctions) {
  // Extract user ID and marker ID from the message components
  let userId = interaction.user.id;
  let markerId = null;
  
  try {
    // Try to find markerId from buttons in the message
    for (const row of interaction.message.components) {
      for (const component of row.components) {
        if (component.customId && component.customId.startsWith('submit_edits_')) {
          const parts = component.customId.split('_');
          markerId = parts[2];
          break;
        }
      }
      if (markerId) break;
    }
    
    if (markerId) {
      // Delete the edit session
      await dbFunctions.deleteEditSession(userId, markerId);
      console.log(`Deleted edit session for user ${userId}, marker ${markerId}`);
    }
    
    await interaction.update({
      content: 'Edit session cancelled.',
      components: [],
      embeds: []
    });
  } catch (error) {
    console.error('Error cancelling edit session:', error);
    await interaction.reply({
      content: 'Error cancelling edit session.',
      ephemeral: true
    });
  }
}

/**
 * Handle modify edit request button (for admins)
 */
async function handleModifyEdit(interaction, prisma, dbFunctions) {
  const messageId = interaction.message.id;
  console.log(`Modifying edit request in message: ${messageId}`);
  
  try {
    // Get the request using our new safer function
    const request = await dbFunctions.getRequestByMessageId(messageId);
    
    if (!request) {
      await interaction.reply({
        content: 'Edit request not found in database. It may have been deleted.',
        ephemeral: true
      });
      return;
    }
    
    // Extract the marker ID
    const markerId = request.marker_id;
    
    if (!markerId) {
      await interaction.reply({
        content: 'Error: No marker ID found in the request data.',
        ephemeral: true
      });
      return;
    }
    
    // Create an edit session for the admin based on the request
    const adminUserId = interaction.user.id;
    const isAdmin = true; // Admin is modifying the request
    
    const editSession = await dbFunctions.createSessionFromRequest(adminUserId, messageId, isAdmin);
    
    if (!editSession) {
      await interaction.reply({
        content: 'Failed to create edit session from the request data.',
        ephemeral: true
      });
      return;
    }
    
    console.log(`Created edit session for admin ${adminUserId} from request ${messageId}`);
    
    // Get current marker data for display
    const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
    const marker = locations.find(loc => loc.id === markerId);
    
    if (!marker) {
      await interaction.reply({
        content: 'The marker to be edited no longer exists in the database.',
        ephemeral: true
      });
      return;
    }
    
    // Create an embed showing the changes from the edit session
    const embed = new EmbedBuilder()
      .setTitle(`Editing Request for ${request.marker_name || marker.name}`)
      .setColor('#4287f5')
      .setDescription('Review and modify the requested changes before approving.')
      .addFields(
        { name: 'Original Requester', value: `<@${request.user_id}>`, inline: true },
        { name: 'Reason', value: request.reason || 'No reason provided' }
      );
    
    // Add select menu options based on the edit session
    const selectOptions = [];
    
    // Add fields to edit from the session
    for (const [field, data] of Object.entries(editSession.edits)) {
      const fieldDisplay = field.charAt(0).toUpperCase() + field.slice(1);
      const oldValue = typeof data.oldValue === 'object' ? 
        JSON.stringify(data.oldValue) : (data.oldValue || 'None');
      const newValue = typeof data.newValue === 'object' ? 
        JSON.stringify(data.newValue) : (data.newValue || 'None');
      
      embed.addFields({
        name: fieldDisplay,
        value: `From: ${oldValue}\nTo: ${newValue}`
      });
      
      selectOptions.push({
        label: `Edit ${fieldDisplay}`,
        description: `Modify the proposed ${field} change`,
        value: field
      });
    }
    
    // Create components array
    const components = [];
    
    // Add select menu for field editing
    if (selectOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`admin_edit_field_${messageId}_${markerId}`)
        .setPlaceholder('Select a field to modify')
        .addOptions(selectOptions);
      
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
    
    // Add buttons for approval, modification, or denial
    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_edit_now_${messageId}_${markerId}`)
        .setLabel('Approve With Changes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`approve_original_${messageId}_${markerId}`)
        .setLabel('Approve Original')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`admin_cancel_edit_${messageId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`deny_edit_${messageId}`)
        .setLabel('Deny Request')
        .setStyle(ButtonStyle.Danger)
    );
    
    components.push(buttonsRow);
    
    // Send the ephemeral message with edit options
    await interaction.reply({
      embeds: [embed],
      components: components,
      ephemeral: true
    });
  } catch (error) {
    console.error('Error in handleModifyEdit:', error);
    await interaction.reply({
      content: `An error occurred: ${error.message}`,
      ephemeral: true
    });
  }
}

/**
 * Handle approve edit request button (for admins)
 */
async function handleApproveEdit(interaction, prisma, dbFunctions) {
  const messageId = interaction.message.id;
  console.log(`Approving edit request in message: ${messageId}`);
  
  // Fetch the edit request from the database
  let request;
  try {
    request = await prisma.discordLocationRequest.findUnique({
      where: { messageId: messageId }
    });
    
    if (!request) {
      // Try the backup approach with raw SQL
      const requests = await prisma.$queryRaw`
        SELECT * FROM discord_location_requests 
        WHERE message_id = ${messageId}`;
      
      if (requests && requests.length > 0) {
        request = requests[0];
      }
    }
  } catch (error) {
    console.error('Error fetching request:', error);
    await interaction.reply({
      content: 'Error retrieving request data.',
      ephemeral: true
    });
    return;
  }
  
  if (!request) {
    await interaction.reply({
      content: 'Request not found in database.',
      ephemeral: true
    });
    return;
  }
  
  // Get the marker ID
  const markerId = request.markerId;
  
  if (!markerId) {
    await interaction.reply({
      content: 'Error: No marker ID found in the request.',
      ephemeral: true
    });
    return;
  }
  
  // Get the update data from newData field if available
  let updateData = {};
  
  if (request.newData) {
    try {
      const newDataObj = JSON.parse(request.newData);
      
      // Extract relevant fields for update
      // Depending on your Location model, you might need to adjust which fields to include
      const fieldsToUpdate = ['name', 'description', 'type', 'coordinates', 'icon'];
      
      for (const field of fieldsToUpdate) {
        if (newDataObj[field] !== undefined) {
          updateData[field] = newDataObj[field];
        }
      }
    } catch (error) {
      console.error('Error parsing newData:', error);
      
      // Fall back to legacy changes if available
      if (request.changes) {
        try {
          const changes = JSON.parse(request.changes);
          
          // Apply each requested change from legacy format
          for (const [field, data] of Object.entries(changes)) {
            if (!data.newValue) continue;
            updateData[field] = data.newValue;
          }
        } catch (changeParsError) {
          console.error('Error parsing changes fallback:', changeParsError);
          await interaction.reply({
            content: 'Error parsing change data. Cannot implement request.',
            ephemeral: true
          });
          return;
        }
      } else {
        await interaction.reply({
          content: 'Error: Cannot determine what changes to apply.',
          ephemeral: true
        });
        return;
      }
    }
  } else if (request.changes) {
    // Legacy approach if newData isn't available
    try {
      const changes = JSON.parse(request.changes);
      
      // Apply each requested change from legacy format
      for (const [field, data] of Object.entries(changes)) {
        if (!data.newValue) continue;
        updateData[field] = data.newValue;
      }
    } catch (error) {
      console.error('Error parsing changes:', error);
      await interaction.reply({
        content: 'Error parsing change data. Cannot implement request.',
        ephemeral: true
      });
      return;
    }
  } else {
    await interaction.reply({
      content: 'Error: No changes found to apply.',
      ephemeral: true
    });
    return;
  }
  
  // Add lastModified timestamp and approvedBy
  updateData.lastModified = new Date();
  updateData.approvedBy = interaction.user.id;
  
  console.log('Update data:', updateData);
  
  try {
    // Update the marker in the database
    await prisma.Location.update({
      where: { id: markerId },
      data: updateData
    });
    
    console.log('Location updated successfully');
    
    // Update the request status
    await prisma.discordLocationRequest.update({
      where: { messageId: messageId },
      data: {
        status: 'implemented',
        implementedBy: interaction.user.id,
        implementedAt: new Date()
      }
    });
    
    console.log('Request status updated to implemented');
    
    // Notify web application about the change
    await dbFunctions.notifyDatabaseChange();
    
    // Update message to show it's been approved
    try {
      const message = interaction.message;
      
      // Create updated embed with approval status
      const originalEmbed = message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor('#00FF00')
        .setTitle(`✅ APPROVED: ${originalEmbed.title}`)
        .addFields({
          name: 'Approved By',
          value: `<@${interaction.user.id}>`,
          inline: true
        })
        .addFields({
          name: 'Approved At',
          value: `<t:${Math.floor(Date.now()/1000)}:F>`,
          inline: true
        });
      
      // Update message without buttons
      await message.edit({
        embeds: [updatedEmbed],
        components: [] // Remove all buttons
      });
      
      console.log('Message updated to show approval');
    } catch (messageError) {
      console.error('Error updating message:', messageError);
    }
    
    // Reply to the interaction
    await interaction.reply({
      content: `✅ Edit request has been approved and implemented.`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Error approving edit request:', error);
    await interaction.reply({
      content: `Error approving edit request: ${error.message}`,
      ephemeral: true
    });
  }
}

/**
 * Handle deny edit request button (for admins)
 */
async function handleDenyEdit(interaction, prisma, dbFunctions) {
  const messageId = interaction.message.id;
  console.log(`Denying edit request in message: ${messageId}`);
  
  // Ask for denial reason
  const modal = new ModalBuilder()
    .setCustomId(`deny_reason_${messageId}`)
    .setTitle('Deny Edit Request');
  
  // Add reason field
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for Denial')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Please provide a reason for denying this edit request...')
    .setRequired(true);
  
  const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(reasonRow);
  
  // Show the modal
  await interaction.showModal(modal);
}

/**
 * Helper function to validate and parse coordinates
 */
function validateAndParseCoordinates(coordString, isSingle = false) {
  // Remove any whitespace and check format
  const trimmed = coordString.trim();
  
  if (isSingle) {
    // Expecting a single coordinate pair
    const match = trimmed.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
    if (!match) {
      throw new Error('Invalid coordinate format. Expected [X, Y]');
    }
    return [parseFloat(match[1]), parseFloat(match[2])];
  } else {
    // Could be single or multiple coordinates
    if (trimmed.includes('\n') || trimmed.includes('],[')) {
      // Multiple coordinates
      const coordStrings = trimmed
        .replace(/\]\s*,\s*\[/g, ']\n[') // Normalize separators
        .split('\n')
        .filter(line => line.trim().length > 0);
      
      return coordStrings.map(coordStr => {
        const match = coordStr.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
        if (!match) {
          throw new Error(`Invalid coordinate format: ${coordStr}`);
        }
        return [parseFloat(match[1]), parseFloat(match[2])];
      });
    } else {
      // Single coordinate
      const match = trimmed.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/);
      if (!match) {
        throw new Error('Invalid coordinate format. Expected [X, Y]');
      }
      return [parseFloat(match[1]), parseFloat(match[2])];
    }
  }
}

/**
 * Handle admin cancel edit action
 */
async function handleAdminCancelEdit(interaction) {
  await interaction.update({
    content: 'Edit action cancelled.',
    components: [],
    embeds: []
  });
}

/**
 * Handle admin edit field selection from select menu
 */
async function handleAdminEditField(interaction, prisma, dbFunctions) {
  const parts = interaction.customId.split('_');
  const requestId = parts[3];
  const markerId = parts[4];
  const fieldToEdit = interaction.values[0];
  
  console.log(`Admin editing field: ${fieldToEdit} for request ${requestId}`);
  
  // Get the original request
  let request;
  try {
    request = await prisma.discordLocationRequest.findUnique({
      where: { messageId: requestId }
    });
    
    if (!request) {
      // Try the backup approach
      const requests = await prisma.$queryRaw`
        SELECT * FROM discord_location_requests 
        WHERE message_id = ${requestId}`;
      
      if (requests && requests.length > 0) {
        request = requests[0];
      }
    }
  } catch (error) {
    console.error('Error fetching request:', error);
    await interaction.reply({
      content: 'Error retrieving request data.',
      ephemeral: true
    });
    return;
  }
  
  if (!request) {
    await interaction.reply({
      content: 'Request not found.',
      ephemeral: true
    });
    return;
  }
  
  // Get admin's edit session
  const adminUserId = interaction.user.id;
  const adminEditSession = await dbFunctions.getEditSession(adminUserId, `admin_${requestId}`);
  
  // If no admin session or no edits, initialize from original request
  if (!adminEditSession || !adminEditSession.edits || Object.keys(adminEditSession.edits).length === 0) {
    let originalChanges = {};
    try {
      originalChanges = request.changes ? JSON.parse(request.changes) : {};
    } catch (error) {
      console.error('Error parsing original changes:', error);
    }
    
    await dbFunctions.saveEditSession(adminUserId, `admin_${requestId}`, request.markerName, originalChanges);
  }
  
  // Get the field data from admin's session
  const fieldData = adminEditSession.edits[fieldToEdit];
  
  if (!fieldData) {
    await interaction.reply({
      content: `Field ${fieldToEdit} not found in edit data.`,
      ephemeral: true
    });
    return;
  }
  
  // Create a modal for editing the field
  const modal = new ModalBuilder()
    .setCustomId(`admin_edit_field_modal_${requestId}_${markerId}_${fieldToEdit}`)
    .setTitle(`Edit ${fieldToEdit.charAt(0).toUpperCase() + fieldToEdit.slice(1)}`);
  
  // Create input field
  const valueInput = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(`New Value for ${fieldToEdit}`)
    .setStyle(fieldToEdit === 'description' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setValue(typeof fieldData.newValue === 'object' ? 
      JSON.stringify(fieldData.newValue) : 
      fieldData.newValue || '')
    .setRequired(true);
  
  const valueRow = new ActionRowBuilder().addComponents(valueInput);
  
  modal.addComponents(valueRow);
  
  // Show the modal
  await interaction.showModal(modal);
}

module.exports = {
  handleButtonInteraction
};
