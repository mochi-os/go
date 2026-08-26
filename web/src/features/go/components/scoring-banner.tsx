// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

// The score after two passes is a proposal, not a result. Counting cannot tell
// a dead stone from a live one, so the rules settle a disagreement by resuming
// play - the player who left dead stones must then defend them or lose them to
// capture. Both players accept to end the game; either resumes to play on.

import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Play } from 'lucide-react'
import { Button, useFormat } from '@mochi/web'

export function ScoringBanner({
  black,
  white,
  waiting,
  onAccept,
  onResume,
  isAccepting,
  isResuming,
}: {
  black: number
  white: number
  // The opponent has already accepted, so this player's accept ends the game.
  waiting: boolean
  onAccept: () => void
  onResume: () => void
  isAccepting: boolean
  isResuming: boolean
}) {
  const { t } = useLingui()
  const { formatNumber } = useFormat()

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <p className='text-sm'>
        {waiting
          ? (
              <Trans>
                Your opponent accepts this score: black {formatNumber(black)}, white{' '}
                {formatNumber(white)}
              </Trans>
            )
          : (
              <Trans>
                Proposed score: black {formatNumber(black)}, white {formatNumber(white)}
              </Trans>
            )}
      </p>
      <div className='flex gap-2'>
        <Button size='sm' onClick={onAccept} disabled={isAccepting || isResuming}>
          <Check className='size-4' />
          {t`Accept score`}
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={onResume}
          disabled={isAccepting || isResuming}
        >
          <Play className='size-4' />
          {t`Resume play`}
        </Button>
      </div>
    </div>
  )
}
