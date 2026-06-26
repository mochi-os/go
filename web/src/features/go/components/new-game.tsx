// Copyright © 2026 Mochi OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  Input,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  getErrorMessage,
  toast,
  toastAction,
  Skeleton,
  PersonPicker,
  GeneralError,
  shellNavigateExternal,
  type Person,
} from '@mochi/web'
import { Loader2, Plus, UserPlus, Users } from 'lucide-react'
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
  const [friendsPickerOpen, setFriendsPickerOpen] = useState(false)
  const [boardSize, setBoardSize] = useState<number>(19)
  const [komi, setKomi] = useState<string>('6.5')

  const { data, isLoading, error, refetch } = useNewGameFriendsQuery({
    enabled: open,
  })

  const createGameMutation = useCreateGameMutation()

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

  const canSubmit = !!selectedFriend && !komiError && !createGameMutation.isPending

  const handleCreateGame = async () => {
    if (!selectedFriend) {
      toast.error(t`Please select a friend`)
      return
    }
    const komiValue = Number.parseFloat(komi)
    try {
      const data = await toastAction(
        createGameMutation.mutateAsync({
          opponent: selectedFriend,
          boardSize,
          komi: komiValue,
        }),
        {
          loading: t`Creating game...`,
          success: t`Game created`,
          error: (error) => getErrorMessage(error, t`Failed to create game`),
        }
      )
      onOpenChange(false)
      if (data.id) {
        navigate({ to: '/$gameId', params: { gameId: data.id } })
      }
    } catch {
      // toastAction already showed error
    }
  }

  useEffect(() => {
    if (!open) {
      setSelectedFriend('')
      setFriendsPickerOpen(false)
      setBoardSize(19)
      setKomi('6.5')
    }
  }, [open])

  useEffect(() => {
    if (open && !isLoading && friends.length > 0) {
      const timer = setTimeout(() => setFriendsPickerOpen(true), 50)
      return () => clearTimeout(timer)
    }
  }, [open, isLoading, friends.length])

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldCloseOnInteractOutside={false}
    >
      <ResponsiveDialogContent className="sm:max-w-[420px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Trans>New Game</Trans>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            <Trans>Start a new Go game</Trans>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium"><Trans>Choose opponent</Trans></label>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : error ? (
              <GeneralError error={error} minimal mode="inline" reset={refetch} />
            ) : friends.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border py-8 text-center">
                <UserPlus className="text-muted-foreground mb-3 h-10 w-10 opacity-50" />
                <p className="text-muted-foreground text-sm font-medium"><Trans>No friends yet</Trans></p>
                <p className="text-muted-foreground mt-1 text-xs"><Trans>Add friends in the People app to start playing</Trans></p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => shellNavigateExternal('/people/?action=add')}
                >
                  <Users className="size-4" />
                  <Trans>Add friends</Trans>
                </Button>
              </div>
            ) : (
              <PersonPicker
                mode="single"
                value={selectedFriend}
                onChange={(value) => setSelectedFriend(value as string)}
                local={friendsAsPeople}
                placeholder={t`Select a friend...`}
                emptyMessage={t`No friends found`}
                open={friendsPickerOpen}
                onOpenChange={setFriendsPickerOpen}
              />
            )}
          </div>

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
        </div>

        <ResponsiveDialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createGameMutation.isPending}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={handleCreateGame} disabled={!canSubmit}>
            {createGameMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {createGameMutation.isPending ? t`Creating...` : t`Start game`}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
