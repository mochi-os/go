// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

export function getOpponentName(game: Game, myIdentity: string): string {
  return game.identity === myIdentity ? game.opponent_name : game.identity_name
}

export interface Game {
  id: string
  fingerprint?: string
  identity: string
  identity_name: string
  opponent: string
  opponent_name: string
  black: string
  board_size: number
  komi: number
  status: 'active' | 'finished' | 'draw' | 'resigned'
  winner: string | null
  draw_offer: string | null
  fen: string
  previous_fen: string | null
  sgf: string
  captures_black: number
  captures_white: number
  key: string
  updated: number
  created: number
}

export type MessageType = 'message' | 'move' | 'system'

export interface GameMessage {
  id: string
  game: string
  member: string
  name: string
  body: string
  type: MessageType
  // For type 'system': the event kind (resign / draw_offer / draw_accept /
  // draw_decline), used to render localised text. Empty/absent on legacy
  // rows, which fall back to `body`.
  event?: string
  created: number
}

export interface GameViewResponse {
  game: Game
  identity: string
}

export interface GetGamesResponse {
  games: Game[]
}

export interface GetMessagesResponse {
  messages: GameMessage[]
  hasMore?: boolean
  nextCursor?: number
}

export interface CreateGameResponse {
  id: string
  black: string
}

export interface NewGameFriend {
  class: string
  id: string
  identity: string
  name: string
}

export interface GetNewGameResponse {
  friends: NewGameFriend[]
}

export interface SendMessageRequest {
  body: string
}

export interface SendMessageResponse {
  id: string
}

export interface MoveRequest {
  fen: string
  previous_fen?: string
  sgf: string
  captures_black: number
  captures_white: number
  move_label: string
  status?: string
  winner?: string
}

export interface PassRequest {
  fen: string
  sgf: string
  status?: string
  winner?: string
  score_black?: number
  score_white?: number
}

export interface MoveResponse {
  id: string
}

export interface ResignResponse {
  success: boolean
}

export interface DeleteResponse {
  success: boolean
}

export interface DrawOfferResponse {
  success: boolean
}
