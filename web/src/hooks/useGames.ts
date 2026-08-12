// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { createGameHooks } from '@mochi/web'
import {
  gamesApi,
  type CreateGameResponse,
  type MoveResponse,
  type PassRequest,
} from '@/api/games'

const shared = createGameHooks(gamesApi)

export const gameKeys = shared.gameKeys

export const {
  useGameDetailQuery,
  useGamesQuery,
  useInfiniteMessagesQuery,
  useSendMessageMutation,
  useMoveMutation,
  useNewGameFriendsQuery,
  useResignMutation,
  useDrawOfferMutation,
  useDrawAcceptMutation,
  useDrawDeclineMutation,
  useDeleteGameMutation,
} = shared

interface PassVariables extends PassRequest {
  gameId: string
}

// Passing is go's alone: it advances the game without placing a stone, so it
// invalidates exactly what a move does.
export const usePassMutation = (
  options?: UseMutationOptions<MoveResponse, Error, PassVariables, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId, ...payload }) => gamesApi.pass(gameId, payload),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({
        queryKey: gameKeys.messages(variables.gameId),
      })
      queryClient.invalidateQueries({
        queryKey: gameKeys.detail(variables.gameId),
        exact: true,
      })
      queryClient.invalidateQueries({ queryKey: gameKeys.all(), exact: true })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

interface CreateGameVariables {
  opponent: string
  boardSize: number
  komi: number
}

export const useCreateGameMutation = (
  options?: UseMutationOptions<
    CreateGameResponse,
    Error,
    CreateGameVariables,
    unknown
  >
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ opponent, boardSize, komi }: CreateGameVariables) =>
      gamesApi.create(opponent, boardSize, komi),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: gameKeys.all(), exact: true })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}
