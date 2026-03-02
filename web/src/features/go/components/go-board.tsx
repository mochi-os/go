import { useCallback, useMemo, useState } from 'react'
import { cn } from '@mochi/common'
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
  const [hoverPos, setHoverPos] = useState<[number, number] | null>(null)

  const game = useMemo(
    () => new GoGame(undefined, fen, previousFen ?? undefined),
    [fen, previousFen]
  )

  const size = game.size
  const isActive = gameStatus === 'active'
  const starPoints = STAR_POINTS[size] ?? []

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

  // Cell size calculation
  const cellPx = size === 19 ? 28 : size === 13 ? 36 : 48
  const boardPx = cellPx * (size - 1)
  const padding = Math.round(cellPx * 0.8)
  const totalPx = boardPx + padding * 2

  // Column labels (skip I)
  const letters = 'ABCDEFGHJKLMNOPQRST'

  return (
    <div
      className="go-board-container mx-auto w-full"
      style={{ maxWidth: 'min(100%, calc(100dvh - 108px))' }}
    >
      <svg
        viewBox={`0 0 ${totalPx} ${totalPx}`}
        className="w-full h-full"
        style={{ background: '#DEB887' }}
      >
        {/* Board background with wood grain effect */}
        <rect
          x={0}
          y={0}
          width={totalPx}
          height={totalPx}
          fill="#DEB887"
          className="dark:fill-[#B8860B]"
        />

        {/* Grid lines */}
        {Array.from({ length: size }).map((_, i) => (
          <g key={`lines-${i}`}>
            {/* Horizontal lines */}
            <line
              x1={padding}
              y1={padding + i * cellPx}
              x2={padding + boardPx}
              y2={padding + i * cellPx}
              stroke="#333"
              strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.8}
              className="dark:stroke-[#1a1a1a]"
            />
            {/* Vertical lines */}
            <line
              x1={padding + i * cellPx}
              y1={padding}
              x2={padding + i * cellPx}
              y2={padding + boardPx}
              stroke="#333"
              strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.8}
              className="dark:stroke-[#1a1a1a]"
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
            fill="#333"
            className="dark:fill-[#1a1a1a]"
          />
        ))}

        {/* Coordinate labels */}
        {Array.from({ length: size }).map((_, i) => (
          <g key={`coord-${i}`}>
            {/* Top letters */}
            <text
              x={padding + i * cellPx}
              y={padding * 0.45}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={cellPx * 0.35}
              fill="#666"
              className="dark:fill-[#888] select-none"
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
              fill="#666"
              className="dark:fill-[#888] select-none"
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
              fill="#666"
              className="dark:fill-[#888] select-none"
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
              fill="#666"
              className="dark:fill-[#888] select-none"
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
            const stoneRadius = cellPx * 0.45
            const canPlace =
              isActive && isMyTurn && stone === '.' && game.isLegal(row, col)

            return (
              <g key={`${row}-${col}`}>
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
                  <g pointerEvents="none">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={stoneRadius}
                      fill="#1a1a1a"
                      stroke="#000"
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
                  <g pointerEvents="none">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={stoneRadius}
                      fill="#f5f5f0"
                      stroke="#888"
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
                    stroke={stone === 'B' ? '#fff' : '#333'}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                )}

                {/* Hover preview */}
                {isHover && canPlace && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={stoneRadius}
                    fill={myColor === 'b' ? '#1a1a1a' : '#f5f5f0'}
                    stroke={myColor === 'b' ? '#000' : '#888'}
                    strokeWidth={0.5}
                    opacity={0.4}
                    pointerEvents="none"
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
