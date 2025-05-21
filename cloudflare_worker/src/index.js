import { Router, error, json } from 'itty-router';

// Create a new router
const router = Router();

// Middleware to handle JSON parsing and add DB to request
const withDB = async (request, env) => {
  request.db = env.DB;
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      request.json_data = await request.json();
    } catch (err) {
      return error(400, 'Invalid JSON');
    }
  }
};

// --- Player Endpoints ---

// GET /api/players - Fetch all players
router.get('/api/players', withDB, async (request) => {
  try {
    const { results } = await request.db.prepare('SELECT id, name, skill FROM players ORDER BY name_lower ASC').all();
    return json(results);
  } catch (e) {
    return error(500, { message: 'Failed to fetch players', error: e.message });
  }
});

// POST /api/players - Add a new player
router.post('/api/players', withDB, async (request) => {
  const { name, skill } = request.json_data;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return error(400, 'Player name is required and must be a non-empty string.');
  }
  if (skill === undefined || typeof skill !== 'number' || skill < 1 || skill > 10) {
    return error(400, 'Player skill is required and must be an integer between 1 and 10.');
  }

  const id = crypto.randomUUID();
  const name_lower = name.toLowerCase();

  try {
    // Check if player with the same name (case-insensitive) already exists
    const existingPlayer = await request.db.prepare('SELECT id FROM players WHERE name_lower = ?1')
      .bind(name_lower)
      .first();

    if (existingPlayer) {
      return error(409, `Player with name "${name}" already exists.`);
    }

    await request.db.prepare('INSERT INTO players (id, name, name_lower, skill) VALUES (?1, ?2, ?3, ?4)')
      .bind(id, name, name_lower, skill)
      .run();
    return json({ id, name, name_lower, skill }, { status: 201 });
  } catch (e) {
    console.error('DB Error:', e);
    if (e.message?.includes('UNIQUE constraint failed: players.name_lower')) {
        return error(409, `Player with name "${name}" already exists.`);
    }
    return error(500, { message: 'Failed to add player', error: e.message });
  }
});

// GET /api/players/:id - Fetch a single player by ID
router.get('/api/players/:id', withDB, async (request) => {
  const { id } = request.params;
  if (!id) {
    return error(400, 'Player ID is required.');
  }

  try {
    const player = await request.db.prepare('SELECT id, name, skill FROM players WHERE id = ?1')
      .bind(id)
      .first();

    if (!player) {
      return error(404, 'Player not found.');
    }
    return json(player);
  } catch (e) {
    return error(500, { message: 'Failed to fetch player', error: e.message });
  }
});

// PUT /api/players/:id - Update a player's name or skill
router.put('/api/players/:id', withDB, async (request) => {
  const { id } = request.params;
  if (!id) {
    return error(400, 'Player ID is required.');
  }

  const { name, skill } = request.json_data;

  if (!name && skill === undefined) {
    return error(400, 'Either name or skill must be provided for an update.');
  }

  const updates = [];
  const bindings = [];
  let bindingIndex = 1;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return error(400, 'Player name must be a non-empty string if provided.');
    }
    updates.push(`name = ?${bindingIndex++}`);
    bindings.push(name);
    updates.push(`name_lower = ?${bindingIndex++}`);
    bindings.push(name.toLowerCase());
  }

  if (skill !== undefined) {
    if (typeof skill !== 'number' || skill < 1 || skill > 10) {
      return error(400, 'Player skill must be an integer between 1 and 10 if provided.');
    }
    updates.push(`skill = ?${bindingIndex++}`);
    bindings.push(skill);
  }

  bindings.push(id); // For the WHERE clause

  if (updates.length === 0) {
    return error(400, 'No valid fields to update.');
  }

  const stmt = `UPDATE players SET ${updates.join(', ')} WHERE id = ?${bindingIndex}`;

  try {
    const info = await request.db.prepare(stmt).bind(...bindings).run();
    if (info.changes === 0) {
      // Check if the player actually exists
      const playerExists = await request.db.prepare('SELECT id FROM players WHERE id = ?1').bind(id).first();
      if (!playerExists) {
        return error(404, 'Player not found.');
      }
      // If player exists but no changes, it might mean data is the same.
      // Or, if name_lower check is needed for uniqueness on update:
      if (name) {
        const existingPlayerWithNewName = await request.db.prepare('SELECT id FROM players WHERE name_lower = ?1 AND id != ?2')
          .bind(name.toLowerCase(), id)
          .first();
        if (existingPlayerWithNewName) {
          return error(409, `Another player with name "${name}" already exists.`);
        }
      }
      // If no rows changed and player exists, could return 200 or 304 (Not Modified)
      // For simplicity, let's assume an update should change something if data is different.
      // If we reach here, it means the data provided was the same as existing or player not found.
      // The info.changes check handles this.
    }
     const updatedPlayer = await request.db.prepare('SELECT id, name, skill FROM players WHERE id = ?1')
      .bind(id)
      .first();
    return json(updatedPlayer);
  } catch (e) {
     if (e.message?.includes('UNIQUE constraint failed: players.name_lower')) {
        return error(409, `Another player with name "${name}" already exists.`);
    }
    return error(500, { message: 'Failed to update player', error: e.message });
  }
});

// DELETE /api/players/:id - Delete a player
router.delete('/api/players/:id', withDB, async (request) => {
  const { id } = request.params;
  if (!id) {
    return error(400, 'Player ID is required.');
  }

  try {
    // First, check if the player exists
    const player = await request.db.prepare('SELECT id FROM players WHERE id = ?1').bind(id).first();
    if (!player) {
      return error(404, 'Player not found.');
    }

    // Delete player from outing_players first (or rely on CASCADE DELETE if setup)
    // For explicit control, we can do it here:
    await request.db.prepare('DELETE FROM outing_players WHERE player_id = ?1').bind(id).run();
    
    // Then delete the player
    const info = await request.db.prepare('DELETE FROM players WHERE id = ?1').bind(id).run();

    // if (info.changes === 0) { // This check is now redundant due to the check above
    //   return error(404, 'Player not found or already deleted.');
    // }
    return json({ message: 'Player deleted successfully' }, { status: 200 }); // Or 204 No Content
  } catch (e) {
    return error(500, { message: 'Failed to delete player', error: e.message });
  }
});


// --- Outing Endpoints ---

// GET /api/outings - Fetch all outings
router.get('/api/outings', withDB, async (request) => {
  try {
    const { results } = await request.db.prepare('SELECT id, name, number_of_groups FROM outings ORDER BY name ASC').all();
    return json(results);
  } catch (e) {
    return error(500, { message: 'Failed to fetch outings', error: e.message });
  }
});

// POST /api/outings - Create a new outing
router.post('/api/outings', withDB, async (request) => {
  let { name, numberOfGroups } = request.json_data;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return error(400, 'Outing name is required and must be a non-empty string.');
  }
  if (numberOfGroups !== undefined && (typeof numberOfGroups !== 'number' || !Number.isInteger(numberOfGroups) || numberOfGroups < 1)) {
    return error(400, 'Number of groups must be a positive integer if provided.');
  }
  if (numberOfGroups === undefined) {
    numberOfGroups = 3; // Default value
  }

  const id = crypto.randomUUID();

  try {
    await request.db.prepare('INSERT INTO outings (id, name, number_of_groups) VALUES (?1, ?2, ?3)')
      .bind(id, name, numberOfGroups)
      .run();
    return json({ id, name, numberOfGroups }, { status: 201 });
  } catch (e) {
    return error(500, { message: 'Failed to create outing', error: e.message });
  }
});

// GET /api/outings/:id - Fetch a single outing by ID
router.get('/api/outings/:id', withDB, async (request) => {
  const { id } = request.params;
  if (!id) {
    return error(400, 'Outing ID is required.');
  }

  try {
    const outing = await request.db.prepare('SELECT id, name, number_of_groups FROM outings WHERE id = ?1')
      .bind(id)
      .first();

    if (!outing) {
      return error(404, 'Outing not found.');
    }
    return json(outing);
  } catch (e) {
    return error(500, { message: 'Failed to fetch outing', error: e.message });
  }
});

// PUT /api/outings/:id - Update outing details
router.put('/api/outings/:id', withDB, async (request) => {
  const { id } = request.params;
  if (!id) {
    return error(400, 'Outing ID is required.');
  }

  const { name, numberOfGroups } = request.json_data;

  if (name === undefined && numberOfGroups === undefined) {
    return error(400, 'Either name or numberOfGroups must be provided for an update.');
  }

  const updates = [];
  const bindings = [];
  let bindingIndex = 1;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return error(400, 'Outing name must be a non-empty string if provided.');
    }
    updates.push(`name = ?${bindingIndex++}`);
    bindings.push(name);
  }

  if (numberOfGroups !== undefined) {
    if (typeof numberOfGroups !== 'number' || !Number.isInteger(numberOfGroups) || numberOfGroups < 1) {
      return error(400, 'Number of groups must be a positive integer if provided.');
    }
    updates.push(`number_of_groups = ?${bindingIndex++}`);
    bindings.push(numberOfGroups);
  }

  bindings.push(id); // For the WHERE clause

  if (updates.length === 0) {
     // This case should ideally be caught by the initial check, but as a safeguard:
    return error(400, 'No valid fields to update.');
  }

  const stmt = `UPDATE outings SET ${updates.join(', ')} WHERE id = ?${bindingIndex}`;

  try {
    const info = await request.db.prepare(stmt).bind(...bindings).run();
    if (info.changes === 0) {
       const outingExists = await request.db.prepare('SELECT id FROM outings WHERE id = ?1').bind(id).first();
        if (!outingExists) {
            return error(404, 'Outing not found.');
        }
      // If outing exists but no changes, data might be same.
    }
    const updatedOuting = await request.db.prepare('SELECT id, name, number_of_groups FROM outings WHERE id = ?1')
      .bind(id)
      .first();
    return json(updatedOuting);
  } catch (e) {
    return error(500, { message: 'Failed to update outing', error: e.message });
  }
});

// DELETE /api/outings/:id - Delete an outing
router.delete('/api/outings/:id', withDB, async (request) => {
  const { id } = request.params;
  if (!id) {
    return error(400, 'Outing ID is required.');
  }

  try {
    // Check if outing exists before attempting delete
    const outing = await request.db.prepare('SELECT id FROM outings WHERE id = ?1').bind(id).first();
    if (!outing) {
      return error(404, 'Outing not found.');
    }
    // Relies on ON DELETE CASCADE for outing_players entries
    await request.db.prepare('DELETE FROM outings WHERE id = ?1').bind(id).run();
    return json({ message: 'Outing deleted successfully' }, { status: 200 }); // Or 204
  } catch (e) {
    return error(500, { message: 'Failed to delete outing', error: e.message });
  }
});


// --- Outing Players Endpoints ---

// GET /api/outings/:outingId/players - List players in an outing
router.get('/api/outings/:outingId/players', withDB, async (request) => {
  const { outingId } = request.params;
  if (!outingId) {
    return error(400, 'Outing ID is required.');
  }

  try {
    // Check if outing exists
    const outing = await request.db.prepare('SELECT id FROM outings WHERE id = ?1').bind(outingId).first();
    if (!outing) {
      return error(404, 'Outing not found.');
    }

    const { results } = await request.db.prepare(
      'SELECT p.id, p.name, p.skill FROM players p ' +
      'JOIN outing_players op ON p.id = op.player_id ' +
      'WHERE op.outing_id = ?1 ORDER BY p.name_lower ASC'
    ).bind(outingId).all();
    return json(results);
  } catch (e) {
    return error(500, { message: 'Failed to fetch players for the outing', error: e.message });
  }
});

// POST /api/outings/:outingId/players - Add a player to an outing
router.post('/api/outings/:outingId/players', withDB, async (request) => {
  const { outingId } = request.params;
  if (!outingId) {
    return error(400, 'Outing ID is required.');
  }

  const { playerId } = request.json_data;
  if (!playerId || typeof playerId !== 'string') {
    return error(400, 'Player ID is required.');
  }

  try {
    // Check if outing exists
    const outing = await request.db.prepare('SELECT id FROM outings WHERE id = ?1').bind(outingId).first();
    if (!outing) {
      return error(404, `Outing with ID ${outingId} not found.`);
    }

    // Check if player exists
    const player = await request.db.prepare('SELECT id FROM players WHERE id = ?1').bind(playerId).first();
    if (!player) {
      return error(404, `Player with ID ${playerId} not found.`);
    }

    // Check if player is already in the outing
    const existingEntry = await request.db.prepare(
      'SELECT player_id FROM outing_players WHERE outing_id = ?1 AND player_id = ?2'
    ).bind(outingId, playerId).first();

    if (existingEntry) {
      return error(409, 'Player is already in this outing.');
    }

    await request.db.prepare('INSERT INTO outing_players (outing_id, player_id) VALUES (?1, ?2)')
      .bind(outingId, playerId)
      .run();
    return json({ message: 'Player added to outing successfully' }, { status: 201 });
  } catch (e) {
     if (e.message?.includes('FOREIGN KEY constraint failed')) {
        // This can happen if either outingId or playerId is invalid, despite prior checks (race condition or other issue)
        return error(404, 'Outing or Player not found (foreign key constraint).');
    } else if (e.message?.includes('UNIQUE constraint failed: outing_players.outing_id, outing_players.player_id')) {
        return error(409, 'Player is already in this outing.');
    }
    return error(500, { message: 'Failed to add player to outing', error: e.message });
  }
});

// DELETE /api/outings/:outingId/players/:playerId - Remove a player from an outing
router.delete('/api/outings/:outingId/players/:playerId', withDB, async (request) => {
  const { outingId, playerId } = request.params;
  if (!outingId || !playerId) {
    return error(400, 'Outing ID and Player ID are required.');
  }

  try {
    // Optional: Check if outing and player exist before deleting the link
    // const outing = await request.db.prepare('SELECT id FROM outings WHERE id = ?1').bind(outingId).first();
    // if (!outing) return error(404, 'Outing not found.');
    // const player = await request.db.prepare('SELECT id FROM players WHERE id = ?1').bind(playerId).first();
    // if (!player) return error(404, 'Player not found.');

    const info = await request.db.prepare(
      'DELETE FROM outing_players WHERE outing_id = ?1 AND player_id = ?2'
    ).bind(outingId, playerId).run();

    if (info.changes === 0) {
      return error(404, 'Player not found in this outing or already removed.');
    }
    return json({ message: 'Player removed from outing successfully' });
  } catch (e) {
    return error(500, { message: 'Failed to remove player from outing', error: e.message });
  }
});


// --- Group Generation Endpoint ---
const GOLF_GROUP_NAMES = [
  "The Fairway Fanatics", "The Driving Divas/Dudes", "The Bogey Brigade", "The Ace Alliance",
  "The Bunker Busters", "The Caddy Crew", "The Eagle Enforcers", "The Fore Horsemen",
  "The Green Guardians", "The Hazard Heroes", "The Iron Masters", "The Julep Jubilees",
  "The Mulligan Monarchs", "The Niblick Ninjas", "The On-Course Originals", "The Pin Seekers",
  "The Quagmire Conquerors", "The Rough Riders", "The Sand Trappers", "The Tee Time Titans",
  "The Under Par Unicorns", "The Victory Vardon", "The Wedge Wizards", "The X-Factor",
  "The Yardage Yetis", "The Zany Zephyrs"
];

router.get('/api/outings/:outingId/groups', withDB, async (request) => {
  const { outingId } = request.params;
  const { query } = request;
  const shuffle = query?.shuffle === 'true';

  if (!outingId) {
    return error(400, 'Outing ID is required.');
  }

  try {
    // 1. Fetch the outing to get number_of_groups
    const outing = await request.db.prepare('SELECT id, name, number_of_groups FROM outings WHERE id = ?1')
      .bind(outingId)
      .first();

    if (!outing) {
      return error(404, 'Outing not found.');
    }
    const numberOfGroups = outing.number_of_groups;

    // 2. Fetch players for the outing
    const { results: players } = await request.db.prepare(
      'SELECT p.id, p.name, p.skill FROM players p ' +
      'JOIN outing_players op ON p.id = op.player_id ' +
      'WHERE op.outing_id = ?1'
    ).bind(outingId).all();

    if (!players || players.length === 0) {
      return json({ outingName: outing.name, groups: [], message: 'No players in this outing to form groups.' });
    }

    // 3. Adapt group generation logic
    let currentPlayers = [...players]; // Clone players array

    if (shuffle) {
      // Fisher-Yates (Knuth) Shuffle
      for (let i = currentPlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentPlayers[i], currentPlayers[j]] = [currentPlayers[j], currentPlayers[i]];
      }
    } else {
      // Sort by skill (descending) then by name (ascending) for tie-breaking and consistency
      currentPlayers.sort((a, b) => {
        if (b.skill !== a.skill) {
          return b.skill - a.skill;
        }
        return a.name.localeCompare(b.name);
      });
    }

    const groups = Array.from({ length: numberOfGroups }, (_, i) => ({
      // Use GOLF_GROUP_NAMES, cycling if necessary
      name: GOLF_GROUP_NAMES[i % GOLF_GROUP_NAMES.length] + (Math.floor(i / GOLF_GROUP_NAMES.length) > 0 ? ` (${Math.floor(i / GOLF_GROUP_NAMES.length) + 1})` : ''),
      players: [],
      totalSkill: 0,
    }));

    // Distribute players into groups (snake draft style for skill balance if sorted)
    let groupIndex = 0;
    let direction = 1; // 0 -> 1 -> 2...
    currentPlayers.forEach(player => {
      groups[groupIndex].players.push({ id: player.id, name: player.name, skill: player.skill });
      groups[groupIndex].totalSkill += player.skill;

      groupIndex += direction;
      if (groupIndex >= numberOfGroups || groupIndex < 0) {
        // Change direction and set index to the end/start
        direction *= -1;
        groupIndex += direction;
      }
    });
    
    // Recalculate total skill for each group after distribution
    groups.forEach(group => {
        group.totalSkill = group.players.reduce((sum, p) => sum + p.skill, 0);
    });


    return json({ outingName: outing.name, numberOfGroups, groups });

  } catch (e) {
    console.error("Group generation error:", e);
    return error(500, { message: 'Failed to generate groups', error: e.message });
  }
});


// 404 for everything else
router.all('*', () => error(404, 'Not Found.'));

export default {
  async fetch(request, env, ctx) {
    // Add the D1 binding to the request object for use in handlers
    // This is a common pattern, but for itty-router, we'll pass `env` to each handler that needs it.
    // Or, create a middleware to attach it.
    return router.handle(request, env, ctx);
  },
};
