// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useCallback, useMemo } from 'react'
import { Outlet } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { GameRouteLayout, useAuthStore } from '@mochi/web'
import { getOpponentName, type Game } from '@/api/games'
import { useGamesQuery } from '@/hooks/useGames'
import { NewGame } from '@/features/go/components/new-game'

// A game in 'scoring' is waiting for both players to agree the count, or to
// play on. Listing it as completed told a player it was over while the board
// still asked them for an answer.
const isLive = (game: Game) =>
  game.status === 'active' || game.status === 'scoring'

export function GoLayout() {
  const { t } = useLingui()
  const gamesQuery = useGamesQuery()
  const games = useMemo(
    () => gamesQuery.data?.games ?? [],
    [gamesQuery.data?.games]
  )
  const { identity: myIdentity } = useAuthStore()

  // Anything other than the full board is called out beside the name, so a
  // 13×13 game is not mistaken for a 19×19 one in the list.
  const gameTitle = useCallback(
    (game: Game) => {
      const name = myIdentity
        ? getOpponentName(game, myIdentity)
        : game.opponent_name
      const size =
        game.board_size !== 19 ? ` (${game.board_size}×${game.board_size})` : ''
      return `${name}${size}`
    },
    [myIdentity]
  )

  const opponentId = useCallback(
    (game: Game) =>
      myIdentity && game.identity === myIdentity
        ? game.opponent
        : game.identity,
    [myIdentity]
  )

  return (
    <GameRouteLayout
      games={games}
      appName='go'
      gameTitle={gameTitle}
      opponentId={opponentId}
      isLive={isLive}
      labels={{
        active: t`Active games`,
        completed: t`Completed`,
        newGame: t`New game`,
      }}
      newGameDialog={<NewGame />}
    >
      <Outlet />
    </GameRouteLayout>
  )
}
