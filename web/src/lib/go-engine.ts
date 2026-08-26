// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

// Go (Weiqi) game engine
// Board state format (FEN-like): rows joined by `/`, `.`=empty, `B`=black, `W`=white
// Metadata after space: turn, captures_black, captures_white, ko_point, consecutive_passes
// Example: "........./........./... b 0 0 - 0"

type Stone = 'B' | 'W' | '.'
type Color = 'black' | 'white'

interface GoGameState {
  size: 9 | 13 | 19
  grid: Stone[][]
  turn: Color
  capturesBlack: number
  capturesWhite: number
  koPoint: [number, number] | null
  consecutivePasses: number
  previousGrid: Stone[][] | null
  lastMovePos: [number, number] | null
}

function colorToStone(color: Color): Stone {
  return color === 'black' ? 'B' : 'W'
}

function oppositeColor(color: Color): Color {
  return color === 'black' ? 'white' : 'black'
}

function emptyGrid(size: number): Stone[][] {
  return Array.from({ length: size }, () => Array(size).fill('.') as Stone[])
}

function sameGrid(a: Stone[][], b: Stone[][]): boolean {
  if (a.length !== b.length) return false
  return a.every((row, r) => row.length === b[r].length && row.every((cell, c) => cell === b[r][c]))
}

function cloneGrid(grid: Stone[][]): Stone[][] {
  return grid.map((row) => [...row])
}

function neighbors(
  row: number,
  col: number,
  size: number
): [number, number][] {
  const result: [number, number][] = []
  if (row > 0) result.push([row - 1, col])
  if (row < size - 1) result.push([row + 1, col])
  if (col > 0) result.push([row, col - 1])
  if (col < size - 1) result.push([row, col + 1])
  return result
}

// Flood fill to find all stones in a group
function findGroup(
  grid: Stone[][],
  row: number,
  col: number
): { stones: [number, number][]; liberties: Set<string> } {
  const size = grid.length
  const color = grid[row][col]
  if (color === '.') return { stones: [], liberties: new Set() }

  const visited = new Set<string>()
  const stones: [number, number][] = []
  const liberties = new Set<string>()
  const stack: [number, number][] = [[row, col]]

  while (stack.length > 0) {
    const [r, c] = stack.pop()!
    const key = `${r},${c}`
    if (visited.has(key)) continue
    visited.add(key)

    if (grid[r][c] === color) {
      stones.push([r, c])
      for (const [nr, nc] of neighbors(r, c, size)) {
        const nkey = `${nr},${nc}`
        if (visited.has(nkey)) continue
        if (grid[nr][nc] === '.') {
          liberties.add(nkey)
        } else if (grid[nr][nc] === color) {
          stack.push([nr, nc])
        }
      }
    }
  }

  return { stones, liberties }
}

// Remove a group from the board, returns number of stones removed
function removeGroup(grid: Stone[][], stones: [number, number][]): number {
  for (const [r, c] of stones) {
    grid[r][c] = '.'
  }
  return stones.length
}

// One walk over the empty regions, shared by scoreTerritory and
// GoGame.territory - they were the same flood fill written twice, so a scoring
// fix could land in one and not the other. `owner` is 'B'/'W' when the region
// touches exactly one colour, 'N' (dame) otherwise.
function emptyRegions(
  grid: Stone[][]
): { cells: [number, number][]; owner: 'B' | 'W' | 'N' }[] {
  const size = grid.length
  const visited = new Set<string>()
  const regions: { cells: [number, number][]; owner: 'B' | 'W' | 'N' }[] = []

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] !== '.' || visited.has(`${r},${c}`)) continue

      const cells: [number, number][] = []
      const stack: [number, number][] = [[r, c]]
      let touchesBlack = false
      let touchesWhite = false

      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!
        const ck = `${cr},${cc}`
        if (visited.has(ck)) continue
        visited.add(ck)
        if (grid[cr][cc] !== '.') continue

        cells.push([cr, cc])
        for (const [nr, nc] of neighbors(cr, cc, size)) {
          if (visited.has(`${nr},${nc}`)) continue
          if (grid[nr][nc] === '.') stack.push([nr, nc])
          else if (grid[nr][nc] === 'B') touchesBlack = true
          else if (grid[nr][nc] === 'W') touchesWhite = true
        }
      }

      regions.push({
        cells,
        owner:
          touchesBlack && !touchesWhite ? 'B'
          : touchesWhite && !touchesBlack ? 'W'
          : 'N',
      })
    }
  }

  return regions
}

// Count territory using area scoring (Chinese rules)
function scoreTerritory(grid: Stone[][]): { black: number; white: number } {
  const size = grid.length
  let black = 0
  let white = 0

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === 'B') black++
      else if (grid[r][c] === 'W') white++
    }
  }

  for (const region of emptyRegions(grid)) {
    if (region.owner === 'B') black += region.cells.length
    else if (region.owner === 'W') white += region.cells.length
  }

  return { black, white }

}

function parseBoard(fen: string): GoGameState {
  const parts = fen.split(' ')
  const boardStr = parts[0]
  const rows = boardStr.split('/')
  // Validated, not asserted: a malformed FEN otherwise yields a size every
  // later bounds check trusts.
  const size: 9 | 13 | 19 =
    rows.length === 9 || rows.length === 13 || rows.length === 19
      ? rows.length
      : 19

  const grid: Stone[][] = rows.map((row) =>
    row.split('').map((ch) => {
      if (ch === 'B') return 'B'
      if (ch === 'W') return 'W'
      return '.'
    })
  )

  const turn: Color = parts[1] === 'w' ? 'white' : 'black'
  const capturesBlack = parts[2] ? parseInt(parts[2], 10) : 0
  const capturesWhite = parts[3] ? parseInt(parts[3], 10) : 0

  let koPoint: [number, number] | null = null
  if (parts[4] && parts[4] !== '-') {
    const [kr, kc] = parts[4].split(',').map(Number)
    koPoint = [kr, kc]
  }

  const consecutivePasses = parts[5] ? parseInt(parts[5], 10) : 0

  return {
    size,
    grid,
    turn,
    capturesBlack,
    capturesWhite,
    koPoint,
    consecutivePasses,
    previousGrid: null,
    lastMovePos: null,
  }
}

function serializeBoard(state: GoGameState): string {
  const boardStr = state.grid.map((row) => row.join('')).join('/')
  const turnChar = state.turn === 'black' ? 'b' : 'w'
  const koStr = state.koPoint ? `${state.koPoint[0]},${state.koPoint[1]}` : '-'
  return `${boardStr} ${turnChar} ${state.capturesBlack} ${state.capturesWhite} ${koStr} ${state.consecutivePasses}`
}

export class GoGame {
  // Wraps an already-computed state without building a board the caller
  // immediately discards.
  static fromState(state: GoGameState): GoGame {
    const game = new GoGame(state.size)
    game.state = state
    return game
  }

  private state: GoGameState

  constructor(
    size: 9 | 13 | 19 = 19,
    board?: string,
    previousBoard?: string
  ) {
    if (board) {
      this.state = parseBoard(board)
    } else {
      this.state = {
        size,
        grid: emptyGrid(size),
        turn: 'black',
        capturesBlack: 0,
        capturesWhite: 0,
        koPoint: null,
        consecutivePasses: 0,
        previousGrid: null,
        lastMovePos: null,
      }
    }

    if (previousBoard) {
      this.state.previousGrid = parseBoard(previousBoard).grid
    }
  }

  private cloneState(): GoGameState {
    return {
      ...this.state,
      grid: cloneGrid(this.state.grid),
      previousGrid: this.state.previousGrid
        ? cloneGrid(this.state.previousGrid)
        : null,
      koPoint: this.state.koPoint ? [...this.state.koPoint] : null,
      lastMovePos: this.state.lastMovePos
        ? [...this.state.lastMovePos]
        : null,
    }
  }

  place(row: number, col: number): GoGame {
    if (!this.isLegal(row, col)) {
      throw new Error(`Illegal move at ${row},${col}`)
    }

    const newState = this.cloneState()
    const stone = colorToStone(newState.turn)
    const opponent = colorToStone(oppositeColor(newState.turn))

    // Save current grid as previous (for ko detection)
    newState.previousGrid = cloneGrid(this.state.grid)

    // Place stone
    newState.grid[row][col] = stone

    // Capture opponent groups with no liberties
    let captured = 0
    let capturedSinglePos: [number, number] | null = null
    for (const [nr, nc] of neighbors(row, col, newState.size)) {
      if (newState.grid[nr][nc] === opponent) {
        const group = findGroup(newState.grid, nr, nc)
        if (group.liberties.size === 0) {
          if (group.stones.length === 1) {
            capturedSinglePos = group.stones[0]
          }
          captured += removeGroup(newState.grid, group.stones)
        }
      }
    }

    // Update captures
    if (newState.turn === 'black') {
      newState.capturesBlack += captured
    } else {
      newState.capturesWhite += captured
    }

    // Set ko point: if exactly 1 stone was captured and the placed stone
    // has exactly 1 liberty (the captured position), it's a potential ko
    newState.koPoint = null
    if (captured === 1 && capturedSinglePos) {
      const placedGroup = findGroup(newState.grid, row, col)
      if (placedGroup.stones.length === 1 && placedGroup.liberties.size === 1) {
        newState.koPoint = capturedSinglePos
      }
    }

    newState.lastMovePos = [row, col]
    newState.consecutivePasses = 0
    newState.turn = oppositeColor(newState.turn)

    return GoGame.fromState(newState)
  }

  pass(): GoGame {
    const newState = this.cloneState()
    newState.consecutivePasses++
    newState.koPoint = null
    newState.lastMovePos = null
    newState.turn = oppositeColor(newState.turn)
    newState.previousGrid = cloneGrid(this.state.grid)

    return GoGame.fromState(newState)
  }

  isLegal(row: number, col: number): boolean {
    const { grid, size, turn, koPoint } = this.state

    // Out of bounds
    if (row < 0 || row >= size || col < 0 || col >= size) return false

    // Already occupied
    if (grid[row][col] !== '.') return false

    // Ko rule
    if (koPoint && koPoint[0] === row && koPoint[1] === col) return false

    // Try placing the stone
    const testGrid = cloneGrid(grid)
    const stone = colorToStone(turn)
    const opponent = colorToStone(oppositeColor(turn))
    testGrid[row][col] = stone

    // Remove captured opponent groups
    for (const [nr, nc] of neighbors(row, col, size)) {
      if (testGrid[nr][nc] === opponent) {
        const group = findGroup(testGrid, nr, nc)
        if (group.liberties.size === 0) {
          removeGroup(testGrid, group.stones)
        }
      }
    }

    // Check if the placed stone's group has liberties (suicide rule)
    const placedGroup = findGroup(testGrid, row, col)
    if (placedGroup.liberties.size === 0) return false

    // Positional superko: the resulting position must not repeat the one before
    // this move. previousGrid is carried for exactly this and was read by
    // nothing, so a repeat-position cycle was legal.
    const { previousGrid } = this.state
    if (previousGrid && sameGrid(testGrid, previousGrid)) return false

    return true
  }


  // `winner` is null for a tie (reachable with komi 0). Never resolve a tie to
  // a colour: the caller records it as a player identity.
  score(komi: number = 6.5): {
    black: number
    white: number
    winner: Color | null
  } {
    const territory = scoreTerritory(this.state.grid)
    const black = territory.black
    const white = territory.white + komi
    return {
      black,
      white,
      winner: black === white ? null : black > white ? 'black' : 'white',
    }
  }

  // Returns per-cell territory ownership for finished-game overlay.
  // 'B' / 'W' = owned empty intersection; 'N' = dame/neutral; null = occupied stone.
  territory(): ('B' | 'W' | 'N' | null)[][] {
    const { grid, size } = this.state
    const result: ('B' | 'W' | 'N' | null)[][] = Array.from(
      { length: size },
      () => Array<'B' | 'W' | 'N' | null>(size).fill(null)
    )

    for (const region of emptyRegions(grid)) {
      for (const [tr, tc] of region.cells) result[tr][tc] = region.owner
    }

    return result
  }

  get turn(): Color {
    return this.state.turn
  }

  get board(): string {
    return serializeBoard(this.state)
  }


  get captures(): { black: number; white: number } {
    return {
      black: this.state.capturesBlack,
      white: this.state.capturesWhite,
    }
  }


  get consecutivePasses(): number {
    return this.state.consecutivePasses
  }

  get size(): number {
    return this.state.size
  }


  getStone(row: number, col: number): Stone {
    return this.state.grid[row][col]
  }

  // Convert row,col to SGF-style coordinate label (e.g., "D4", "Q16")
  static coordToLabel(
    row: number,
    col: number,
    size: number
  ): string {
    // Letters skip 'I' in Go notation
    const letters = 'ABCDEFGHJKLMNOPQRST'
    const letter = letters[col]
    const number = size - row
    return `${letter}${number}`
  }
}
