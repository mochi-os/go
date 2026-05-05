import { useCallback, useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@mochi/web'
import { GoGame } from '@/lib/go-engine'

// Standard star points (hoshi) for each board size
const STAR_POINTS: Record<number, [number, number][]> = {
  9: [
    [2, 2], [2, 6], [4, 4], [6, 2], [6, 6],
  ],
  13: [
    [3, 3], [3, 9], [6, 6], [9, 3], [9, 9],
  ],
  19: [
    [3, 3], [3, 9], [3, 15],
    [9, 3], [9, 9], [9, 15],
    [15, 3], [15, 9], [15, 15],
  ],
}

interface GoBoardProps {
  fen: string
  previousFen: string | null
  myColor: 'b' | 'w'
  isMyTurn: boolean
  gameStatus: string
  onMove: (row: number, col: number) => void
  lastMove?: [number, number] | null
}

export function GoBoard({
  fen,
  previousFen,
  myColor,
  isMyTurn,
  gameStatus,
  onMove,
  lastMove,
}: GoBoardProps) {
  const { t } = useLingui()
  const [hoverPos, setHoverPos] = useState<[number, number] | null>(null)
  const [keyboardPos, setKeyboardPos] = useState<[number, number] | null>(null)
  const [isBoardFocused, setIsBoardFocused] = useState(false)

  const game = useMemo(
    () => new GoGame(undefined, fen, previousFen ?? undefined),
    [fen, previousFen]
  )

  const size = game.size
  const isActive = gameStatus === 'active'
  const isFinished = gameStatus === 'finished'
  const starPoints = STAR_POINTS[size] ?? []

  const territoryMap = useMemo(
    () => (isFinished ? game.territory() : null),
    [game, isFinished]
  )

  const handleClick = useCallback(
    (row: number, col: number) => {
      if (!isActive || !isMyTurn) return
      if (game.getStone(row, col) !== '.') return
      if (!game.isLegal(row, col)) return
      onMove(row, col)
    },
    [game, isActive, isMyTurn, onMove]
  )

  const handleMouseEnter = useCallback(
    (row: number, col: number) => {
      if (!isActive || !isMyTurn) return
      if (game.getStone(row, col) !== '.') return
      setHoverPos([row, col])
    },
    [game, isActive, isMyTurn]
  )

  const handleMouseLeave = useCallback(() => {
    setHoverPos(null)
  }, [])

  // Keyboard navigation for the board (composite widget pattern)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      const center = Math.floor(size / 2)
      const [kr, kc] = keyboardPos ?? [center, center]

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setKeyboardPos([Math.max(0, kr - 1), kc])
          break
        case 'ArrowDown':
          e.preventDefault()
          setKeyboardPos([Math.min(size - 1, kr + 1), kc])
          break
        case 'ArrowLeft':
          e.preventDefault()
          setKeyboardPos([kr, Math.max(0, kc - 1)])
          break
        case 'ArrowRight':
          e.preventDefault()
          setKeyboardPos([kr, Math.min(size - 1, kc + 1)])
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (keyboardPos) handleClick(keyboardPos[0], keyboardPos[1])
          break
        default:
          break
      }
    },
    [keyboardPos, size, handleClick]
  )

  // Cell size calculation
  const cellPx = size === 19 ? 28 : size === 13 ? 36 : 48
  const boardPx = cellPx * (size - 1)
  const padding = Math.round(cellPx * 0.8)
  const totalPx = boardPx + padding * 2

  // Column labels (skip I)
  const letters = 'ABCDEFGHJKLMNOPQRST'

  const boardDescription = isMyTurn && isActive
    ? (myColor === 'b'
      ? t`${size}×${size} Go board, your turn. Use arrow keys to navigate and Enter or Space to place a black stone.`
      : t`${size}×${size} Go board, your turn. Use arrow keys to navigate and Enter or Space to place a white stone.`)
    : t`${size}×${size} Go board`

  return (
    <div
      className="go-board-container mx-auto w-full"
      style={{ maxWidth: 'min(100cqw, 100cqh)' }}
    >
      <svg
        viewBox={`0 0 ${totalPx} ${totalPx}`}
        className="w-full h-full"
        style={{ background: 'var(--go-board-bg)' }}
        role="application"
        aria-label={boardDescription}
        tabIndex={0}
        onFocus={() => {
          setIsBoardFocused(true)
          if (!keyboardPos) setKeyboardPos([Math.floor(size / 2), Math.floor(size / 2)])
        }}
        onBlur={() => {
          setIsBoardFocused(false)
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Board background with wood grain effect */}
        <rect
          x={0}
          y={0}
          width={totalPx}
          height={totalPx}
          style={{ fill: 'var(--go-board-bg)' }}
        />

        {/* Grid lines */}
        {Array.from({ length: size }).map((_, i) => (
          <g key={`lines-${i}`} aria-hidden="true">
            {/* Horizontal lines */}
            <line
              x1={padding}
              y1={padding + i * cellPx}
              x2={padding + boardPx}
              y2={padding + i * cellPx}
              style={{ stroke: 'var(--go-board-grid)' }}
              strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.8}
            />
            {/* Vertical lines */}
            <line
              x1={padding + i * cellPx}
              y1={padding}
              x2={padding + i * cellPx}
              y2={padding + boardPx}
              style={{ stroke: 'var(--go-board-grid)' }}
              strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.8}
            />
          </g>
        ))}

        {/* Star points (hoshi) */}
        {starPoints.map(([r, c]) => (
          <circle
            key={`star-${r}-${c}`}
            cx={padding + c * cellPx}
            cy={padding + r * cellPx}
            r={cellPx * 0.12}
            style={{ fill: 'var(--go-board-grid)' }}
            aria-hidden="true"
          />
        ))}

        {/* Coordinate labels — decorative, hidden from screen readers */}
        {Array.from({ length: size }).map((_, i) => (
          <g key={`coord-${i}`} aria-hidden="true">
            {/* Top letters */}
            <text
              x={padding + i * cellPx}
              y={padding * 0.45}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={cellPx * 0.35}
              style={{ fill: 'var(--go-board-label)' }}
              className="select-none"
            >
              {letters[i]}
            </text>
            {/* Bottom letters */}
            <text
              x={padding + i * cellPx}
              y={totalPx - padding * 0.45}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={cellPx * 0.35}
              style={{ fill: 'var(--go-board-label)' }}
              className="select-none"
            >
              {letters[i]}
            </text>
            {/* Left numbers */}
            <text
              x={padding * 0.45}
              y={padding + i * cellPx}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={cellPx * 0.35}
              style={{ fill: 'var(--go-board-label)' }}
              className="select-none"
            >
              {size - i}
            </text>
            {/* Right numbers */}
            <text
              x={totalPx - padding * 0.45}
              y={padding + i * cellPx}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={cellPx * 0.35}
              style={{ fill: 'var(--go-board-label)' }}
              className="select-none"
            >
              {size - i}
            </text>
          </g>
        ))}

        {/* Clickable areas and stones */}
        {Array.from({ length: size }).map((_, row) =>
          Array.from({ length: size }).map((_, col) => {
            const cx = padding + col * cellPx
            const cy = padding + row * cellPx
            const stone = game.getStone(row, col)
            const isLastMove =
              lastMove && lastMove[0] === row && lastMove[1] === col
            const isHover =
              hoverPos && hoverPos[0] === row && hoverPos[1] === col
            const isKeyboardFocus =
              isBoardFocused && keyboardPos &&
              keyboardPos[0] === row && keyboardPos[1] === col
            const stoneRadius = cellPx * 0.45
            const canPlace =
              isActive && isMyTurn && stone === '.' && game.isLegal(row, col)

            const colLabel = letters[col]
            const rowLabel = String(size - row)
            const territoryOwner = territoryMap?.[row]?.[col] ?? null
            const intersectionLabel =
              stone === 'B'
                ? t`Black stone at ${colLabel}${rowLabel}`
                : stone === 'W'
                  ? t`White stone at ${colLabel}${rowLabel}`
                  : territoryOwner === 'B'
                    ? t`Black territory at ${colLabel}${rowLabel}`
                    : territoryOwner === 'W'
                      ? t`White territory at ${colLabel}${rowLabel}`
                      : canPlace
                        ? t`Empty intersection ${colLabel}${rowLabel}, click or press Enter to place`
                        : t`Empty intersection ${colLabel}${rowLabel}`

            return (
              <g key={`${row}-${col}`} role="img" aria-label={intersectionLabel}>
                {/* Clickable area */}
                <rect
                  x={cx - cellPx / 2}
                  y={cy - cellPx / 2}
                  width={cellPx}
                  height={cellPx}
                  fill="transparent"
                  className={cn(canPlace && 'cursor-pointer')}
                  onClick={() => handleClick(row, col)}
                  onMouseEnter={() => handleMouseEnter(row, col)}
                  onMouseLeave={handleMouseLeave}
                />

                {/* Placed stones */}
                {stone === 'B' && (
                  <g pointerEvents="none" aria-hidden="true">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={stoneRadius}
                      style={{ fill: 'var(--go-stone-b)', stroke: 'var(--go-stone-b-stroke)' }}
                      strokeWidth={0.5}
                    />
                    {/* Highlight effect */}
                    <circle
                      cx={cx - stoneRadius * 0.25}
                      cy={cy - stoneRadius * 0.25}
                      r={stoneRadius * 0.25}
                      fill="rgba(255,255,255,0.15)"
                    />
                  </g>
                )}
                {stone === 'W' && (
                  <g pointerEvents="none" aria-hidden="true">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={stoneRadius}
                      style={{ fill: 'var(--go-stone-w)', stroke: 'var(--go-stone-w-stroke)' }}
                      strokeWidth={0.8}
                    />
                    {/* Highlight effect */}
                    <circle
                      cx={cx - stoneRadius * 0.25}
                      cy={cy - stoneRadius * 0.25}
                      r={stoneRadius * 0.25}
                      fill="rgba(255,255,255,0.5)"
                    />
                  </g>
                )}

                {/* Last move marker */}
                {isLastMove && stone !== '.' && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={stoneRadius * 0.3}
                    fill="none"
                    stroke={stone === 'B' ? 'var(--go-stone-w)' : 'var(--go-board-grid)'}
                    strokeWidth={1.5}
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                )}

                {/* Hover preview */}
                {isHover && canPlace && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={stoneRadius}
                    fill={myColor === 'b' ? 'var(--go-stone-b)' : 'var(--go-stone-w)'}
                    stroke={myColor === 'b' ? 'var(--go-stone-b-stroke)' : 'var(--go-stone-w-stroke)'}
                    strokeWidth={0.5}
                    opacity={0.4}
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                )}

                {/* Territory marker (finished games only) */}
                {stone === '.' && territoryOwner !== null && territoryOwner !== 'N' && (
                  <rect
                    x={cx - cellPx * 0.2}
                    y={cy - cellPx * 0.2}
                    width={cellPx * 0.4}
                    height={cellPx * 0.4}
                    style={
                      territoryOwner === 'B'
                        ? { fill: 'var(--go-stone-b)' }
                        : { fill: 'var(--go-stone-w)', stroke: 'var(--go-board-grid)' }
                    }
                    strokeWidth={0.5}
                    opacity={0.75}
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                )}

                {/* Keyboard cursor */}
                {isKeyboardFocus && (
                  <rect
                    x={cx - cellPx * 0.4}
                    y={cy - cellPx * 0.4}
                    width={cellPx * 0.8}
                    height={cellPx * 0.8}
                    fill="none"
                    style={{ stroke: 'var(--primary)' }}
                    strokeWidth={2}
                    rx={3}
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                )}
              </g>
            )
          })
        )}
      </svg>
    </div>
  )
}
