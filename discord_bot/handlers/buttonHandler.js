const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { generateEditDiff, formatStoredCoordinatesToString } = require('../modules/utils');
const { updateLeaderboard } = require('../modules/leaderboard'); // Import leaderboard updater

/**
 * Handle button interactions
 */
async function handleButtonInteraction(interaction, client, prisma, dbFunctions, config) {
  const customId = interaction.customId;
  console.log(`Button interaction: ${customId}`);
  
  try {
    // Handle approve new request button
    if (interaction.customId.startsWith('approve_new_')) {
      // Check for admin role
      if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
        await interaction.reply({
          content: 'You need admin permissions to approve requests.',
          flags: 64 // Use flags instead of ephemeral
        });
        return;
      }
      await handleApproveNew(interaction, prisma, dbFunctions, client, config); // Pass client and config
    }
    // Handle submit edits button
    else if (interaction.customId.startsWith('submit_edits_')) {
      await handleSubmitEdits(interaction, client, prisma, dbFunctions, config);
    }
    // Handle cancel edit session button - FIX: Add both possible button IDs
    else if (interaction.customId === 'cancel_edit_session' || interaction.customId === 'cancel_edit_request') {
      await handleCancelEditSession(interaction, prisma, dbFunctions);
    }
    // Handle edit more button
    else if (interaction.customId.startsWith('edit_more_')) {
      await handleEditMore(interaction, prisma, dbFunctions);
    }
    // Handle approve edit request button
    else if (interaction.customId.startsWith('approve_edit_')) {
      // Check for admin role
      if (!interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
        await interaction.reply({
          content: 'You need admin permissions to approve requests.',
          flags: 64 // Use flags instead of ephemeral
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
          flags: 64 // Use flags instead of ephemeral
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
          flags: 64 // Use flags instead of ephemeral
        });
        return;
      }
      await handleDenyEdit(interaction, prisma, dbFunctions);
    }
    // Handle cancel request button
    else if (interaction.customId === 'cancel_request') {
      await interaction.update({ 
        content: 'Request cancelled.', 
        components: [] 
      });
      return;
    }
    // Handle dismiss button (format: dismiss_userId)
    else if (interaction.customId.startsWith('dismiss_')) {
      const parts = interaction.customId.split('_');
      const requesterId = parts[1];
      
      // Check if user has permission to dismiss
      if (!hasPermissionForRequest(interaction, requesterId)) {
        await interaction.reply({
          content: 'You don\'t have permission to dismiss this request.',
          flags: 64 // Use flags instead of ephemeral
        });
        return;
      }

      // Get the original embed
      const message = interaction.message;
      const originalEmbed = message.embeds[0];
      
      // Create updated embed with dismissal status
      const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor('#FF0000')
        .setTitle(`❌ DISMISSED: ${originalEmbed.title}`)
        .addFields({
          name: 'Dismissed By',
          value: `<@${interaction.user.id}>`,
          inline: true
        })
        .addFields({
          name: 'Dismissed At',
          value: `<t:${Math.floor(Date.now()/1000)}:F>`,
          inline: true
        });
      
      // Update the message to show dismissed state
      await interaction.message.edit({
        content: null, // Remove any content text
        embeds: [updatedEmbed],
        components: [] // Remove all buttons
      });
      
      // Let the user know it was successful
      await interaction.reply({
        content: 'Request dismissed.',
        flags: 64 // Use flags instead of ephemeral
      });
      
      // If there's a message ID, update the database status
      if (interaction.message.id) {
        try {
          await dbFunctions.updateRequestStatus(interaction.message.id, 'dismissed');
        } catch (dbError) {
          console.error('Error updating request status in database:', dbError);
        }
      }
      
      return;
    }
    // Other button handlers
    else {
      console.log(`Unhandled button type: ${interaction.customId}`);
      await interaction.reply({
        content: 'This action is not implemented yet.',
        flags: 64 // Use flags instead of ephemeral
      });
    }
  } catch (error) {
    console.error('Error handling button interaction:', error);
    try {
      // Check if already replied or deferred before attempting to reply
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `An error occurred: ${error.message}`,
          flags: 64 // Use flags instead of ephemeral
        });
      } else {
        await interaction.followUp({
          content: `An error occurred: ${error.message}`,
          flags: 64 // Use flags instead of ephemeral
        });
      }
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
      flags: 64 // Use flags instead of ephemeral
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
      flags: 64 // Use flags instead of ephemeral
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
      flags: 64 // Use flags instead of ephemeral
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
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // Extract the marker ID
    const markerId = request.marker_id;
    
    if (!markerId) {
      await interaction.reply({
        content: 'Error: No marker ID found in the request data.',
        flags: 64 // Use flags instead of ephemeral
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
        flags: 64 // Use flags instead of ephemeral
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
        flags: 64 // Use flags instead of ephemeral
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
      flags: 64 // Use flags instead of ephemeral
    });
  } catch (error) {
    console.error('Error in handleModifyEdit:', error);
    await interaction.reply({
      content: `An error occurred: ${error.message}`,
      flags: 64 // Use flags instead of ephemeral
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
  const request = await dbFunctions.getRequestByMessageId(messageId);
  
  if (!request) {
    await interaction.reply({
      content: 'Request not found in database.',
      flags: 64 // Use flags instead of ephemeral
    });
    return;
  }
  
  // Get the marker ID from the JSON fields
  let markerId = null;
  let currentData = {};
  let newData = {};
  
  // Try to extract the marker ID from current_data or new_data
  try {
    if (request.current_data) {
      currentData = JSON.parse(request.current_data);
      markerId = currentData.id;
    }
    
    if (request.new_data) {
      newData = JSON.parse(request.new_data);
      if (!markerId && newData.id) {
        markerId = newData.id;
      }
    }
  } catch (error) {
    console.error('Error parsing JSON data from request:', error);
  }
  
  // Fallback to the old marker_id column if it exists
  if (!markerId && request.marker_id) {
    markerId = request.marker_id;
  }
  
  if (!markerId) {
    console.error('No marker ID found in request data:', request);
    await interaction.reply({
      content: 'Error: No marker ID found in the request. Please check the request data.',
      flags: 64 // Use flags instead of ephemeral
    });
    return;
  }
  
  console.log(`Extracted marker ID: ${markerId}`);
  
  // Get the existing location using searchLocationsForAutocomplete instead of direct Prisma access
  try {
    const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
    
    if (!locations || locations.length === 0) {
      await interaction.reply({
        content: 'Error: Marker no longer exists in the database.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // Find the location by matching ID
    const existingLocation = locations.find(loc => loc.id === markerId);
    
    if (!existingLocation) {
      await interaction.reply({
        content: 'Error: Marker no longer exists in the database.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // Extract relevant fields for update
    const validFields = [
      'name', 'description', 'type', 'coordinates', 'icon', 
      'iconSize', 'mediaUrl', 'iconColor', 'radius',
      'isCoordinateSearch', 'lore', 'spoilers', 'noCluster', 'exactCoordinates'
    ];
    
    // Build update data object, ONLY including fields that actually changed
    let updateData = {};
    
    // Only update fields that have changed from currentData to newData
    for (const field of validFields) {
      // Only process fields present in newData
      if (newData[field] !== undefined) {
        // Check if the field actually changed
        const oldValue = currentData[field];
        const newValue = newData[field];
        
        // Compare values - for objects, stringify for comparison
        const oldValueStr = typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue);
        const newValueStr = typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue);
        
        if (oldValueStr !== newValueStr) {
          // Field has changed, include in update
          updateData[field] = newValue;
        }
      }
    }
    
    // Add metadata fields
    const now = new Date();
    updateData.lastModified = now;
    updateData.approvedBy = interaction.user.id;
    updateData.updatedAt = now;
    
    console.log('Update data prepared:', Object.keys(updateData));
    
    if (Object.keys(updateData).length === 0) {
      await interaction.reply({
        content: 'No changes detected between current and new data.',
        flags: 64 // Use flags instead of ephemeral
      });
      return;
    }
    
    // We can't use prisma.Location directly since bot's prisma doesn't have that model
    // Use a raw query via prisma.$executeRawUnsafe instead with proper type casting
    const setClauseParts = [];
    const queryParams = [];
    
    // Build the SET clause with proper type casting for each field
    for (const [key, value] of Object.entries(updateData)) {
      // Add parameter placeholder
      const paramIndex = queryParams.length + 1;
      
      // Handle different data types with proper casting
      if (['coordinates', 'mediaUrl', 'exactCoordinates'].includes(key)) {
        // Cast these fields to JSONB
        setClauseParts.push(`"${key}" = $${paramIndex}::jsonb`);
        // Add the parameter value - serialize objects to JSON strings
        queryParams.push(typeof value === 'object' && !(value instanceof Date) ? 
          JSON.stringify(value) : value);
      } 
      else if (['lastModified', 'updatedAt', 'createdAt', 'approvedAt'].includes(key) && value instanceof Date) {
        // Cast date fields to timestamp
        setClauseParts.push(`"${key}" = $${paramIndex}::timestamp`);
        // Format date as ISO string for PostgreSQL 
        queryParams.push(value.toISOString());
      }
      else {
        // Regular fields without casting
        setClauseParts.push(`"${key}" = $${paramIndex}`);
        queryParams.push(value);
      }
    }
    
    // Add ID as the last parameter for the WHERE clause
    queryParams.push(markerId);
    
    // Execute the update - build the complete query as a string
    const query = `UPDATE "Location" SET ${setClauseParts.join(', ')} WHERE id = $${queryParams.length}`;
    console.log('Executing update query:', query);
    
    // Execute the query with all parameters
    await prisma.$executeRawUnsafe(query, ...queryParams);
    
    console.log('Location updated successfully');
    
    // Update the request status
    await prisma.discordLocationRequest.update({
      where: { messageId: messageId },
      data: {
        status: 'implemented',
        approvedBy: interaction.user.id,
        approvedAt: new Date()
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
    
    // Reply to the interaction - use flags instead of ephemeral
    await interaction.reply({
      content: `✅ Edit request has been approved and implemented.`,
      flags: 64 // Use flags instead of ephemeral
    });
    
  } catch (error) {
    console.error('Error approving edit request:', error);
    await interaction.reply({
      content: `Error approving edit request: ${error.message}`,
      flags: 64 // Use flags instead of ephemeral
    });
  }
}

/**
 * Handle approve new location request button (for admins)
 */
async function handleApproveNew(interaction, prisma, dbFunctions, client, config) {
  const messageId = interaction.customId.split('_')[2];
  console.log(`Approving new location request in message: ${messageId}`);

  try {
    // Defer the reply while processing
    await interaction.deferReply({ flags: 64 });

    // Fetch the request from the database
    const request = await dbFunctions.getRequestByMessageId(messageId);

    if (!request) {
      await interaction.editReply('Request not found in database.');
      return;
    }

    if (request.request_type !== 'new' || request.status !== 'pending') {
      await interaction.editReply(`Request is not a pending 'new' request (Status: ${request.status}, Type: ${request.request_type}).`);
      return;
    }

    // Parse newData
    let newData;
    try {
      newData = JSON.parse(request.new_data);
      if (!newData || typeof newData !== 'object') throw new Error('newData is not a valid object.');
    } catch (error) {
      console.error('Error parsing newData JSON:', error);
      await interaction.editReply('Error parsing request data. Cannot implement.');
      return;
    }

    // --- Data Validation ---
    if (!newData.name || !newData.coordinates || !newData.description || !newData.type) {
      await interaction.editReply('Error: Request data is incomplete (missing name, coordinates, description, or type). Cannot implement.');
      return;
    }

    // --- Check for Existing Location (Exact Name Match) ---
    const existingLocations = await dbFunctions.searchLocationsForAutocomplete(newData.name);
    const exactMatch = existingLocations.find(loc => loc.name.toLowerCase() === newData.name.toLowerCase());

    let implementationMessage = ''; // To store the final success message

    if (exactMatch) {
      // --- Merge/Update Existing Location ---
      console.log(`Found exact match (ID: ${exactMatch.id}). Merging new data into existing location.`);
      implementationMessage = `✅ Merged new data into existing location "${exactMatch.name}".`;

      const markerId = exactMatch.id;
      let updateData = {};

      // Combine Coordinates
      const existingCoords = exactMatch.coordinates;
      const newCoords = newData.coordinates; // Already parsed array/object from submitNewMarkerRequest
      let combinedCoords;

      const isExistingMulti = Array.isArray(existingCoords) && Array.isArray(existingCoords[0]);
      const isNewMulti = Array.isArray(newCoords) && Array.isArray(newCoords[0]);

      if (!isExistingMulti) {
        // Convert existing single coord to multi-coord array
        combinedCoords = [existingCoords];
      } else {
        combinedCoords = [...existingCoords];
      }

      if (!isNewMulti) {
        // Add new single coord
        combinedCoords.push(newCoords);
      } else {
        // Add new multiple coords
        combinedCoords.push(...newCoords);
      }
      updateData.coordinates = combinedCoords;

      // Update Description if new one is provided and different
      if (newData.description && newData.description !== exactMatch.description) {
        updateData.description = newData.description;
        console.log(`Updating description for ${markerId}`);
      }

      // Update Type if new one is provided and different
      if (newData.type && newData.type !== exactMatch.type) {
        updateData.type = newData.type;
        console.log(`Updating type to ${newData.type} for ${markerId}`);
      }

      // Merge Media URLs
      let combinedMediaUrls = Array.isArray(exactMatch.mediaUrl) ? [...exactMatch.mediaUrl] : (exactMatch.mediaUrl ? [exactMatch.mediaUrl] : []);
      if (newData.mediaUrl) {
        const newUrls = Array.isArray(newData.mediaUrl) ? newData.mediaUrl : [newData.mediaUrl];
        newUrls.forEach(url => {
          if (!combinedMediaUrls.includes(url)) {
            combinedMediaUrls.push(url);
          }
        });
      }
      if (combinedMediaUrls.length > 0 && JSON.stringify(combinedMediaUrls) !== JSON.stringify(exactMatch.mediaUrl)) {
         updateData.mediaUrl = combinedMediaUrls;
         console.log(`Updating mediaUrl for ${markerId}`);
      }

      // Add metadata fields
      const now = new Date();
      updateData.lastModified = now;
      updateData.approvedBy = interaction.user.id; // Keep track of who approved this merge
      updateData.updatedAt = now;

      // --- Database Update ---
      if (Object.keys(updateData).length > 0) {
        const setClauseParts = [];
        const queryParams = [];

        for (const [key, value] of Object.entries(updateData)) {
          const paramIndex = queryParams.length + 1;
          if (['coordinates', 'mediaUrl', 'exactCoordinates'].includes(key)) {
            setClauseParts.push(`"${key}" = $${paramIndex}::jsonb`);
            queryParams.push(JSON.stringify(value));
          } else if (['lastModified', 'updatedAt'].includes(key) && value instanceof Date) {
            setClauseParts.push(`"${key}" = $${paramIndex}::timestamp`);
            queryParams.push(value.toISOString());
          } else {
            setClauseParts.push(`"${key}" = $${paramIndex}`);
            queryParams.push(value);
          }
        }
        queryParams.push(markerId); // For the WHERE clause

        const query = `UPDATE "Location" SET ${setClauseParts.join(', ')} WHERE id = $${queryParams.length}`;
        console.log('Executing UPDATE query:', query);
        await prisma.$executeRawUnsafe(query, ...queryParams);
        console.log(`Location ${markerId} updated successfully.`);
      } else {
        console.log(`No actual changes detected for merge into ${markerId}.`);
        implementationMessage = `ℹ️ No new data needed merging into existing location "${exactMatch.name}".`;
      }

    } else {
      // --- Create New Location ---
      console.log(`No exact match found. Creating new location "${newData.name}".`);
      implementationMessage = `✅ New location "${newData.name}" has been implemented.`;

      // Prepare Data for Insertion
      const insertData = {
        name: newData.name,
        description: newData.description,
        type: newData.type,
        coordinates: newData.coordinates, // Assumes coordinates are already correctly formatted JSON/array
        icon: newData.icon || null,
        iconSize: newData.iconSize || null,
        iconColor: newData.iconColor || null,
        mediaUrl: newData.mediaUrl || null, // Assumes mediaUrl is array or null
        radius: newData.radius || null,
        lore: newData.lore || null,
        spoilers: newData.spoilers || false,
        noCluster: newData.noCluster || false,
        exactCoordinates: newData.exactCoordinates || null,
        approvedBy: interaction.user.id,
        lastModified: new Date(),
        createdAt: new Date(), // Set createdAt on initial creation
        updatedAt: new Date()
      };

      // Database Insertion
      const columns = Object.keys(insertData).map(k => `"${k}"`).join(', ');
      const values = Object.values(insertData);

      const queryParams = values.map((value, index) => {
        const key = Object.keys(insertData)[index];
        if (['coordinates', 'mediaUrl', 'exactCoordinates'].includes(key) && typeof value === 'object' && value !== null) {
          return JSON.stringify(value);
        }
        if (['lastModified', 'createdAt', 'updatedAt'].includes(key) && value instanceof Date) {
          return value.toISOString();
        }
        return value;
      });

      const setClauseParts = Object.keys(insertData).map((key, index) => {
          const paramIndex = index + 1;
          if (['coordinates', 'mediaUrl', 'exactCoordinates'].includes(key)) {
              return `$${paramIndex}::jsonb`;
          }
          if (['lastModified', 'createdAt', 'updatedAt'].includes(key)) {
              return `$${paramIndex}::timestamp`;
          }
          return `$${paramIndex}`;
      });
      const insertQuery = `INSERT INTO "Location" (${columns}) VALUES (${setClauseParts.join(', ')})`;

      console.log('Executing INSERT query:', insertQuery);
      await prisma.$executeRawUnsafe(insertQuery, ...queryParams);
      console.log('New location created successfully');
    }

    // --- Update Request Status (Common for both merge and new) ---
    await prisma.discordLocationRequest.update({
      where: { messageId: messageId },
      data: {
        status: 'implemented',
        approvedBy: interaction.user.id,
        approvedAt: new Date()
      }
    });
    console.log('Request status updated to implemented');

    // --- Notify Web App ---
    await dbFunctions.notifyDatabaseChange();

    // --- Update Leaderboard ---
    await updateLeaderboard(client, dbFunctions.getContributorLeaderboard,
                          dbFunctions.getLeaderboardInfo, dbFunctions.setLeaderboardInfo,
                          config.LEADERBOARD_CHANNEL_ID);

    // --- Update Discord Message ---
    try {
      const message = interaction.message;
      const originalEmbed = message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor('#00FF00') // Green for approved
        .setTitle(`✅ IMPLEMENTED: ${originalEmbed.title}`)
        .addFields(
          { name: 'Implemented By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Implemented At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        );
      await message.edit({ embeds: [updatedEmbed], components: [] }); // Remove buttons
      console.log('Message updated to show implementation');
    } catch (messageError) {
      console.error('Error updating message:', messageError);
    }

    // --- Final Reply ---
    await interaction.editReply(implementationMessage); // Use the dynamic message

  } catch (error) {
    console.error('Error approving new location request:', error);
    // Ensure we reply even if an error occurs mid-process
    // Check if interaction is still editable before trying to editReply
    if (interaction.editable) {
        try {
            await interaction.editReply(`Error approving request: ${error.message}`);
        } catch (replyError) {
            console.error("Failed to send error reply:", replyError);
        }
    } else {
        console.error("Interaction no longer editable, cannot send error reply.");
    }
  }
}

/**
 * Format coordinates for storage in database
 * Handles various input formats and ensures proper structure
 */
function formatCoordinatesForStorage(coordinates) {
  // If already in proper format (array), return as is
  if (Array.isArray(coordinates)) {
    // Check if it's a flat [x,y] pair
    if (coordinates.length === 2 && typeof coordinates[0] === 'number') {
      return coordinates; // Return as is - single coordinate pair
    }
    
    // Check if it's an array of coordinate pairs
    if (coordinates.length > 0 && Array.isArray(coordinates[0])) {
      // Validate each pair
      return coordinates.map(coord => {
        if (Array.isArray(coord) && coord.length === 2 && 
            typeof coord[0] === 'number' && typeof coord[1] === 'number') {
          return coord; // Valid coordinate pair
        }
        // Invalid pair, return [0,0] to prevent errors
        console.warn('Invalid coordinate pair found, replacing with [0,0]');
        return [0, 0];
      });
    }
  }
  
  // If it's a string, try to parse it
  if (typeof coordinates === 'string') {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(coordinates);
      // Recursive call with parsed result
      return formatCoordinatesForStorage(parsed);
    } catch (e) {
      // Not valid JSON, try to parse as comma-separated format "[[X1,Y1],[X2,Y2]]"
      try {
        const coordRegex = /\[\s*(\d+\.?\d*)\s*,\s*(\d+\.?\d*)\s*\]/g;
        const matches = [...coordinates.matchAll(coordRegex)];
        
        if (matches.length === 0) {
          console.warn('No valid coordinates found in string');
          return [[0, 0]]; // Default to prevent errors
        }
        
        if (matches.length === 1) {
          // Single coordinate pair
          return [parseFloat(matches[0][1]), parseFloat(matches[0][2])];
        } else {
          // Multiple coordinates
          return matches.map(match => [parseFloat(match[1]), parseFloat(match[2])]);
        }
      } catch (parseError) {
        console.error('Error parsing coordinate string:', parseError);
        return [[0, 0]]; // Default to prevent errors
      }
    }
  }
  
  // Fallback for unknown formats
  console.warn('Unknown coordinate format, using default [0,0]');
  return [[0, 0]];
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
  
  // Note: The actual denial logic happens in the modalHandler when the reason is submitted
  // No DMs are sent in this implementation
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
      flags: 64 // Use flags instead of ephemeral
    });
    return;
  }
  
  if (!request) {
    await interaction.reply({
      content: 'Request not found.',
      flags: 64 // Use flags instead of ephemeral
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
      flags: 64 // Use flags instead of ephemeral
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

/**
 * Check if user has permission for a request action
 */
function hasPermissionForRequest(interaction, requesterId) {
  // If this is the requester, they can cancel their own request
  if (interaction.user.id === requesterId) {
    return true;
  }
  
  // If they have the admin role, they can handle any request
  const member = interaction.member;
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (member && adminRoleId && member.roles.cache.has(adminRoleId)) {
    return true;
  }
  
  return false;
}

module.exports = {
  handleButtonInteraction
};
