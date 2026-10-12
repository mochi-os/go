// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

// The move record a game carries in its `sgf` field. It is our own text, not
// SGF: entries joined by `;`, each `B[row,col]` or `W[pass]`, appended by the
// game view on every move.

const STONE = /^([BW])\[(\d+),(\d+)\]$/

/**
 * The last entry of the record when it is a stone, or null when the record is
 * empty, ends in a pass, or ends in something this does not recognise.
 */
export function lastStone(
  record: string
): { color: 'B' | 'W'; row: number; col: number } | null {
  const entries = record.split(';')
  const match = STONE.exec(entries[entries.length - 1])
  if (!match) return null
  return {
    color: match[1] as 'B' | 'W',
    row: Number(match[2]),
    col: Number(match[3]),
  }
}
