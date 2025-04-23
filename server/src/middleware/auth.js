import fetch from 'node-fetch';

const DISCORD_API_URL = 'https://discord.com/api/v10';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || 'dev-token'; // Use env var

export async function authenticateAdmin(req, res, next) {
  console.log('authenticateAdmin middleware triggered.');

  // Check for Authorization: Bearer header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    console.log('Received Bearer token.'); // Log token type

    // Check if it matches the static admin token
    if (token === ADMIN_API_TOKEN) {
      console.log('Auth success: Static admin token (Bearer) matched.');
      req.user = { id: 'admin_token_user', username: 'AdminTokenUser' }; 
      return next();
    } else {
       // If Bearer token doesn't match static token, treat as invalid for admin access
       // Or optionally, proceed to Discord validation if desired
       console.log('Auth failed: Bearer token does not match static admin token.');
       // If you ONLY want the static token to work for admin routes, uncomment the next line:
       // return res.status(401).json({ error: 'Unauthorized: Invalid admin token' });
       
       // If you want to allow Discord tokens as well (less secure for admin), proceed to Discord check:
       // console.log('Bearer token did not match static token, attempting Discord validation...');
       // Fall through to Discord validation below (if needed)
    }
  }

  // Fallback/Alternative: Check for X-Admin-Token header (keep for backward compatibility if needed)
  const adminTokenHeader = req.headers['x-admin-token'];
  if (adminTokenHeader && adminTokenHeader === ADMIN_API_TOKEN) {
    console.log('Auth success: Static admin token (X-Admin-Token header) matched.');
    req.user = { id: 'admin_token_user', username: 'AdminTokenUser' };
    return next();
  }

  // If neither the Bearer token nor the X-Admin-Token matches the static token,
  // and you are NOT falling through to Discord validation for admin routes, deny access.
  console.log('Auth failed: No valid admin token found in Authorization or X-Admin-Token header.');
  return res.status(401).json({ error: 'Unauthorized: Missing or invalid admin token' });


  // --- Optional Discord Token Validation (If you want admins to also log in via Discord) ---
  // This part is likely NOT needed if you rely solely on the static ADMIN_API_TOKEN for admin actions.
  /*
  if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const response = await fetch(`${DISCORD_API_URL}/users/@me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          console.log(`Auth failed: Discord token validation failed (${response.status}).`);
          return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }

        const user = await response.json();
        // IMPORTANT: Add role check here if using Discord auth for admin
        // const isAdmin = user.roles?.includes('YOUR_ADMIN_ROLE_ID');
        // if (!isAdmin) {
        //   console.log(`Auth failed: User ${user.username lacks required admin role.`);
        //   return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        // }
        
        req.user = user; 
        console.log(`Auth success: Discord user ${user.username} authenticated.`);
        return next(); // Grant access only if Discord validation AND role check pass
      } catch (error) {
        console.error('Authentication error:', error);
        return res.status(500).json({ error: 'Internal server error during authentication' });
      }
  }
  */
  // --- End Optional Discord Token Validation ---

  // If we reach here, no valid authentication method was found.
  // console.log('Auth failed: No valid authentication method provided.'); // Already logged above
  // return res.status(401).json({ error: 'Unauthorized' }); // Already handled above
}
