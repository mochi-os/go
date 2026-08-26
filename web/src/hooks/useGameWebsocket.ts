// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useCallback } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  useGameWebsocket as useSharedGameWebsocket,
  type MergeMovePayload,
  type UseGameWebsocketResult,
} from '@mochi/web'
import { gameKeys } from '@/hooks/useGames'
import type { Game } from '@/api/games'

export const useGameWebsocket = (
  gameId?: string,
  gameKey?: string
): UseGameWebsocketResult => {
  const { t } = useLingui()

  // Go carries the move record as SGF, the position before the move for the ko
  // rule, and both capture counts.
  const mergeMove = useCallback<MergeMovePayload<Game>>(
    (game, payload) => ({
      previous_fen: (payload.previous_fen as string) ?? game.previous_fen,
      sgf: (payload.sgf as string) ?? game.sgf,
      captures_black:
        typeof payload.captures_black === 'number'
          ? payload.captures_black
          : game.captures_black,
      captures_white:
        typeof payload.captures_white === 'number'
          ? payload.captures_white
          : game.captures_white,
    }),
    []
  )

  return useSharedGameWebsocket<Game>({
    gameId,
    gameKey,
    keys: gameKeys,
    unknownSenderLabel: t`Unknown`,
    mergeMove,
  })
}
