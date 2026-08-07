# Copyright © 2026 Mochisoft OÜ
# SPDX-License-Identifier: AGPL-3.0-only
# This file is part of Mochi, licensed under the GNU AGPL v3 with the
# Mochi Application Interface Exception - see license.txt and license-exception.md.

# Mochi Go (Weiqi) app

# Trust model.
#
# This is a game between accepted participants, not between adversaries.
# The rules engine is the go engine in the frontend, and the server takes
# its word for the state a move produces: it validates SHAPE - field
# present, right form, status in the known set, winner an actual player -
# and never legality. It does not verify the stone placement, the
# captures, or the ko rule.
#
# A participant who modifies their own client can therefore submit a state
# the rules would not have produced. That is accepted, not overlooked:
# making the server authoritative would mean a second rules engine in
# Starlark, which is not worth it for this audience. Reviews should not
# report it as a defect.
#
# What the server DOES enforce, and what changes here must preserve:
#
#   Participation  Only an accepted participant can reach a game. Creation
#                  is gated on friendship, and event_new requires both the
#                  recipient AND the sender to be listed players, so a
#                  friend cannot plant a game between other people.
#   Provenance     Inbound state is bound to a player of this game: a
#                  relayed snapshot's writer must be one, and a direct
#                  event's writer must be its authenticated sender.
#   Convergence    Ordering, deduplication and repair - see the concurrency
#                  block below. A tampering participant can corrupt their
#                  own game; they cannot desynchronise anyone else's.
#   Shape          Every stored field is validated, so a malformed or
#                  hostile value cannot crash a peer's client or wedge
#                  their game.
#
# The boundary is participation, not honesty.


def notify(topic, object="", title="", body="", url="", event_id=""):
	mochi.service.call("notifications", "send", topic, object, title, body, url, mochi.app.label("notifications.topic." + topic.replace("/", ".")), "", "", None, event_id)

# Commit hook: fires the live-update websocket on every host that sees
# a new messages row commit, whether locally (via action_send /
# action_move / action_pass / event_message / event_move calling
# mochi.db.commit.fire) or via replication apply (auto-fired by core
# with op.UID set, per the row-uid wire field added in #36). Both
# replicas of a paired account thus see the live update in any open
# browser tab, instead of only the host that served the action.
#
# Scoped to messages.insert for the chat ('message') and board-move
# ('move') message types. System-event messages (resign, draw_offer,
# draw_accept, draw_decline) stay on direct mochi.websocket.write
# because all four are messages.insert rows with type='system' that
# can only be disambiguated by the body text (which is user-facing
# and will be localised) or by the surrounding games-row state at
# read time (race-prone for back-to-back events). The hook cannot
# tell which of the four it is from the row alone.
def go_commit_hook(table, kind, row_uid):
	if table != "messages" or kind != "insert" or not row_uid:
		return
	message = mochi.db.row("select * from messages where id=?", row_uid)
	if not message:
		return
	game = mochi.db.row("select key, fen, previous_fen, sgf, captures_black, captures_white, status, winner from games where id=?", message["game"])
	if not game:
		return
	if message["type"] == "message":
		mochi.websocket.write(game["key"], {
			"type": "message",
			"created": message["created"],
			"member": message["member"],
			"name": message["name"],
			"body": message["body"],
		})
	elif message["type"] == "move":
		mochi.websocket.write(game["key"], {
			"type": "move",
			"created": message["created"],
			"member": message["member"],
			"name": message["name"],
			"body": message["body"],
			"fen": game["fen"],
			"previous_fen": game["previous_fen"] or "",
			"sgf": game["sgf"],
			"captures_black": game["captures_black"],
			"captures_white": game["captures_white"],
			"status": game["status"],
			"winner": game["winner"] or "",
			"draw_offer": "",
		})

# Lazy hook registration; the call to mochi.db.commit.hook needs a
# user/app context that's only present during a real request, not at
# module load. Re-registering on every call is a plain assignment on
# the AppVersion struct - cheap and idempotent at the framework level.
def go_ensure_commit_hook():
	mochi.db.commit.hook("go_commit_hook")

def database_upgrade(version):
	if version == 4:
		# Version tuple. A scalar counter each peer increments locally is not
		# a total order: two peers can both commit a different state at N+1
		# and then reject each other forever. Ordering is now
		# (terminal, revision, writer, event) compared lexicographically, so
		# concurrent writes resolve to the same winner on every peer.
		columns = []
		for column in mochi.db.table("games"):
			columns.append(column["name"])
		if "writer" not in columns:
			mochi.db.execute("alter table games add column writer text not null default ''")
		if "event" not in columns:
			mochi.db.execute("alter table games add column event text not null default ''")
	if version == 3:
		# Monotonic revision, bumped by every state change and carried on
		# every outbound event. Local writes compare-and-swap on the value
		# they read; inbound writes apply only when they carry a higher one.
		# Existing rows start at 0 on both peers, so they stay in step.
		found = False
		for column in mochi.db.table("games"):
			if column["name"] == "revision":
				found = True
		if not found:
			mochi.db.execute("alter table games add column revision integer not null default 0")
	if version == 2:
		# Drop the pre-2026-07 broadcast tables left in the app data DB when
		# broadcast state moved to the per-app system DB - inert, but stale
		# sequence/log copies mislead diagnosis.
		for table in ["sequence", "log", "acknowledged", "received"]:
			mochi.db.execute("drop table if exists " + table)

# Create database
def database_create():
	mochi.db.execute("""create table if not exists games (
		id text not null primary key,
		identity text not null,
		identity_name text not null,
		opponent text not null,
		opponent_name text not null,
		black text not null,
		board_size integer not null default 19,
		komi real not null default 6.5,
		status text not null default 'active',
		winner text,
		fen text not null,
		previous_fen text,
		sgf text not null default '',
		captures_black integer not null default 0,
		captures_white integer not null default 0,
		draw_offer text,
		key text not null,
		revision integer not null default 0,
		writer text not null default '',
		event text not null default '',
		updated integer not null,
		created integer not null
	)""")
	mochi.db.execute("create index if not exists games_updated on games( updated )")
	mochi.db.execute("create index if not exists games_identity on games( identity )")
	mochi.db.execute("create index if not exists games_opponent on games( opponent )")

	mochi.db.execute("""create table if not exists messages (
		id text not null primary key,
		game references games( id ),
		member text not null,
		name text not null,
		body text not null,
		type text not null default 'message',
		event text not null default '',
		created integer not null
	)""")
	mochi.db.execute("create index if not exists messages_game_created on messages( game, created )")

def get_opponent(game, user_id):
	if game["identity"] == user_id:
		return game["opponent"]
	return game["identity"]

def game_reconcile(e, game):
	"""Send our dominating state back to a peer whose event we rejected."""
	current = mochi.db.row("select * from games where id=?", game["id"])
	if not current:
		return
	state = game_state(current, {})
	state["revision"] = current["revision"]
	state["writer"] = current["writer"] or ""
	state["event"] = current["event"] or ""
	state["snapshot"] = 1
	state["game"] = current["id"]
	# Only a peer that already wrote the state we hold can be named as its
	# writer, so an empty writer means there is nothing authoritative to
	# reconcile with yet.
	if not state["writer"]:
		return
	mochi.message.send(
		{"from": e.header("to"), "to": e.header("from"), "service": "go", "event": "sync"},
		state
	)

def event_sync(e):
	"""Receive a peer's dominating state after they rejected one of ours."""
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return
	sender = e.header("from")
	if not (sender == game["identity"] or sender == game["opponent"]):
		return
	# One accepted shape, no fallback: anything without a complete snapshot is
	# not a sync frame and must change nothing at all.
	if e.content("snapshot") != 1:
		return
	# sync=True: if OUR state dominates theirs we drop it rather than
	# answering, which is what terminates the exchange.
	state = game_apply(e, game, mochi.time.now(), True)
	if state == None:
		return
	# A repaired row that no open client hears about breaks the invariant that
	# browser state eventually equals the canonical row: without this the peer
	# converges in the database while its browser still shows the state it was
	# repaired out of. type "state" carries no message - it is a cache signal.
	payload = {"type": "state"}
	for key in GAME_PUBLIC:
		payload[key] = state[key]
	mochi.websocket.write(game["key"], payload)

# Load game by ID from action input, validate ID and player access
def load_game(a):
	if not mochi.text.valid(a.input("game"), "id"):
		a.error.label(400, "errors.invalid_game_id")
		return None
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error.label(404, "errors.game_not_found")
		return None
	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error.label(403, "errors.not_a_player_in_this_game")
		return None
	return game

# Concurrency and convergence.
#
# Two problems, one mechanism.
#
# Locally, nothing serialises HTTP actions for a (user, app): core's
# per-worker guarantee (protocol2_worker.go) covers inbound P2P frames
# only. Two HTTP actions, or an HTTP action and an inbound event, can
# read the same row and write over each other.
#
# Between peers, there is no coordinator. A scalar counter that each peer
# increments from its own state is NOT a total order - both peers can
# commit a different state at N+1 (two players offering a draw at the
# same moment, or resigning), and a strictly-greater test then makes each
# reject the other permanently.
#
# Ordering is therefore the tuple (terminal, revision, writer, event),
# compared lexicographically:
#
#   revision  the logical counter, and it leads. An earlier version put
#             terminal first, which made EVERY terminal state outrank every
#             non-terminal one at any counter: a player resigning from a
#             stale revision-4 view then rewound peers at revision 30 to
#             revision-4 boards, racks and scores. Causality first.
#   terminal  1 when the status ends the game, else 0. Second, so it decides
#             only genuine same-counter conflicts - a resignation racing a
#             move at the same revision survives on both peers - without
#             letting an ancient terminal defeat newer state. A resignation
#             made against a state that no longer exists is discarded, and
#             the player reissues it once caught up.
#   writer    the entity that produced the state. Breaks ties between
#             peers at the same counter, identically on both sides.
#   event     a per-write uid. Only reachable if one writer produced two
#             states at the same counter, which the local CAS prevents;
#             carried so the order is total without relying on that.
#
# Every event carries a COMPLETE snapshot of the shared columns, not a
# delta. A delta would make "revision already passed" mean the state was
# passed, which is false: applying a higher auxiliary event (a resign)
# would advance the counter while omitting a board carried only by a
# lower one, and that lower event is then rejected for good - core acks
# any handler that returns cleanly (protocol2_worker.go), so nothing
# retries it.

#
# Protocol invariants. These are the properties the code above is meant to
# hold; anything added here should be tested against them, not just against a
# final database row.
#
#   1. Every applied event carries one complete, validated state.
#   2. Every replica deterministically retains the maximum version.
#   3. A rejected sender eventually learns the dominating version (event_sync).
#   4. Browser state eventually equals its local canonical row.
#   5. History divergence is permitted and is NOT a bug.
#
# On (5): the games row is canonical. The messages table is an activity feed,
# not an authoritative ledger of moves and events - under concurrent writes
# each peer keeps its own losing action, so two peers can legitimately show
# different system messages for the same game. Do not write code that
# reconstructs game state from message history; it cannot.

GAME_COLUMNS = ["fen", "previous_fen", "sgf", "captures_black", "captures_white", "status", "winner", "draw_offer"]
GAME_TERMINAL = ["finished", "resigned", "draw"]

# Columns a websocket payload may carry. Everything this game holds is
# visible to both players, so the public set is the whole snapshot -
# unlike words, which must hold back racks and the bag.
GAME_PUBLIC = GAME_COLUMNS

def game_players(game):
	"""Entities entitled to write this game's state."""
	return [game["identity"], game["opponent"]]

def event_name(value):
	"""Peer-supplied display name, held to core's name rules.

	Rejects angle brackets and line breaks and caps at 1000 characters, so a
	peer cannot store an unbounded string or smuggle markup into the label
	shown beside their moves."""
	value = str(value or "")
	if not value or not mochi.text.valid(value, "name"):
		return "Opponent"
	return value

def event_body(value, maximum, fallback):
	"""Peer-supplied display text, held to the bound the local path uses.

	Clamped rather than rejected. The board in the same event is validated
	separately and is the real state; dropping an otherwise-good move over a
	bad label would leave us behind the sender with no way to catch up, which
	is a worse outcome than showing a fallback for one move."""
	value = str(value or "")
	if not value or len(value) > maximum:
		return fallback
	return value

def event_created(e, now):
	"""Peer-supplied message timestamp, clamped to our clock.

	A stamp far from now would pin the message out of order forever and
	distort the created-keyed pagination cursor, so anything more than a
	day behind or five minutes ahead is replaced with our own time.
	Returns None when the field is absent or malformed."""
	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		return None
	created = int(created)
	if created < now - 86400 or created > now + 300:
		return now
	return created

def game_terminal(status):
	return 1 if status in GAME_TERMINAL else 0

def game_state(game, changes):
	"""Complete shared state: the row we read with changes applied.

	None becomes "" so a nullable column survives the round trip through
	an event; 0 and False are preserved, which `or ""` would not."""
	state = {}
	for column in GAME_COLUMNS:
		value = game[column]
		state[column] = "" if value == None else value
	for key, value in changes.items():
		state[key] = "" if value == None else value
	return state

def game_snapshot_valid(game, state):
	"""Validate a complete inbound snapshot before it can replace our row."""
	if not valid_fen(state["fen"]):
		return False
	if state["previous_fen"] and not valid_fen(state["previous_fen"]):
		return False
	if len(state["sgf"]) > 10000:
		return False
	if not mochi.text.valid(str(state["captures_black"]), "integer"):
		return False
	if not mochi.text.valid(str(state["captures_white"]), "integer"):
		return False
	# A 19x19 board holds 361 stones, so a capture count past that is not a
	# game state, whatever the tuple says.
	if int(state["captures_black"]) < 0 or int(state["captures_black"]) > 361:
		return False
	if int(state["captures_white"]) < 0 or int(state["captures_white"]) > 361:
		return False
	if state["status"] not in ["active", "finished", "resigned", "draw"]:
		return False
	players = [game["identity"], game["opponent"]]
	if state["winner"] and state["winner"] not in players:
		return False
	if state["draw_offer"] and state["draw_offer"] not in players:
		return False
	return True

def game_write(game, changes, writer, now):
	"""Apply a local change, guarding on the exact tuple we read.

	Returns the complete new state to ship to the opponent, or None when
	another writer got there first - in which case the caller must
	abandon the change entirely, emitting no message, no websocket
	payload and no P2P event."""
	state = game_state(game, changes)
	sets = []
	params = []
	for column in GAME_COLUMNS:
		sets.append(column + "=?")
		params.append(state[column])
	revision = game["revision"] + 1
	event = mochi.uid()
	sql = "update games set " + ", ".join(sets) + ", revision=?, writer=?, event=?, updated=? where id=? and revision=? and writer=? and event=?"
	params.extend([revision, writer, event, now, game["id"], game["revision"], game["writer"] or "", game["event"] or ""])
	if mochi.db.execute(sql, *params) == 0:
		return None
	state["revision"] = revision
	state["writer"] = writer
	state["event"] = event
	state["snapshot"] = 1
	return state

def game_apply(e, game, now, sync=False):
	"""Apply an inbound change if it outranks the row we hold.

	Every event carries a complete snapshot and a full version tuple; there
	is no partial form. The pre-snapshot delta path this replaces synthesised
	a tuple with an empty writer, which game_reconcile cannot relay, so a row
	it touched could never be repaired - and it was the only route into the
	games row that skipped validation. An event without a snapshot is now
	simply not one of ours."""
	if not e.content("snapshot"):
		return None
	state = {}
	for column in GAME_COLUMNS:
		value = e.content(column)
		# A field absent from a snapshot is a truncated snapshot, not an
		# empty value: coercing it to "" would let a partial event clear
		# state the sender never meant to change.
		if value == None:
			return None
		state[column] = value
	if not game_snapshot_valid(game, state):
		return None
	revision = e.content("revision")
	if not mochi.text.valid(str(revision), "integer"):
		return None
	revision = int(revision)
	if revision < 0:
		return None
	# Ordering metadata, not game state, but the whole design rests on it
	# being well formed.
	writer = e.content("writer")
	if sync:
		# A relayed snapshot is forwarded by whichever peer held the winning
		# state, which is not necessarily the peer that wrote it - that is the
		# whole point of reconciliation. Bind the writer to the game's players
		# rather than to the relay, and never rewrite it: the writer element
		# decides conflicts, so changing it in transit would change who wins.
		if writer not in game_players(game):
			return None
	elif writer != e.header("from"):
		# On a direct event the writer must be the authenticated sender: it
		# decides every same-revision tie, so a peer naming someone else
		# could steer them all.
		return None
	event = e.content("event")
	if not event or not mochi.text.valid(str(event), "id"):
		return None

	sets = []
	params = []
	for column, value in state.items():
		sets.append(column + "=?")
		params.append(value)
	sql = ("update games set " + ", ".join(sets) +
		", revision=?, writer=?, event=?, updated=? where id=?" +
		" and (revision, case when status in ('finished','resigned','draw') then 1 else 0 end, writer, event) < (?, ?, ?, ?)")
	params.extend([revision, writer, event, now, game["id"],
		revision, game_terminal(state["status"]), writer, event])
	if mochi.db.execute(sql, *params) == 0:
		# Our state dominates. Rejecting is only safe if the sender eventually
		# learns why, otherwise a peer that acted on a stale view sits on it
		# forever - core acks a handler that returns cleanly, so nothing else
		# tells them. Send our winning snapshot back. sync is True on the
		# reply path itself so this cannot ping-pong.
		if not sync:
			game_reconcile(e, game)
		return None
	return state

# Generate empty board FEN for given size
def empty_board(size):
	row = "." * size
	rows = "/".join([row] * size)
	return rows + " b 0 0 - 0"

# Validate a Go board FEN string
def valid_fen(fen):
	if not fen or len(fen) > 1000:
		return False
	parts = fen.split(" ")
	# All six fields, not just the board. action_move and action_pass read
	# parts[1] for the turn and fall back to "b" when it is absent, so a
	# board-only FEN freezes White out of the game permanently while Black
	# keeps playing, and an unrecognised colour freezes both. Neither is
	# recoverable in-app: every move checks the turn before doing anything.
	# chess.valid_fen has required the full field set since the equivalent
	# bug there.
	if len(parts) != 6:
		return False
	if parts[1] not in ["b", "w"]:
		return False
	rows = parts[0].split("/")
	size = len(rows)
	if size not in [9, 13, 19]:
		return False
	for row in rows:
		if len(row) != size:
			return False
		for ch in row.elems():
			if ch not in [".", "B", "W"]:
				return False
	return True

# Get friends list for new game
def stream_asset(a, entity_id, service, asset):
	if not entity_id:
		a.error.label(404, "errors.asset_unavailable", asset=asset)
		return None
	s = mochi.remote.stream(entity_id, service, asset, {})
	if not s:
		a.error.label(404, "errors.asset_unavailable", asset=asset)
		return None
	header = s.read()
	if not header or header.get("status") != "200":
		a.error.label(404, "errors.asset_not_set", asset=asset)
		return None
	a.header("Cache-Control", "private, max-age=300")
	if "data" in header:
		return {"data": header["data"]}
	a.header("Content-Type", header.get("content_type", "application/octet-stream"))
	# Bytes to relay per slot, matching what the people app accepts on upload.
	# Without a cap, a peer answering for a person can stream indefinitely through
	# this route, which is public. Only the three binary slots reach here - style
	# and information returned above as data - so an unrecognised slot falls back
	# to the largest of them rather than breaking a route that would otherwise work.
	caps = {"avatar": 2 * 1024 * 1024, "banner": 10 * 1024 * 1024, "favicon": 64 * 1024}
	a.write.stream(s, maximum=caps.get(asset, 10 * 1024 * 1024))
	return None

_PERSON_ASSETS = ("avatar", "banner", "favicon", "style", "information")

def action_user_asset(a):
	asset = a.input("asset")
	if asset not in _PERSON_ASSETS:
		a.error.label(404, "errors.unknown_asset")
		return
	# Public route - only a player in this game may resolve its players' assets.
	# Requires a real authenticated caller: an anonymous request to a public
	# action runs as the entity owner, so without the a.user test the ambient
	# owner would satisfy the player check for their own games.
	user_id = a.user.identity.id if a.user and a.user.identity else None
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not user_id or not game or (user_id != game["identity"] and user_id != game["opponent"]):
		a.error.label(403, "errors.not_a_player_in_this_game")
		return
	# Bind the requested identity to this game, so the route can only resolve
	# its own players rather than any entity the caller names.
	target = a.input("user") or ""
	if target != game["identity"] and target != game["opponent"]:
		a.error.label(404, "errors.unknown_asset")
		return
	return stream_asset(a, target, "people", asset)

def action_new(a):
	friends = mochi.service.call("friends", "list", a.user.identity.id) or []
	return {
		"data": {"friends": friends}
	}

# Create new game
def action_create(a):
	opponent = a.input("opponent")
	if not mochi.text.valid(opponent, "entity"):
		a.error.label(400, "errors.invalid_opponent")
		return

	if opponent == a.user.identity.id:
		a.error.label(400, "errors.cannot_play_against_yourself")
		return

	# Verify opponent is a friend
	friend = mochi.service.call("friends", "get", a.user.identity.id, opponent)
	if not friend:
		a.error.label(400, "errors.can_only_play_with_friends")
		return

	opponent_name = friend["name"]

	# Board size
	board_size = 19
	board_size_str = a.input("board_size", "")
	if board_size_str:
		if not mochi.text.valid(board_size_str, "integer"):
			a.error.label(400, "errors.invalid_board_size")
			return
		board_size = int(board_size_str)
	if board_size not in [9, 13, 19]:
		a.error.label(400, "errors.invalid_board_size")
		return

	# Komi
	komi = 6.5
	komi_str = a.input("komi", "")
	if komi_str:
		if not mochi.text.valid(komi_str, "numeric"):
			a.error.label(400, "errors.invalid_komi")
			return
		komi = float(komi_str)
		if komi < 0 or komi > 10:
			a.error.label(400, "errors.komi_must_be_between_0_and_10")
			return

	# Randomly assign black (black goes first in Go); fair 50/50
	if mochi.random.integer(0, 1) == 0:
		black = a.user.identity.id
	else:
		black = opponent

	game_id = mochi.uid()
	now = mochi.time.now()
	key = mochi.random.alphanumeric(16)
	fen = empty_board(board_size)

	mochi.db.execute(
		"insert into games ( id, identity, identity_name, opponent, opponent_name, black, board_size, komi, fen, key, updated, created ) values ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )",
		game_id, a.user.identity.id, a.user.identity.name, opponent, opponent_name, black, board_size, komi, fen, key, now, now
	)

	# Send new game event to opponent
	mochi.message.send(
		{"from": a.user.identity.id, "to": opponent, "service": "go", "event": "new"},
		{"id": game_id, "identity": a.user.identity.id, "identity_name": a.user.identity.name, "opponent": opponent, "opponent_name": opponent_name, "black": black, "board_size": board_size, "komi": komi, "fen": fen, "created": now}
	)

	return {
		"data": {"id": game_id, "black": black}
	}

# List games
def action_list(a):
	games = mochi.db.rows("""
		select id, identity, identity_name, opponent, opponent_name, black, board_size, komi, status, winner, fen, previous_fen, sgf, captures_black, captures_white, draw_offer, updated, created from games
		where identity = ? or opponent = ?
		order by updated desc
	""", a.user.identity.id, a.user.identity.id)

	return {
		"data": games
	}

# View a game
def action_view(a):
	game = load_game(a)
	if not game:
		return

	mochi.service.call("notifications", "clear/object", game["id"])

	return {
		"data": {"game": game, "identity": a.user.identity.id}
	}

# Get messages for a game with cursor-based pagination
def action_messages(a):
	game = load_game(a)
	if not game:
		return

	# Pagination parameters
	limit = 30
	limit_str = a.input("limit")
	if limit_str and mochi.text.valid(limit_str, "natural"):
		limit = min(int(limit_str), 100)

	# Cursor is "<created>:<id>". created alone is not unique - messages
	# sharing a second are common on a fast exchange - so a created-only
	# cursor silently dropped every row that shared the page boundary's
	# timestamp. The id breaks the tie and makes the order total.
	#
	# A bare number is still accepted: that is what an older client sends,
	# and it keeps the old behaviour for it rather than erroring.
	before_created = None
	before_id = ""
	before_str = a.input("before")
	if before_str:
		parts = str(before_str).split(":")
		if mochi.text.valid(parts[0], "integer"):
			before_created = int(parts[0])
		if len(parts) > 1:
			before_id = parts[1]

	# `!= None`, not truthiness: a created of 0 is a legitimate cursor and
	# the old falsy test read it as "no cursor" and restarted from the top.
	if before_created != None:
		if before_id:
			messages = mochi.db.rows("select * from messages where game=? and (created<? or (created=? and id<?)) order by created desc, id desc limit ?", game["id"], before_created, before_created, before_id, limit + 1)
		else:
			messages = mochi.db.rows("select * from messages where game=? and created<? order by created desc, id desc limit ?", game["id"], before_created, limit + 1)
	else:
		messages = mochi.db.rows("select * from messages where game=? order by created desc, id desc limit ?", game["id"], limit + 1)

	has_more = len(messages) > limit
	if has_more:
		messages = messages[:limit]

	messages = list(reversed(messages))

	next_cursor = None
	if has_more and len(messages) > 0:
		next_cursor = str(messages[0]["created"]) + ":" + str(messages[0]["id"])

	return {
		"data": {
			"messages": messages,
			"hasMore": has_more,
			"nextCursor": next_cursor
		}
	}

# Send a chat message
def action_send(a):
	game = load_game(a)
	if not game:
		return

	body = a.input("body", "")
	if not mochi.text.valid(body, "text"):
		a.error.label(400, "errors.invalid_message")
		return
	if len(body) > 10000:
		a.error.label(400, "errors.message_too_long")
		return
	if not body.strip():
		a.error.label(400, "errors.message_cannot_be_empty")
		return

	go_ensure_commit_hook()
	id = mochi.uid()
	now = mochi.time.now()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	# Live-update websocket: fired from go_commit_hook on every host
	# that sees this messages row (local + paired replicas via the
	# row-uid wire field from #36), so the user's tabs on every host
	# see the message arrive without a refresh.
	mochi.db.commit.fire("messages", "insert", id)

	other = get_opponent(game, a.user.identity.id)

	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "message"},
		{"game": game["id"], "message": id, "created": now, "body": body, "name": a.user.identity.name}
	)

	return {
		"data": {"id": id}
	}

# Make a move (place a stone)
def action_move(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	# Validate turn — board state metadata has turn indicator
	fen_parts = game["fen"].split(" ")
	turn = fen_parts[1] if len(fen_parts) > 1 else "b"
	player_color = "b" if game["black"] == a.user.identity.id else "w"
	if turn != player_color:
		a.error.label(400, "errors.not_your_turn")
		return

	# Get move data from frontend (frontend validates with go-engine)
	fen = a.input("fen")
	previous_fen = a.input("previous_fen", "")
	sgf = a.input("sgf", "")
	captures_black = a.input("captures_black", "0")
	captures_white = a.input("captures_white", "0")
	move_label = a.input("move_label", "")
	status = a.input("status", "")
	winner = a.input("winner", "")

	if len(move_label) > 20:
		a.error.label(400, "errors.invalid_move_label")
		return
	if not fen or not valid_fen(fen):
		a.error.label(400, "errors.invalid_board_state")
		return
	if previous_fen and not valid_fen(previous_fen):
		a.error.label(400, "errors.invalid_previous_board_state")
		return
	if len(sgf) > 10000:
		a.error.label(400, "errors.sgf_too_long")
		return

	if not mochi.text.valid(captures_black, "integer") or not mochi.text.valid(captures_white, "integer"):
		a.error.label(400, "errors.invalid_captures")
		return
	# The same 0..361 bound the inbound path applies. Accepting a wider range
	# here writes a value into the games row that every peer then rejects, and
	# since each event carries a complete snapshot the rejection is not
	# one-off: every later snapshot carries the value forward, so the game
	# forks permanently with no way back.
	if int(captures_black) < 0 or int(captures_black) > 361 or int(captures_white) < 0 or int(captures_white) > 361:
		a.error.label(400, "errors.invalid_captures")
		return

	# Validate status and winner
	valid_statuses = ["active", "finished"]
	new_status = status if status in valid_statuses else "active"
	players = [game["identity"], game["opponent"]]
	new_winner = winner if winner in players else None

	go_ensure_commit_hook()
	now = mochi.time.now()
	# Compare-and-swap against the position we validated the turn against.
	# Nothing serialises HTTP actions for a (user, app) - core's per-worker
	# guarantee covers inbound P2P frames only - so a double submit, or the
	# opponent's move landing in the same instant, otherwise lets both
	# requests validate the same turn and the later write wins blind.
	# status is in the predicate because a resignation arriving in that
	# window changes the row without touching the board.
	state = game_write(game, {"fen": fen, "previous_fen": previous_fen, "sgf": sgf,
		"captures_black": int(captures_black), "captures_white": int(captures_white),
		"status": new_status, "winner": new_winner, "draw_offer": None}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert move message
	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label, now)

	# Live-update websocket: fired from go_commit_hook on every host
	# that sees this messages row commit (local + paired replicas via
	# the row-uid wire field from #36). The hook reads the games row
	# to fill fen/sgf/captures/status/winner.
	mochi.db.commit.fire("messages", "insert", id)

	other = get_opponent(game, a.user.identity.id)

	p2p_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
		"body": move_label,
		# Retained for peers that predate the snapshot. Read from our own row,
		# not from the client-supplied previous_fen.
		"parent": game["fen"]
	}
	# The complete post-move state plus its version tuple. Merged last so the
	# snapshot is authoritative over anything named above.
	for key, value in state.items():
		p2p_data[key] = value
	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "move"},
		p2p_data
	)

	return {
		"data": {"id": id}
	}

# Pass turn
def action_pass(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	# Validate turn
	fen_parts = game["fen"].split(" ")
	turn = fen_parts[1] if len(fen_parts) > 1 else "b"
	player_color = "b" if game["black"] == a.user.identity.id else "w"
	if turn != player_color:
		a.error.label(400, "errors.not_your_turn")
		return

	# Get data from frontend
	fen = a.input("fen")
	sgf = a.input("sgf", "")
	status = a.input("status", "")
	winner = a.input("winner", "")
	score_black = a.input("score_black", "")
	score_white = a.input("score_white", "")

	if not fen or not valid_fen(fen):
		a.error.label(400, "errors.invalid_board_state")
		return
	if len(sgf) > 10000:
		a.error.label(400, "errors.sgf_too_long")
		return

	if score_black and not mochi.text.valid(score_black, "numeric"):
		a.error.label(400, "errors.invalid_score")
		return
	if score_white and not mochi.text.valid(score_white, "numeric"):
		a.error.label(400, "errors.invalid_score")
		return

	valid_statuses = ["active", "finished"]
	new_status = status if status in valid_statuses else "active"
	players = [game["identity"], game["opponent"]]
	new_winner = winner if winner in players else None

	go_ensure_commit_hook()
	now = mochi.time.now()
	state = game_write(game, {"fen": fen, "previous_fen": game["fen"], "sgf": sgf,
		"status": new_status, "winner": new_winner, "draw_offer": None}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert move message. The stored label is the bare pass marker; the
	# frontend renders localised pass text and reads scores from the row.
	id = mochi.uid()
	move_label = "Pass"

	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label, now)

	# Live-update websocket: fired from go_commit_hook on every host
	# that sees this messages row commit (local + paired replicas via
	# the row-uid wire field from #36). The hook reads the games row
	# to fill fen/sgf/captures/status/winner. The pass/score_black/
	# score_white extras aren't stored in any row, so they're dropped;
	# the frontend doesn't consume them (it computes the local board
	# score from the FEN and treats body="Pass" as the pass marker).
	mochi.db.commit.fire("messages", "insert", id)

	other = get_opponent(game, a.user.identity.id)

	msg_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
		"body": move_label, "pass": True,
	}
	for key, value in state.items():
		msg_data[key] = value
	if score_black:
		msg_data["score_black"] = float(score_black)
	if score_white:
		msg_data["score_white"] = float(score_white)
	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "move"},
		msg_data
	)

	return {
		"data": {"id": id}
	}

# Resign
def action_resign(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	# Winner is the opponent
	other = get_opponent(game, a.user.identity.id)
	winner = other

	now = mochi.time.now()
	state = game_write(game, {"status": "resigned", "winner": winner}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert system message
	id = mochi.uid()
	msg = a.user.identity.name + " resigned"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'resign', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	# Stays on direct write: type='system' messages all share the same
	# row shape across four semantic events (resign/draw_offer/
	# draw_accept/draw_decline), and the commit hook can't tell them
	# apart from the row alone — see comment on go_commit_hook above.
	# Paired-host clients miss the live update for system events until
	# the row replicates and the user refreshes.
	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "name": a.user.identity.name, "created": now, "body": msg, "winner": winner})

	p2p_data = {"game": game["id"], "created": now, "body": msg}
	for key, value in state.items():
		p2p_data[key] = value
	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "resign"},
		p2p_data
	)

	return {
		"data": {"success": True}
	}

# Offer a draw
def action_draw_offer(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	if game["draw_offer"] == a.user.identity.id:
		a.error.label(400, "errors.you_already_offered_a_draw")
		return

	other = get_opponent(game, a.user.identity.id)

	now = mochi.time.now()
	state = game_write(game, {"draw_offer": a.user.identity.id}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert system message
	id = mochi.uid()
	msg = a.user.identity.name + " offered a draw"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'draw_offer', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	# Stays on direct write: same reason as action_resign above.
	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_offer", "name": a.user.identity.name, "created": now, "body": msg, "draw_offer": a.user.identity.id})

	p2p_data = {"game": game["id"], "created": now, "body": msg}
	for key, value in state.items():
		p2p_data[key] = value
	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "draw_offer"},
		p2p_data
	)

	return {
		"data": {"success": True}
	}

# Accept a draw offer
def action_draw_accept(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	if not game["draw_offer"] or game["draw_offer"] == a.user.identity.id:
		a.error.label(400, "errors.no_draw_offer_to_accept")
		return

	other = get_opponent(game, a.user.identity.id)

	now = mochi.time.now()
	state = game_write(game, {"status": "draw", "draw_offer": None}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert system message
	id = mochi.uid()
	msg = "Draw agreed"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'draw_accept', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	# Stays on direct write: same reason as action_resign above.
	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_accept", "name": a.user.identity.name, "created": now, "body": msg})

	p2p_data = {"game": game["id"], "created": now, "body": msg}
	for key, value in state.items():
		p2p_data[key] = value
	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "draw_accept"},
		p2p_data
	)

	return {
		"data": {"success": True}
	}

# Decline a draw offer
def action_draw_decline(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	if not game["draw_offer"] or game["draw_offer"] == a.user.identity.id:
		a.error.label(400, "errors.no_draw_offer_to_decline")
		return

	other = get_opponent(game, a.user.identity.id)

	now = mochi.time.now()
	state = game_write(game, {"draw_offer": None}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert system message
	id = mochi.uid()
	msg = a.user.identity.name + " declined the draw"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'draw_decline', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	# Stays on direct write: same reason as action_resign above.
	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_decline", "name": a.user.identity.name, "created": now, "body": msg, "draw_offer": ""})

	p2p_data = {"game": game["id"], "created": now, "body": msg}
	for key, value in state.items():
		p2p_data[key] = value
	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "draw_decline"},
		p2p_data
	)

	return {
		"data": {"success": True}
	}

# Delete a finished game
def action_delete(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] == "active":
		a.error.label(400, "errors.cannot_delete_an_active_game")
		return

	mochi.db.execute("delete from messages where game=?", game["id"])
	mochi.db.execute("delete from games where id=?", game["id"])

	return {
		"data": {"success": True}
	}

# P2P Events

# Received a new game event
def event_new(e):
	f = mochi.service.call("friends", "get", e.header("to"), e.header("from"))
	if not f:
		return

	game_id = e.content("id")
	if not mochi.text.valid(game_id, "id"):
		return

	identity = e.content("identity")
	if not mochi.text.valid(identity, "entity"):
		return

	identity_name = e.content("identity_name")
	if not mochi.text.valid(identity_name, "name"):
		return

	opponent = e.content("opponent")
	if not mochi.text.valid(opponent, "entity"):
		return

	opponent_name = e.content("opponent_name")
	if not mochi.text.valid(opponent_name, "name"):
		return

	black = e.content("black")
	if not mochi.text.valid(black, "entity"):
		return

	board_size = e.content("board_size")
	if board_size:
		if not mochi.text.valid(str(board_size), "integer"):
			return
		board_size = int(board_size)
	else:
		board_size = 19
	if board_size not in [9, 13, 19]:
		return

	komi = e.content("komi")
	if komi:
		if not mochi.text.valid(str(komi), "numeric"):
			return
		komi = float(komi)
		if komi < 0 or komi > 10:
			return
	else:
		komi = 6.5

	fen = e.content("fen")
	if fen:
		if not valid_fen(fen):
			return
	else:
		fen = empty_board(board_size)

	created = event_created(e, mochi.time.now())
	if created == None:
		return

	# Verify the recipient is one of the two players - a friend must not be able
	# to plant a game row in which this user is not a participant.
	if e.header("to") not in [identity, opponent]:
		return

	# ...and that the sender is too. The friend check above only proves the
	# sender is OUR friend, not that they are playing: without this a friend
	# could plant a game between us and a third party, who would then satisfy
	# every later is_player check on this host.
	if e.header("from") not in [identity, opponent]:
		return

	result = mochi.db.execute(
		"insert or ignore into games ( id, identity, identity_name, opponent, opponent_name, black, board_size, komi, fen, key, updated, created ) values ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )",
		game_id, identity, identity_name, opponent, opponent_name, black, board_size, komi, fen, mochi.random.alphanumeric(16), mochi.time.now(), created
	)
	if result == 0:
		return

	notify("activity", "", mochi.app.label("notifications.title.game"), mochi.app.label("notifications.body.started_game", name=identity_name), "/go/" + game_id, event_id="game:" + game_id)

# Received a move event
def event_move(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	# Verify sender is the opponent
	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	fen = e.content("fen")
	sgf = e.content("sgf") or ""
	body = event_body(e.content("body"), 10000, "")
	status = e.content("status") or "active"
	winner = e.content("winner") or None
	previous_fen = e.content("previous_fen") or None
	captures_black = e.content("captures_black")
	captures_white = e.content("captures_white")

	if not fen or not valid_fen(fen):
		return
	if previous_fen and not valid_fen(previous_fen):
		return
	if len(sgf) > 10000:
		return

	valid_statuses = ["active", "finished"]
	if status not in valid_statuses:
		status = "active"
	players = [game["identity"], game["opponent"]]
	if winner and winner not in players:
		winner = None

	if captures_black:
		if not mochi.text.valid(str(captures_black), "integer"):
			return
		captures_black = int(captures_black)
		if captures_black < 0 or captures_black > 361:
			return
	else:
		captures_black = game["captures_black"]
	if captures_white:
		if not mochi.text.valid(str(captures_white), "integer"):
			return
		captures_white = int(captures_white)
		if captures_white < 0 or captures_white > 361:
			return
	else:
		captures_white = game["captures_white"]

	# Apply atomically, ordered by the sender's revision. The earlier
	# read-then-write shape lost to a concurrent local action: this handler
	# accepted a board, an HTTP move advanced the row, and the unconditional
	# write then erased it. Revision also orders a Go position that
	# legitimately recurs, which FEN ancestry could not.
	go_ensure_commit_hook()
	now = mochi.time.now()
	if game_apply(e, game, now) == None:
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = event_created(e, now)
	if created == None:
		created = now

	name = event_name(e.content("name"))

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	# Live-update websocket: fired from go_commit_hook on every host
	# that sees this messages row commit (local + paired replicas via
	# the row-uid wire field from #36). The hook reads the games row
	# to fill fen/sgf/captures/status/winner. The pass/score_black/
	# score_white extras from the inbound event aren't stored in any
	# row, so they're dropped; the frontend doesn't consume them.
	mochi.db.commit.fire("messages", "insert", id)
	notify("activity", "", mochi.app.label("notifications.title.move"), mochi.app.label("notifications.body.played_move", name=name, move=body), "/go/" + game["id"], event_id="move:" + str(id))

# Received a chat message event
def event_message(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		return

	created = event_created(e, mochi.time.now())
	if created == None:
		return

	body = e.content("body")
	if not mochi.text.valid(str(body), "text"):
		return
	if len(str(body)) > 10000:
		return

	name = event_name(e.content("name"))

	go_ensure_commit_hook()
	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], sender, name, body, created)

	# Live-update websocket: fired from go_commit_hook on every host
	# that sees this messages row commit (local + paired replicas via
	# the row-uid wire field from #36).
	mochi.db.commit.fire("messages", "insert", id)
	notify("message", "", mochi.app.label("notifications.title.message"), name + ": " + body, "/go/" + game["id"], event_id="message:" + str(id))

# Received a resign event
def event_resign(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	winner = e.content("winner")
	body = event_body(e.content("body"), 10000, mochi.app.label("notifications.body.opponent_resigned"))
	sender_name = game["identity_name"] if sender == game["identity"] else game["opponent_name"]

	# Derive winner: the other player (not the one who resigned)
	players = [game["identity"], game["opponent"]]
	if winner not in players:
		winner = game["opponent"] if sender == game["identity"] else game["identity"]

	now = mochi.time.now()
	state = game_apply(e, game, now)
	if state == None:
		return

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'resign', ? )", id, game["id"], sender, sender_name, body, now)

	# Stays on direct write: type='system' messages share their row
	# shape across resign/draw_offer/draw_accept/draw_decline and the
	# commit hook can't disambiguate from the row — see comment on
	# go_commit_hook above.
	ws_data = {"type": "system", "event": "resign", "name": sender_name, "created": now, "body": body, "winner": winner or ""}
	# A snapshot may have repaired more than this event's own subject, so send
	# the applied state rather than just this event's fields. Otherwise an open
	# client keeps stale values until it refetches.
	for key, value in state.items():
		ws_data[key] = value
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.game"), mochi.app.label("notifications.body.opponent_resigned"), "/go/" + game["id"], event_id="resign:" + game["id"])

# Received a draw offer event
def event_draw_offer(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	body = event_body(e.content("body"), 10000, mochi.app.label("notifications.body.draw_offered"))
	sender_name = game["identity_name"] if sender == game["identity"] else game["opponent_name"]

	# Ordering is the version tuple, not the wall clock. The gate that used
	# to sit here compared the sender's clock against our `updated` and ran
	# BEFORE the tuple was consulted, so a strictly higher-ordered offer lost
	# to clock skew - or simply to any local move, since every state change
	# bumps `updated`. It was reaching for a deterministic winner when both
	# players offer at once; the tuple's writer element does that properly,
	# and identically on both peers.
	now = mochi.time.now()
	incoming = str(e.content("created", "0"))
	if not mochi.text.valid(incoming, "integer"):
		incoming = str(now)

	state = game_apply(e, game, now)
	if state == None:
		return

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'draw_offer', ? )", id, game["id"], sender, sender_name, body, now)

	# Stays on direct write: same reason as event_resign above.
	ws_data = {"type": "system", "event": "draw_offer", "name": sender_name, "created": now, "body": body, "draw_offer": sender}
	# A snapshot may have repaired more than this event's own subject, so send
	# the applied state rather than just this event's fields. Otherwise an open
	# client keeps stale values until it refetches.
	for key, value in state.items():
		ws_data[key] = value
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.go"), mochi.app.label("notifications.body.draw_offered"), "/go/" + game["id"], event_id="draw_offer:" + game["id"] + ":" + str(incoming))

# Received a draw accept event
def event_draw_accept(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	body = event_body(e.content("body"), 10000, mochi.app.label("notifications.body.draw_agreed"))
	sender_name = game["identity_name"] if sender == game["identity"] else game["opponent_name"]

	now = mochi.time.now()
	state = game_apply(e, game, now)
	if state == None:
		return

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'draw_accept', ? )", id, game["id"], sender, sender_name, body, now)

	# Stays on direct write: same reason as event_resign above.
	ws_data = {"type": "system", "event": "draw_accept", "name": sender_name, "created": now, "body": body}
	# A snapshot may have repaired more than this event's own subject, so send
	# the applied state rather than just this event's fields. Otherwise an open
	# client keeps stale values until it refetches.
	for key, value in state.items():
		ws_data[key] = value
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.go"), mochi.app.label("notifications.body.draw_agreed"), "/go/" + game["id"], event_id="draw_accept:" + game["id"])

# Received a draw decline event
def event_draw_decline(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	body = event_body(e.content("body"), 10000, mochi.app.label("notifications.body.draw_declined"))
	sender_name = game["identity_name"] if sender == game["identity"] else game["opponent_name"]

	now = mochi.time.now()
	state = game_apply(e, game, now)
	if state == None:
		return

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', 'draw_decline', ? )", id, game["id"], sender, sender_name, body, now)

	# Stays on direct write: same reason as event_resign above.
	ws_data = {"type": "system", "event": "draw_decline", "name": sender_name, "created": now, "body": body, "draw_offer": ""}
	# A snapshot may have repaired more than this event's own subject, so send
	# the applied state rather than just this event's fields. Otherwise an open
	# client keeps stale values until it refetches.
	for key, value in state.items():
		ws_data[key] = value
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.go"), mochi.app.label("notifications.body.draw_declined"), "/go/" + game["id"], event_id="draw_decline:" + game["id"] + ":" + sender)

