import { cn } from '@mochi/common'
import { getOpponentName, type Game } from '@/api/games'

interface GameStatusProps {
  game: Game
  myColor: 'b' | 'w'
  isMyTurn: boolean
  myIdentity: string
  score?: { black: number; white: number; winner: 'black' | 'white' } | null
  children?: React.ReactNode
}

export function GameStatus({
  game,
  myColor,
  isMyTurn,
  myIdentity,
  score,
  children,
}: GameStatusProps) {
  const opponentName = getOpponentName(game, myIdentity)
  const colorLabel = myColor === 'b' ? 'Black' : 'White'

  let statusText: string
  if (game.status === 'finished') {
    if (score) {
      const winnerColor = score.winner === 'black' ? 'Black' : 'White'
      statusText = `${winnerColor} wins — B:${score.black} W:${score.white}`
    } else if (game.winner) {
      statusText = game.winner === myIdentity
        ? 'You win!'
        : `${opponentName} wins`
    } else {
      statusText = 'Game over'
    }
  } else if (game.status === 'draw') {
    statusText = 'Draw'
  } else if (game.status === 'resigned') {
    statusText = game.winner === myIdentity
      ? `${opponentName} resigned — you win!`
      : `You resigned — ${opponentName} wins`
  } else {
    statusText = isMyTurn ? 'Your move' : `${opponentName}'s move`
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 py-1">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full border',
            myColor === 'b'
              ? 'bg-gray-900 border-gray-700'
              : 'bg-gray-100 border-gray-400'
          )}
        />
        <span className="text-sm text-muted-foreground">
          Playing as {colorLabel}
        </span>
      </div>
      <span className="text-muted-foreground">·</span>
      <span className="text-sm font-medium truncate">{statusText}</span>
      {game.status === 'active' && (
        <>
          <span className="text-muted-foreground">·</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-700 bg-gray-900 dark:border-gray-600 dark:bg-gray-800" />
              {game.captures_black}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-400 bg-gray-100 dark:border-gray-500 dark:bg-gray-200" />
              {game.captures_white}
            </span>
          </div>
        </>
      )}
      {children && <div className="ml-auto shrink-0">{children}</div>}
    </div>
  )
}
