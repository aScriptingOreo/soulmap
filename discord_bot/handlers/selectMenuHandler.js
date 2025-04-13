const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

/**
 * Handle select menu interactions
 */
async function handleSelectMenuInteraction(interaction, prisma, dbFunctions) {
  try {
    console.log(`Select menu interaction received: ${interaction.customId}, value: ${interaction.values[0]}`);
    
    // Log prisma object to verify it's defined
    console.log('Prisma object received in selectMenuHandler:', prisma ? 'defined' : 'undefined');
    
    // Handle coordinate selection for admin editing
    if (interaction.customId.startsWith('select_coord_') && !interaction.customId.includes('req_')) {
      try {
        const markerId = interaction.customId.split('_')[2];
        const selectedValue = interaction.values[0]; // Get the selected coordinate index
        
        console.log(`Admin coordinate selection: markerId=${markerId}, coordIndex=${selectedValue}`);
        
        // Update the message with new buttons targeting the selected coordinate
        const editBtn = new ButtonBuilder()
          .setCustomId(`edit_marker_btn_${markerId}_${selectedValue}`)
          .setLabel('Edit Selected Coordinate')
          .setStyle(ButtonStyle.Primary);
          
        const cancelBtn = new ButtonBuilder()
          .setCustomId('cancel_edit')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary);
        
        const row = new ActionRowBuilder().addComponents(editBtn, cancelBtn);
        
        // Get original embeds
        const embeds = interaction.message.embeds;
        
        // Update the message
        await interaction.update({
          content: `You selected ${selectedValue === '*' ? 'all coordinates' : `coordinate #${parseInt(selectedValue) + 1}`}. Click the button below to proceed.`,
          components: [row],
          embeds: embeds
        });
      } catch (error) {
        console.error('Error handling admin coordinate selection:', error);
        await interaction.update({
          content: `Error selecting coordinate: ${error.message}`,
          components: [],
          embeds: []
        });
      }
    }
    // Handle coordinate selection for user edit requests
    else if (interaction.customId.startsWith('select_coord_req_')) {
      try {
        const parts = interaction.customId.split('_');
        const markerId = parts[3];
        const userId = parts[4];
        const selectedValue = interaction.values[0]; // Get the selected coordinate index
        
        console.log(`User coordinate selection: markerId=${markerId}, userId=${userId}, coordIndex=${selectedValue}`);
        
        // Update the message with new buttons targeting the selected coordinate
        const requestBtn = new ButtonBuilder()
          .setCustomId(`req_edit_proceed_${markerId}_${selectedValue}_${userId}`)
          .setLabel('Submit Edit Request')
          .setStyle(ButtonStyle.Primary);
          
        const cancelBtn = new ButtonBuilder()
          .setCustomId('cancel_edit_request')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary);
        
        const row = new ActionRowBuilder().addComponents(requestBtn, cancelBtn);
        
        // Get original embeds
        const embeds = interaction.message.embeds;
        
        // Update the message
        await interaction.update({
          content: `You selected ${selectedValue === '*' ? 'all coordinates' : `coordinate #${parseInt(selectedValue) + 1}`}. Click the button below to submit your edit request.`,
          components: [row],
          embeds: embeds
        });
      } catch (error) {
        console.error('Error handling user coordinate selection:', error);
        await interaction.update({
          content: `Error selecting coordinate: ${error.message}`,
          components: [],
          embeds: []
        });
      }
    }
    // Handle field selection for editing
    else if (interaction.customId.startsWith('select_edit_field_')) {
      try {
        const parts = interaction.customId.split('_');
        const markerId = parts[3];
        const coordIndex = parts[4];
        const userId = parts[5];
        const fieldToEdit = interaction.values[0]; // name, description, type, etc.
        
        console.log(`Field selection: markerId=${markerId}, coordIndex=${coordIndex}, field=${fieldToEdit}`);
        
        // Validate that prisma is defined and dbFunctions is available
        if (!prisma) {
          throw new Error('Prisma client is undefined in selectMenuHandler');
        }
        
        if (!dbFunctions || !dbFunctions.searchLocationsForAutocomplete) {
          throw new Error('searchLocationsForAutocomplete function is not available');
        }
        
        console.log('Available Prisma models:', Object.keys(prisma));
        console.log('Using searchLocationsForAutocomplete to find marker by ID');
        
        // Use the existing searchLocationsForAutocomplete function as a workaround
        // since Location model is not directly accessible in the bot's Prisma client
        const locations = await dbFunctions.searchLocationsForAutocomplete(markerId);
        
        // Find the location by ID
        const marker = locations.find(loc => loc.id === markerId);
        
        console.log('Query result:', marker ? 'Found marker' : 'Marker not found');
        
        if (!marker) {
          await interaction.update({
            content: 'This marker could not be found. It may have been deleted.',
            components: [],
            embeds: []
          });
          return;
        }

        // Show the appropriate modal for the selected field
        switch (fieldToEdit) {
          case 'name':
            await showNameEditModal(interaction, marker, coordIndex, userId);
            break;
          case 'description':
            await showDescriptionEditModal(interaction, marker, coordIndex, userId);
            break;
          case 'type':
            await showTypeEditModal(interaction, marker, coordIndex, userId);
            break;
          case 'icon':
            await showIconEditModal(interaction, marker, coordIndex, userId);
            break;
          case 'coordinates':
            await showCoordinatesEditModal(interaction, marker, coordIndex, userId);
            break;
          default:
            await interaction.update({
              content: `Edit for field "${fieldToEdit}" is not supported yet.`,
              components: [],
              embeds: []
            });
        }
      } catch (error) {
        console.error('Error handling field selection:', error);
        await interaction.update({
          content: `Error selecting field to edit: ${error.message}`,
          components: [],
          embeds: []
        });
      }
    }
    // Handle admin edit field selection
    else if (interaction.customId.startsWith('admin_edit_field_')) {
      await handleAdminEditField(interaction, prisma, dbFunctions);
    }
    // Log any unhandled select menu IDs
    else {
      console.log(`Unhandled select menu interaction: ${interaction.customId}`);
      await interaction.update({
        content: 'This action is not currently implemented.',
        components: []
      });
    }
  } catch (error) {
    console.error('Error handling select menu interaction:', error);
    try {
      // Use update if possible
      await interaction.update({
        content: `An error occurred: ${error.message}`,
        components: [],
        embeds: []
      });
    } catch (updateError) {
      // Fall back to reply
      try {
        await interaction.reply({
          content: `An error occurred: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error('Could not respond to interaction:', replyError);
      }
    }
  }
}

/**
 * Handle admin edit field selection
 */
async function handleAdminEditField(interaction, prisma, dbFunctions) {
  const messageId = interaction.message.id;
  const parts = interaction.customId.split('_');
  const requestId = parts[3]; // This is actually the message ID 
  const markerId = parts[4];
  const fieldToEdit = interaction.values[0];
  
  console.log(`Admin editing field: ${fieldToEdit} for message ${messageId}, marker ${markerId}`);
  
  // Get the admin's edit session
  const adminUserId = interaction.user.id;
  const adminEditSession = await dbFunctions.getEditSession(adminUserId, markerId);
  
  // If no edit session found, try to create one from the request
  if (!adminEditSession || !adminEditSession.edits || Object.keys(adminEditSession.edits).length === 0) {
    console.log('No edit session found, creating from request');
    const isAdmin = true;
    await dbFunctions.createSessionFromRequest(adminUserId, requestId, isAdmin);
    const newSession = await dbFunctions.getEditSession(adminUserId, markerId);
    
    if (!newSession || !newSession.edits || Object.keys(newSession.edits).length === 0) {
      await interaction.reply({
        content: 'Failed to create edit session from request data.',
        ephemeral: true
      });
      return;
    }
  }
  
  // Get the field data from admin's session (get again to ensure we have latest)
  const updatedSession = await dbFunctions.getEditSession(adminUserId, markerId);
  const fieldData = updatedSession.edits[fieldToEdit];
  
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
  
  // Create input field with current value
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
 * Show modal for editing marker name
 */
async function showNameEditModal(interaction, marker, coordIndex, userId) {
  try {
    const modal = new ModalBuilder()
      .setCustomId(`req_edit_name_${marker.id}_${coordIndex}_${userId}`)
      .setTitle(`Edit Name: ${marker.name}`);
    
    // Add input field for the name (no reason field)
    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('New Name')
      .setStyle(TextInputStyle.Short)
      .setValue(marker.name)
      .setRequired(true);
    
    // Create action row
    const nameRow = new ActionRowBuilder().addComponents(nameInput);
    
    // Add the component to the modal
    modal.addComponents(nameRow);
    
    // Show the modal to the user
    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error showing name edit modal:', error);
    throw error; // Re-throw to be caught by the main handler
  }
}

/**
 * Show modal for editing marker description
 */
async function showDescriptionEditModal(interaction, marker, coordIndex, userId) {
  try {
    const modal = new ModalBuilder()
      .setCustomId(`req_edit_description_${marker.id}_${coordIndex}_${userId}`)
      .setTitle(`Edit Description: ${marker.name}`);
    
    // Add input field for the description (no reason field)
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('New Description')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(marker.description || '')
      .setRequired(true);
    
    // Create action row
    const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
    
    // Add the component to the modal
    modal.addComponents(descriptionRow);
    
    // Show the modal to the user
    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error showing description edit modal:', error);
    throw error;
  }
}

/**
 * Show modal for editing marker type
 */
async function showTypeEditModal(interaction, marker, coordIndex, userId) {
  try {
    const modal = new ModalBuilder()
      .setCustomId(`req_edit_type_${marker.id}_${coordIndex}_${userId}`)
      .setTitle(`Edit Type: ${marker.name}`);
    
    // Add input field for the type (no reason field)
    const typeInput = new TextInputBuilder()
      .setCustomId('type')
      .setLabel('New Type')
      .setStyle(TextInputStyle.Short)
      .setValue(marker.type || '')
      .setPlaceholder('location, poi, quest, camp, dungeon, resource, user_submitted')
      .setRequired(true);
    
    // Create action row
    const typeRow = new ActionRowBuilder().addComponents(typeInput);
    
    // Add the component to the modal
    modal.addComponents(typeRow);
    
    // Show the modal to the user
    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error showing type edit modal:', error);
    throw error;
  }
}

/**
 * Show modal for editing marker icon
 */
async function showIconEditModal(interaction, marker, coordIndex, userId) {
  try {
    const modal = new ModalBuilder()
      .setCustomId(`req_edit_icon_${marker.id}_${coordIndex}_${userId}`)
      .setTitle(`Edit Icon: ${marker.name}`);
    
    // Add input field for the icon (no reason field)
    const iconInput = new TextInputBuilder()
      .setCustomId('icon')
      .setLabel('New Icon')
      .setStyle(TextInputStyle.Short)
      .setValue(marker.icon || '')
      .setPlaceholder('e.g., fa-solid fa-house')
      .setRequired(true);
    
    // Create action row
    const iconRow = new ActionRowBuilder().addComponents(iconInput);
    
    // Add the component to the modal
    modal.addComponents(iconRow);
    
    // Show the modal to the user
    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error showing icon edit modal:', error);
    throw error;
  }
}

/**
 * Show modal for editing marker coordinates
 */
async function showCoordinatesEditModal(interaction, marker, coordIndex, userId) {
  try {
    let modalTitle = `Edit Coordinates: ${marker.name}`;
    let coordValue = '';
    
    // Get coordinates for display
    try {
      const coords = marker.coordinates;
      
      // Format coordinates field based on selection
      if (coordIndex === '*') {
        // For wildcard, show all coordinates
        modalTitle = `Edit All Coordinates: ${marker.name}`;
        
        if (Array.isArray(coords)) {
          if (coords.length === 2 && typeof coords[0] === 'number') {
            coordValue = `[${coords[0]}, ${coords[1]}]`;
          } else {
            coordValue = coords.map(coord => {
              if (Array.isArray(coord) && coord.length === 2) {
                return `[${coord[0]}, ${coord[1]}]`;
              }
              return '[0, 0]';
            }).join('\n');
          }
        }
      } else if (coordIndex !== undefined) {
        // For specific index, show only that coordinate
        modalTitle = `Edit Coordinate #${parseInt(coordIndex) + 1}: ${marker.name}`;
        
        if (Array.isArray(coords)) {
          if (coords.length === 2 && typeof coords[0] === 'number') {
            coordValue = `[${coords[0]}, ${coords[1]}]`;
          } else if (coords.length > parseInt(coordIndex)) {
            const coordData = coords[parseInt(coordIndex)];
            if (Array.isArray(coordData) && coordData.length === 2) {
              coordValue = `[${coordData[0]}, ${coordData[1]}]`;
            }
          }
        }
      } else {
        // Single coordinate, show as is
        if (Array.isArray(coords)) {
          if (coords.length === 2 && typeof coords[0] === 'number') {
            coordValue = `[${coords[0]}, ${coords[1]}]`;
          } else {
            coordValue = coords.map(coord => {
              if (Array.isArray(coord) && coord.length === 2) {
                return `[${coord[0]}, ${coord[1]}]`;
              }
              return '[0, 0]';
            }).join('\n');
          }
        }
      }
    } catch (e) {
      console.error('Error processing coordinates for modal:', e);
      coordValue = '[0, 0]';
    }
    
    const modal = new ModalBuilder()
      .setCustomId(`req_edit_coordinates_${marker.id}_${coordIndex || '*'}_${userId}`)
      .setTitle(modalTitle);
    
    // Add input field for the coordinates (no reason field)
    const coordsInput = new TextInputBuilder()
      .setCustomId('coordinates')
      .setLabel('New Coordinates')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(coordValue)
      .setPlaceholder('Format: [X, Y] or multiple coordinates, one per line')
      .setRequired(true);
    
    // Create action row
    const coordsRow = new ActionRowBuilder().addComponents(coordsInput);
    
    // Add the component to the modal
    modal.addComponents(coordsRow);
    
    // Show the modal to the user
    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error showing coordinates edit modal:', error);
    throw error;
  }
}

module.exports = {
  handleSelectMenuInteraction
};
