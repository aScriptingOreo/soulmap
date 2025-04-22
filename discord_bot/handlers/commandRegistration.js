const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

/**
 * Register slash commands with Discord API
 */
async function registerCommands(client, token) {
  try {
    console.log('Registering slash commands...');
    
    const commands = [
      // User request command with subcommands
      {
        name: 'request',
        description: 'Submit location requests for Soulmap',
        options: [
          {
            name: 'new',
            description: 'Submit a new location request',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'name',
                description: 'Name for the location',
                type: ApplicationCommandOptionType.String,
                required: true
              }
              // Removed coordinates, description, and screenshot options
              // These will be requested after the initial disambiguation step
            ]
          },
          {
            name: 'edit',
            description: 'Request to edit an existing location',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'name',
                description: 'Name of the location to edit',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
              },
            ]
          },
          {
            name: 'remove',
            description: 'Request to remove a location or coordinate',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'name',
                description: 'Name of the location to remove',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
              }
            ]
          }
        ]
      },
      
      // Admin command with subcommands
      {
        name: 'admin',
        description: 'Manage Soulmap locations (admin only)',
        options: [
          {
            name: 'new',
            description: 'Add a new location to the database',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'name',
                description: 'Location name',
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: 'coordinates',
                description: 'Coordinates in [X, Y] format, can use multiple like [X,Y],[X,Y]',
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: 'type',
                description: 'Location type/category',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                  { name: 'Location', value: 'location' },
                  { name: 'POI', value: 'poi' },
                  { name: 'Quest', value: 'quest' },
                  { name: 'Camp', value: 'camp' },
                  { name: 'Dungeon', value: 'dungeon' },
                  { name: 'Resource', value: 'resource' },
                  { name: 'User Submitted', value: 'user_submitted' }
                ]
              },
              {
                name: 'description',
                description: 'Location description',
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: 'icon',
                description: 'Icon (e.g. fa-solid fa-house)',
                type: ApplicationCommandOptionType.String,
                required: false
              },
              {
                name: 'media_url',
                description: 'URL to media (image/video)',
                type: ApplicationCommandOptionType.String,
                required: false
              }
            ]
          },
          {
            name: 'edit',
            description: 'Edit an existing location',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'name',
                description: 'Name of the location to edit',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
              }
            ]
          },
          {
            name: 'delete',
            description: 'Delete a location or coordinate',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'name',
                description: 'Name of the location to delete',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
              }
            ]
          },
          {
            name: 'undo',
            description: 'Undo a previously implemented change',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'id',
                description: 'Database ID of the change to undo',
                type: ApplicationCommandOptionType.String,
                required: true
              }
            ]
          },
          {
            name: 'info',
            description: 'Get information about a request',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'id',
                description: 'Database ID of the request',
                type: ApplicationCommandOptionType.String,
                required: true
              }
            ]
          }
        ]
      },
      
      // List requests command
      {
        name: 'listrequests',
        description: 'List all location requests (admin only)',
        options: [
          {
            name: 'status',
            description: 'Filter by status (pending, implemented, dismissed)',
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
              { name: 'Pending', value: 'pending' },
              { name: 'Implemented', value: 'implemented' },
              { name: 'Dismissed', value: 'dismissed' },
              { name: 'All', value: 'all' }
            ]
          }
        ]
      },
      
      // Import locations command
      {
        name: 'importlocations',
        description: 'Import locations from YAML files to database (admin only)',
        options: []
      },
      
      // New whereis command for everyone
      {
        name: 'whereis',
        description: 'Get a link to a location on the map',
        options: [
          {
            name: 'location',
            description: 'Name of the location to find',
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true
          }
        ]
      }
    ];
    
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Error registering slash commands:', error);
    throw error;
  }
}

module.exports = {
  registerCommands
};
