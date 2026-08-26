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
  type DrawOfferResponse,
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
    onError: (error, variables, context, mutation) => {
      // Mirror createGameHooks' useMoveMutation: a rejected pass otherwise
      // leaves the client showing a position the server never took, and pass is
      // where the client also computes the terminal status and score.
      queryClient.invalidateQueries({
        queryKey: gameKeys.detail(variables.gameId),
        exact: true,
      })
      restOptions.onError?.(error, variables, context, mutation)
    },
    ...restOptions,
  })
}

// Accepting or refusing the proposed score. Both change the game's status and
// its message list, so they invalidate what a pass does.
const useScoringMutation = (
  call: (gameId: string) => Promise<DrawOfferResponse>,
  options?: UseMutationOptions<DrawOfferResponse, Error, { gameId: string }, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId }: { gameId: string }) => call(gameId),
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

export const useScoreAcceptMutation = (
  options?: UseMutationOptions<DrawOfferResponse, Error, { gameId: string }, unknown>
) => useScoringMutation(gamesApi.scoreAccept, options)

export const useScoreResumeMutation = (
  options?: UseMutationOptions<DrawOfferResponse, Error, { gameId: string }, unknown>
) => useScoringMutation(gamesApi.scoreResume, options)

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
