CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    name_lower TEXT NOT NULL UNIQUE,
    skill INTEGER NOT NULL CHECK (skill >= 1 AND skill <= 10)
);

CREATE TABLE outings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    number_of_groups INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE outing_players (
    outing_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    PRIMARY KEY (outing_id, player_id),
    FOREIGN KEY (outing_id) REFERENCES outings(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
