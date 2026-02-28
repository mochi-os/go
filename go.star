# Mochi Go (Weiqi) app

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
		updated integer not null,
		created integer not null
	)""")
	mochi.db.execute("create index if not exists games_updated on games( updated )")

	mochi.db.execute("""create table if not exists messages (
		id text not null primary key,
		game references games( id ),
		member text not null,
		name text not null,
		body text not null,
		type text not null default 'message',
		created integer not null
	)""")
	mochi.db.execute("create index if not exists messages_game_created on messages( game, created )")

# Upgrade database
def database_upgrade(to_version):
	pass

def get_opponent(game, user_id):
	if game["identity"] == user_id:
		return game["opponent"]
	return game["identity"]

# Load game by ID from action input, validate ID and player access
def load_game(a):
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return None
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return None
	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return None
	return game

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
	if len(parts) < 1:
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
def action_new(a):
	friends = mochi.service.call("friends", "list", a.user.identity.id) or []
	return {
		"data": {"friends": friends}
	}

# Create new game
def action_create(a):
	opponent = a.input("opponent")
	if not mochi.valid(opponent, "entity"):
		a.error(400, "Invalid opponent")
		return

	if opponent == a.user.identity.id:
		a.error(400, "Cannot play against yourself")
		return

	# Verify opponent is a friend
	friend = mochi.service.call("friends", "get", a.user.identity.id, opponent)
	if not friend:
		a.error(400, "Can only play with friends")
		return

	opponent_name = friend["name"]

	# Board size
	board_size = 19
	board_size_str = a.input("board_size", "")
	if board_size_str:
		if not mochi.valid(board_size_str, "integer"):
			a.error(400, "Invalid board size")
			return
		board_size = int(board_size_str)
	if board_size not in [9, 13, 19]:
		a.error(400, "Invalid board size")
		return

	# Komi
	komi = 6.5
	komi_str = a.input("komi", "")
	if komi_str:
		if not mochi.valid(komi_str, "numeric"):
			a.error(400, "Invalid komi")
			return
		komi = float(komi_str)
		if komi < 0 or komi > 10:
			a.error(400, "Komi must be between 0 and 10")
			return

	# Randomly assign black (black goes first in Go)
	coin = mochi.random.alphanumeric(1)
	if coin < "s":
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
		SELECT id, identity, identity_name, opponent, opponent_name, black, board_size, komi, status, winner, fen, previous_fen, sgf, captures_black, captures_white, draw_offer, updated, created FROM games
		WHERE identity = ? OR opponent = ?
		ORDER BY updated DESC
	""", a.user.identity.id, a.user.identity.id)

	return {
		"data": games
	}

# View a game
def action_view(a):
	game = load_game(a)
	if not game:
		return

	mochi.service.call("notifications", "clear/object", "go", game["id"])

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
	if limit_str and mochi.valid(limit_str, "natural"):
		limit = min(int(limit_str), 100)

	before = None
	before_str = a.input("before")
	if before_str and mochi.valid(before_str, "natural"):
		before = int(before_str)

	if before:
		messages = mochi.db.rows("select * from messages where game=? and created<? order by created desc limit ?", game["id"], before, limit + 1)
	else:
		messages = mochi.db.rows("select * from messages where game=? order by created desc limit ?", game["id"], limit + 1)

	has_more = len(messages) > limit
	if has_more:
		messages = messages[:limit]

	messages = list(reversed(messages))

	next_cursor = None
	if has_more and len(messages) > 0:
		next_cursor = messages[0]["created"]

	for m in messages:
		m["created_local"] = mochi.time.local(m["created"])

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
	if not mochi.valid(body, "text"):
		a.error(400, "Invalid message")
		return
	if len(body) > 10000:
		a.error(400, "Message too long")
		return
	if not body.strip():
		a.error(400, "Message cannot be empty")
		return

	id = mochi.uid()
	now = mochi.time.now()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	mochi.websocket.write(game["key"], {"type": "message", "created": now, "member": a.user.identity.id, "name": a.user.identity.name, "body": body})

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
		a.error(400, "Game is not active")
		return

	# Validate turn — board state metadata has turn indicator
	turn = "b" if " b " in game["fen"] else "w"
	player_color = "b" if game["black"] == a.user.identity.id else "w"
	if turn != player_color:
		a.error(400, "Not your turn")
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

	if not fen or not valid_fen(fen):
		a.error(400, "Invalid board state")
		return
	if previous_fen and not valid_fen(previous_fen):
		a.error(400, "Invalid previous board state")
		return
	if len(sgf) > 10000:
		a.error(400, "SGF too long")
		return

	if not mochi.valid(captures_black, "integer") or not mochi.valid(captures_white, "integer"):
		a.error(400, "Invalid captures")
		return

	# Validate status and winner
	valid_statuses = ["active", "finished"]
	new_status = status if status in valid_statuses else "active"
	players = [game["identity"], game["opponent"]]
	new_winner = winner if winner in players else None

	now = mochi.time.now()
	mochi.db.execute(
		"update games set fen=?, previous_fen=?, sgf=?, captures_black=?, captures_white=?, status=?, winner=?, draw_offer=null, updated=? where id=?",
		fen, previous_fen, sgf, int(captures_black), int(captures_white), new_status, new_winner, now, game["id"]
	)

	# Insert move message
	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label, now)

	mochi.websocket.write(game["key"], {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": move_label,
		"fen": fen, "previous_fen": previous_fen, "sgf": sgf,
		"captures_black": int(captures_black), "captures_white": int(captures_white),
		"status": new_status, "winner": new_winner or "",
		"draw_offer": ""
	})

	other = get_opponent(game, a.user.identity.id)

	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "move"},
		{
			"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
			"body": move_label,
			"fen": fen, "previous_fen": previous_fen, "sgf": sgf,
			"captures_black": int(captures_black), "captures_white": int(captures_white),
			"status": new_status, "winner": new_winner or ""
		}
	)

	return {
		"data": {"id": id}
	}

# Pass turn
def action_pass(a):
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return

	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return

	if game["status"] != "active":
		a.error(400, "Game is not active")
		return

	# Validate turn
	turn = "b" if " b " in game["fen"] else "w"
	player_color = "b" if game["black"] == a.user.identity.id else "w"
	if turn != player_color:
		a.error(400, "Not your turn")
		return

	# Get data from frontend
	fen = a.input("fen")
	sgf = a.input("sgf", "")
	status = a.input("status", "")
	winner = a.input("winner", "")
	score_black = a.input("score_black", "")
	score_white = a.input("score_white", "")

	if not fen or not valid_fen(fen):
		a.error(400, "Invalid board state")
		return
	if len(sgf) > 10000:
		a.error(400, "SGF too long")
		return

	if score_black and not mochi.valid(score_black, "numeric"):
		a.error(400, "Invalid score")
		return
	if score_white and not mochi.valid(score_white, "numeric"):
		a.error(400, "Invalid score")
		return

	valid_statuses = ["active", "finished"]
	new_status = status if status in valid_statuses else "active"
	players = [game["identity"], game["opponent"]]
	new_winner = winner if winner in players else None

	now = mochi.time.now()
	mochi.db.execute(
		"update games set fen=?, sgf=?, status=?, winner=?, draw_offer=null, updated=? where id=?",
		fen, sgf, new_status, new_winner, now, game["id"]
	)

	# Insert move message
	id = mochi.uid()
	color_name = "Black" if player_color == "b" else "White"
	if new_status == "finished":
		move_label = "Pass"
		body = color_name + " passed — game over"
		if score_black and score_white:
			body = body + " (B:" + str(score_black) + " W:" + str(score_white) + ")"
	else:
		move_label = "Pass"
		body = color_name + " passed"

	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label, now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": move_label, "pass": True,
		"fen": fen, "sgf": sgf,
		"captures_black": game["captures_black"], "captures_white": game["captures_white"],
		"status": new_status, "winner": new_winner or "",
		"draw_offer": ""
	}
	if score_black:
		ws_data["score_black"] = float(score_black)
	if score_white:
		ws_data["score_white"] = float(score_white)
	mochi.websocket.write(game["key"], ws_data)

	other = get_opponent(game, a.user.identity.id)

	msg_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
		"body": move_label, "pass": True,
		"fen": fen, "sgf": sgf,
		"captures_black": game["captures_black"], "captures_white": game["captures_white"],
		"status": new_status, "winner": new_winner or ""
	}
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
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return

	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return

	if game["status"] != "active":
		a.error(400, "Game is not active")
		return

	# Winner is the opponent
	other = get_opponent(game, a.user.identity.id)
	winner = other

	now = mochi.time.now()
	mochi.db.execute("update games set status='resigned', winner=?, updated=? where id=?", winner, now, game["id"])

	# Insert system message
	id = mochi.uid()
	msg = a.user.identity.name + " resigned"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": msg, "winner": winner})

	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "resign"},
		{"game": game["id"], "created": now, "body": msg, "winner": winner}
	)

	return {
		"data": {"success": True}
	}

# Offer a draw
def action_draw_offer(a):
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return

	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return

	if game["status"] != "active":
		a.error(400, "Game is not active")
		return

	if game["draw_offer"] == a.user.identity.id:
		a.error(400, "You already offered a draw")
		return

	other = get_opponent(game, a.user.identity.id)

	now = mochi.time.now()
	mochi.db.execute("update games set draw_offer=?, updated=? where id=?", a.user.identity.id, now, game["id"])

	# Insert system message
	id = mochi.uid()
	msg = a.user.identity.name + " offered a draw"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_offer", "created": now, "body": msg, "draw_offer": a.user.identity.id})

	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "draw_offer"},
		{"game": game["id"], "created": now, "body": msg, "draw_offer": a.user.identity.id}
	)

	return {
		"data": {"success": True}
	}

# Accept a draw offer
def action_draw_accept(a):
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return

	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return

	if game["status"] != "active":
		a.error(400, "Game is not active")
		return

	if not game["draw_offer"] or game["draw_offer"] == a.user.identity.id:
		a.error(400, "No draw offer to accept")
		return

	other = get_opponent(game, a.user.identity.id)

	now = mochi.time.now()
	mochi.db.execute("update games set status='draw', draw_offer=null, updated=? where id=?", now, game["id"])

	# Insert system message
	id = mochi.uid()
	msg = "Draw agreed"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_accept", "created": now, "body": msg})

	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "draw_accept"},
		{"game": game["id"], "created": now, "body": msg}
	)

	return {
		"data": {"success": True}
	}

# Decline a draw offer
def action_draw_decline(a):
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return

	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return

	if game["status"] != "active":
		a.error(400, "Game is not active")
		return

	if not game["draw_offer"] or game["draw_offer"] == a.user.identity.id:
		a.error(400, "No draw offer to decline")
		return

	other = get_opponent(game, a.user.identity.id)

	now = mochi.time.now()
	mochi.db.execute("update games set draw_offer=null, updated=? where id=?", now, game["id"])

	# Insert system message
	id = mochi.uid()
	msg = a.user.identity.name + " declined the draw"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_decline", "created": now, "body": msg, "draw_offer": ""})

	mochi.message.send(
		{"from": a.user.identity.id, "to": other, "service": "go", "event": "draw_decline"},
		{"game": game["id"], "created": now, "body": msg}
	)

	return {
		"data": {"success": True}
	}

# Delete a finished game
def action_delete(a):
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return

	if game["identity"] != a.user.identity.id and game["opponent"] != a.user.identity.id:
		a.error(403, "Not a player in this game")
		return

	if game["status"] == "active":
		a.error(400, "Cannot delete an active game")
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
	if not mochi.valid(game_id, "id"):
		return

	identity = e.content("identity")
	if not mochi.valid(identity, "entity"):
		return

	identity_name = e.content("identity_name")
	if not mochi.valid(identity_name, "name"):
		return

	opponent = e.content("opponent")
	if not mochi.valid(opponent, "entity"):
		return

	opponent_name = e.content("opponent_name")
	if not mochi.valid(opponent_name, "name"):
		return

	black = e.content("black")
	if not mochi.valid(black, "entity"):
		return

	board_size = e.content("board_size")
	if board_size:
		if not mochi.valid(str(board_size), "integer"):
			return
		board_size = int(board_size)
	else:
		board_size = 19
	if board_size not in [9, 13, 19]:
		return

	komi = e.content("komi")
	if komi:
		if not mochi.valid(str(komi), "numeric"):
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

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		return

	result = mochi.db.execute(
		"insert or ignore into games ( id, identity, identity_name, opponent, opponent_name, black, board_size, komi, fen, key, updated, created ) values ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )",
		game_id, identity, identity_name, opponent, opponent_name, black, board_size, komi, fen, mochi.random.alphanumeric(16), mochi.time.now(), created
	)
	if result == 0:
		return

	mochi.service.call("notifications", "send", "new", "Go game", identity_name + " started a game", game_id, "/go/" + game_id)

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
	body = e.content("body") or ""
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
		if not mochi.valid(str(captures_black), "integer"):
			return
		captures_black = int(captures_black)
	else:
		captures_black = game["captures_black"]
	if captures_white:
		if not mochi.valid(str(captures_white), "integer"):
			return
		captures_white = int(captures_white)
	else:
		captures_white = game["captures_white"]

	now = mochi.time.now()
	mochi.db.execute("update games set fen=?, previous_fen=?, sgf=?, captures_black=?, captures_white=?, status=?, winner=?, draw_offer=null, updated=? where id=?",
		fen, previous_fen, sgf, captures_black, captures_white, status, winner, now, game["id"])

	id = e.content("message")
	if not mochi.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		created = now

	name = e.content("name") or "Opponent"

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	ws_data = {
		"type": "move", "created": created, "member": sender, "name": name,
		"body": body,
		"fen": fen, "previous_fen": previous_fen or "", "sgf": sgf,
		"captures_black": captures_black, "captures_white": captures_white,
		"status": status, "winner": winner or "",
		"draw_offer": ""
	}
	is_pass = e.content("pass")
	if is_pass:
		ws_data["pass"] = True
	score_black = e.content("score_black")
	score_white = e.content("score_white")
	if score_black:
		ws_data["score_black"] = float(score_black)
	if score_white:
		ws_data["score_white"] = float(score_white)

	mochi.websocket.write(game["key"], ws_data)
	mochi.service.call("notifications", "send", "move", "Go move", name + " played " + body, game["id"], "/go/" + game["id"])

# Received a chat message event
def event_message(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	id = e.content("message")
	if not mochi.valid(str(id), "id"):
		return

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		return

	body = e.content("body")
	if not mochi.valid(str(body), "text"):
		return
	if len(str(body)) > 10000:
		return

	name = e.content("name") or "Opponent"

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], sender, name, body, created)

	mochi.websocket.write(game["key"], {"type": "message", "created": created, "member": sender, "name": name, "body": body})
	mochi.service.call("notifications", "send", "message", "Go message", name + ": " + body, game["id"], "/go/" + game["id"])

# Received a resign event
def event_resign(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	winner = e.content("winner")
	body = e.content("body") or "Opponent resigned"

	# Derive winner: the other player (not the one who resigned)
	players = [game["identity"], game["opponent"]]
	if winner not in players:
		winner = game["opponent"] if sender == game["identity"] else game["identity"]

	now = mochi.time.now()
	mochi.db.execute("update games set status='resigned', winner=?, updated=? where id=?", winner, now, game["id"])

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], sender, "", body, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": body, "winner": winner or ""})
	mochi.service.call("notifications", "send", "resign", "Go game", body, game["id"], "/go/" + game["id"])

# Received a draw offer event
def event_draw_offer(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	body = e.content("body") or "Draw offered"

	now = mochi.time.now()
	mochi.db.execute("update games set draw_offer=?, updated=? where id=?", sender, now, game["id"])

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], sender, "", body, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_offer", "created": now, "body": body, "draw_offer": sender})
	mochi.service.call("notifications", "send", "draw_offer", "Go", body, game["id"], "/go/" + game["id"])

# Received a draw accept event
def event_draw_accept(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	body = e.content("body") or "Draw agreed"

	now = mochi.time.now()
	mochi.db.execute("update games set status='draw', draw_offer=null, updated=? where id=?", now, game["id"])

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], sender, "", body, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_accept", "created": now, "body": body})
	mochi.service.call("notifications", "send", "draw_accept", "Go", body, game["id"], "/go/" + game["id"])

# Received a draw decline event
def event_draw_decline(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if sender != game["identity"] and sender != game["opponent"]:
		return

	body = e.content("body") or "Draw declined"

	now = mochi.time.now()
	mochi.db.execute("update games set draw_offer=null, updated=? where id=?", now, game["id"])

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], sender, "", body, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "draw_decline", "created": now, "body": body, "draw_offer": ""})
	mochi.service.call("notifications", "send", "draw_decline", "Go", body, game["id"], "/go/" + game["id"])

# Notification proxy actions

def action_notifications_subscribe(a):
	label = a.input("label", "").strip()
	type = a.input("type", "").strip()
	object = a.input("object", "").strip()
	destinations = a.input("destinations", "")

	if not label:
		a.error(400, "label is required")
		return
	if not mochi.valid(label, "text"):
		a.error(400, "Invalid label")
		return

	destinations_list = []
	if destinations:
		destinations_list = json.decode(destinations)
		if type(destinations_list) != "list":
			a.error(400, "Invalid destinations")
			return

	result = mochi.service.call("notifications", "subscribe", label, type, object, destinations_list)
	return {"data": {"id": result}}

def action_notifications_check(a):
	result = mochi.service.call("notifications", "subscriptions")
	return {"data": {"exists": len(result) > 0}}

def action_notifications_destinations(a):
	result = mochi.service.call("notifications", "destinations")
	return {"data": result}
