// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  GameNewGameDialog,
  Input,
  getErrorMessage,
  toast,
  type Person,
} from '@mochi/web'
import { useSidebarContext } from '@/context/sidebar-context'
import { useNewGameFriendsQuery, useCreateGameMutation } from '@/hooks/useGames'

const BOARD_SIZES = [
  { value: 9, label: '9×9' },
  { value: 13, label: '13×13' },
  { value: 19, label: '19×19' },
] as const

const KOMI_PRESETS = [
  { value: '6.5', label: '6.5' },
  { value: '7.5', label: '7.5' },
  { value: '0', label: '0' },
] as const

export function NewGame() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { newGameDialogOpen: open, closeNewGameDialog } = useSidebarContext()
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen) closeNewGameDialog()
  }
  const [selectedFriend, setSelectedFriend] = useState<string>('')
  const [boardSize, setBoardSize] = useState<number>(19)
  const [komi, setKomi] = useState<string>('6.5')

  const { data, isLoading, error, refetch } = useNewGameFriendsQuery({
    enabled: open,
  })

  const createGameMutation = useCreateGameMutation({
    onSuccess: (data) => {
      onOpenChange(false)
      if (data.id) {
        navigate({ to: '/$gameId', params: { gameId: data.id } })
        toast.success(t`Game created`)
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to create game`))
    },
  })

  const friends = useMemo(() => data?.friends ?? [], [data?.friends])

  const friendsAsPeople: Person[] = useMemo(
    () => friends.map((f) => ({ id: f.id, name: f.name })),
    [friends]
  )

  const komiError = useMemo(() => {
    const v = Number.parseFloat(komi)
    if (Number.isNaN(v)) return t`Enter a valid number`
    if (v < 0 || v > 10) return t`Must be between 0 and 10`
    return null
  }, [komi, t])

  const handleCreateGame = () => {
    if (!selectedFriend) {
      toast.error(t`Please select a friend`)
      return
    }
    const komiValue = Number.parseFloat(komi)
    createGameMutation.mutate({
      opponent: selectedFriend,
      boardSize,
      komi: komiValue,
    })
  }

  useEffect(() => {
    if (!open) {
      setSelectedFriend('')
      setBoardSize(19)
      setKomi('6.5')
    }
  }, [open])

  return (
    <GameNewGameDialog
      open={open}
      onOpenChange={onOpenChange}
      friends={friendsAsPeople}
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      mode="single"
      value={selectedFriend}
      onChange={(value) => setSelectedFriend(value as string)}
      canSubmit={
        !!selectedFriend && !komiError && !createGameMutation.isPending
      }
      isSubmitting={createGameMutation.isPending}
      onSubmit={handleCreateGame}
      options={
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium"><Trans>Board size</Trans></label>
            <div className="flex gap-2">
              {BOARD_SIZES.map((size) => (
                <Button
                  key={size.value}
                  type="button"
                  variant={boardSize === size.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setBoardSize(size.value)}
                  className="flex-1"
                >
                  {size.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="komi-input" className="text-sm font-medium"><Trans>Komi</Trans></label>
            <div className="flex items-center gap-2">
              {KOMI_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant={komi === preset.value ? 'default' : 'outline'}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setKomi(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
              <Input
                id="komi-input"
                type="number"
                step="0.5"
                min="0"
                max="10"
                value={komi}
                onChange={(e) => setKomi(e.target.value)}
                aria-describedby={komiError ? 'komi-error' : 'komi-hint'}
                className="flex-1"
              />
            </div>
            {komiError ? (
              <p id="komi-error" className="text-xs text-destructive">{komiError}</p>
            ) : (
              <p id="komi-hint" className="text-xs text-muted-foreground">
                <Trans>Points added to White's score to compensate for Black going first</Trans>
              </p>
            )}
          </div>
        </>
      }
      labels={{
        title: <Trans>New game</Trans>,
        description: <Trans>Start a new Go game</Trans>,
        opponentLabel: <Trans>Choose opponent</Trans>,
        emptyTitle: <Trans>No friends yet</Trans>,
        emptyHint: <Trans>Add friends in the People app to start playing</Trans>,
        addFriends: <Trans>Add friends</Trans>,
        placeholder: t`Select a friend...`,
        emptyMessage: t`No friends found`,
        cancel: <Trans>Cancel</Trans>,
        submit: t`Start game`,
        submitting: t`Creating...`,
      }}
    />
  )
}
