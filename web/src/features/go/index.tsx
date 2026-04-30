import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  useAuthStore,
  usePageTitle,
  PageHeader,
  Main,
  GeneralError,
  GameHeader,
  GameHeaderStat,
  GameHeaderStoneDot,
  ConfirmDialog,
  IconButton,
  getErrorMessage,
  toast,
  Skeleton,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mochi/web'
import { MoreHorizontal, Trash2, Loader2, Flag, Handshake, RotateCcw, SkipForward, MessageCircle } from 'lucide-react'
import { GoGame } from '@/lib/go-engine'
import { useSidebarContext } from '@/context/sidebar-context'
import { setLastGame } from '@/hooks/useGameStorage'
import { useGameWebsocket } from '@/hooks/useGameWebsocket'
import { getOpponentName, type Game } from '@/api/games'
import {
  useInfiniteMessagesQuery,
  useGamesQuery,
  useSendMessageMutation,
  useGameDetailQuery,
  useMoveMutation,
  usePassMutation,
  useResignMutation,
  useDeleteGameMutation,
  useCreateGameMutation,
  useDrawOfferMutation,
  useDrawAcceptMutation,
  useDrawDeclineMutation,
} from '@/hooks/useGames'
import { GameEmptyState } from './components/game-empty-state'
import { GoBoard } from './components/go-board'
import { DrawOfferBanner } from './components/draw-offer-banner'
import { ChatMessageList } from './components/chat-message-list'
import { ChatInput } from './components/chat-input'

function getGoStatusText(
  game: Game,
  myIdentity: string,
  isMyTurn: boolean,
  score?: { black: number; white: number; winner: 'black' | 'white' } | null
): string {
  const opponentName = getOpponentName(game, myIdentity)

  if (game.status === 'finished') {
    if (score) {
      const winnerColor = score.winner === 'black' ? 'Black' : 'White'
      return `${winnerColor} wins — B:${score.black} W:${score.white}`
    }

    if (game.winner) {
      return game.winner === myIdentity ? 'You win!' : `${opponentName} wins`
    }

    return 'Game over'
  }

  if (game.status === 'draw') {
    return 'Draw'
  }

  if (game.status === 'resigned') {
    return game.winner === myIdentity
      ? `${opponentName} resigned — you win!`
      : `You resigned — ${opponentName} wins`
  }

  return isMyTurn ? 'Your move' : `${opponentName}'s move`
}

export function GoGameView() {
  usePageTitle('Go')

  const navigate = useNavigate()
  const { openNewGameDialog, setWebsocketStatus } = useSidebarContext()
  const [newMessage, setNewMessage] = useState('')
  const [showResignDialog, setShowResignDialog] = useState(false)
  const [showPassDialog, setShowPassDialog] = useState(false)
  const [showMobileChat, setShowMobileChat] = useState(false)
  const [lastMove, setLastMove] = useState<[number, number] | null>(null)
  const {
    identity: currentUserIdentity,
    initialize: initializeAuth,
  } = useAuthStore()

  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  const params = useParams({ strict: false }) as { gameId?: string }
  const selectedGameId = params?.gameId

  useEffect(() => {
    if (selectedGameId) {
      setLastGame(selectedGameId)
    }
  }, [selectedGameId])

  // Games list
  const gamesQuery = useGamesQuery()
  const games = useMemo(
    () => gamesQuery.data?.games ?? [],
    [gamesQuery.data?.games]
  )

  const selectedGame = useMemo(
    () =>
      games.find(
        (g) => g.id === selectedGameId || g.fingerprint === selectedGameId
      ) ?? null,
    [games, selectedGameId]
  )

  // Game detail
  const { data: gameDetail, isLoading: isLoadingDetail } = useGameDetailQuery(selectedGame?.id)

  const game = gameDetail?.game
  const myIdentity = gameDetail?.identity ?? currentUserIdentity

  // Go state from game detail FEN
  const goGame = useMemo(() => {
    if (!game?.fen) return null
    return new GoGame(undefined, game.fen, game.previous_fen ?? undefined)
  }, [game?.fen, game?.previous_fen])

  const myColor: 'b' | 'w' = game && myIdentity ? (game.black === myIdentity ? 'b' : 'w') : 'b'
  const isMyTurn = goGame ? (goGame.turn === 'black' ? myColor === 'b' : myColor === 'w') : false

  // Score for finished games
  const score = useMemo(() => {
    if (!game || !goGame || game.status !== 'finished') return null
    return goGame.score(game.komi)
  }, [game, goGame])

  // Messages
  const messagesQuery = useInfiniteMessagesQuery(selectedGame?.id)
  const chatMessages = useMemo(() => {
    if (!messagesQuery.data?.pages) return []
    const all = [...messagesQuery.data.pages].reverse().flatMap((p) => p.messages)
    const seen = new Set<string>()
    return all.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
  }, [messagesQuery.data?.pages])

  // Send message
  const sendMessageMutation = useSendMessageMutation({
    onSuccess: () => {
      setNewMessage('')
    },
  })

  // Move
  const moveMutation = useMoveMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to make move'))
    },
  })

  // Pass
  const passMutation = usePassMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to pass'))
    },
  })

  // Resign
  const resignMutation = useResignMutation({
    onSuccess: () => {
      setShowResignDialog(false)
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to resign'))
    },
  })

  // Draw
  const drawOfferMutation = useDrawOfferMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to offer draw'))
    },
  })
  const drawAcceptMutation = useDrawAcceptMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to accept draw'))
    },
  })
  const drawDeclineMutation = useDrawDeclineMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to decline draw'))
    },
  })

  // Rematch
  const rematchMutation = useCreateGameMutation({
    onSuccess: (data) => {
      void navigate({ to: '/$gameId', params: { gameId: data.id } })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to create rematch'))
    },
  })

  // Delete
  const deleteGameMutation = useDeleteGameMutation({
    onSuccess: () => {
      toast.success('Game deleted')
      void navigate({ to: '/' })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to delete game'))
    },
  })

  // WebSocket
  const { status, retries } = useGameWebsocket(
    selectedGame?.id,
    selectedGame?.key
  )
  useEffect(() => {
    setWebsocketStatus(status, retries)
  }, [status, retries, setWebsocketStatus])

  const handleMove = useCallback(
    (row: number, col: number) => {
      if (!game || !selectedGame || !goGame) return

      // Place stone using the Go engine
      let newGame: GoGame
      try {
        newGame = goGame.place(row, col)
      } catch {
        return
      }

      setLastMove([row, col])

      const moveLabel = GoGame.coordToLabel(row, col, goGame.size)
      const sgfMove = `${myColor === 'b' ? 'B' : 'W'}[${row},${col}]`
      const newSgf = game.sgf ? `${game.sgf};${sgfMove}` : sgfMove

      moveMutation.mutate({
        gameId: selectedGame.id,
        fen: newGame.board,
        previous_fen: game.fen,
        sgf: newSgf,
        captures_black: newGame.captures.black,
        captures_white: newGame.captures.white,
        move_label: moveLabel,
      })
    },
    [game, selectedGame, goGame, myColor, moveMutation]
  )

  const handlePass = useCallback(() => {
    if (!game || !selectedGame || !goGame) return
    setShowPassDialog(false)

    const newGame = goGame.pass()
    const sgfMove = `${myColor === 'b' ? 'B' : 'W'}[pass]`
    const newSgf = game.sgf ? `${game.sgf};${sgfMove}` : sgfMove

    // Two consecutive passes end the game
    const isGameOver = newGame.consecutivePasses >= 2
    const scoreResult = isGameOver ? newGame.score(game.komi) : null

    let winner = ''
    if (isGameOver && scoreResult) {
      const winnerColor = scoreResult.winner
      winner = game.black === game.identity
        ? (winnerColor === 'black' ? game.identity : game.opponent)
        : (winnerColor === 'black' ? game.opponent : game.identity)
    }

    passMutation.mutate({
      gameId: selectedGame.id,
      fen: newGame.board,
      sgf: newSgf,
      status: isGameOver ? 'finished' : undefined,
      winner: isGameOver ? winner : undefined,
      score_black: scoreResult?.black,
      score_white: scoreResult?.white,
    })
  }, [game, selectedGame, goGame, myColor, myIdentity, passMutation])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGame) return
    const body = newMessage.trim()
    if (!body) return
    sendMessageMutation.mutate({ gameId: selectedGame.id, body })
  }

  const handleResign = () => {
    if (!selectedGame) return
    resignMutation.mutate({ gameId: selectedGame.id })
  }

  const handleDelete = () => {
    if (!selectedGame) return
    deleteGameMutation.mutate({ gameId: selectedGame.id })
  }

  const handleDrawOffer = () => {
    if (!selectedGame) return
    drawOfferMutation.mutate({ gameId: selectedGame.id })
  }

  const handleDrawAccept = () => {
    if (!selectedGame) return
    drawAcceptMutation.mutate({ gameId: selectedGame.id })
  }

  const handleDrawDecline = () => {
    if (!selectedGame) return
    drawDeclineMutation.mutate({ gameId: selectedGame.id })
  }

  const handleRematch = () => {
    if (!game || !myIdentity) return
    const opponentId = game.identity === myIdentity ? game.opponent : game.identity
    rematchMutation.mutate({
      opponent: opponentId,
      boardSize: game.board_size as 9 | 13 | 19,
      komi: game.komi,
    })
  }

  // Loading / empty
  if (selectedGameId && gamesQuery.isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader title="Go" />
        <Main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="aspect-square max-w-[560px] w-full" />
        </Main>
      </div>
    )
  }

  if (!selectedGame) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader title="Go" />
        <Main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {gamesQuery.error ? (
            <GeneralError
              error={gamesQuery.error}
              minimal
              mode="inline"
              reset={gamesQuery.refetch}
            />
          ) : (
            <GameEmptyState
              onNewGame={openNewGameDialog}
              hasExistingGames={games.length > 0}
            />
          )}
        </Main>
      </div>
    )
  }

  const opponentName = game
    ? game.identity === myIdentity
      ? game.opponent_name
      : game.identity_name
    : ''

  const opponentFingerprint = game
    ? game.identity === myIdentity
      ? game.opponent
      : game.identity
    : ''

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <Main className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: Board */}
          <div className="flex flex-1 flex-col px-2 sm:px-4 pb-2 min-h-0">
            {isLoadingDetail ? (
              <Skeleton className="aspect-square max-w-[560px] w-full mx-auto" />
            ) : game && goGame ? (
              <>
                <div className="shrink-0">
                  <GameHeader
                    variant='strip'
                    myTurn={game.status === 'active' ? isMyTurn : undefined}
                    title={
                      game.board_size === 19
                        ? opponentName
                        : `${opponentName} (${game.board_size}×${game.board_size})`
                    }
                    opponentFingerprint={opponentFingerprint || undefined}
                    opponentName={opponentName}
                    status={getGoStatusText(game, myIdentity, isMyTurn, score)}
                    stats={
                      <>
                        <GameHeaderStat
                          icon={<GameHeaderStoneDot color={myColor === 'b' ? 'black' : 'white'} />}
                          label={myColor === 'b' ? 'Black' : 'White'}
                        />
                        {game.status === 'active' && (
                          <>
                            <GameHeaderStat
                              icon={<GameHeaderStoneDot color='black' />}
                              value={game.captures_black}
                              srLabel='Black captures:'
                            />
                            <GameHeaderStat
                              icon={<GameHeaderStoneDot color='white' />}
                              value={game.captures_white}
                              srLabel='White captures:'
                            />
                          </>
                        )}
                      </>
                    }
                    actions={
                      <>
                        <IconButton
                          variant='ghost'
                          className='min-[900px]:hidden'
                          onClick={() => setShowMobileChat(true)}
                          label='Open chat panel'
                        >
                          <MessageCircle className='size-4' />
                        </IconButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              variant='ghost'
                              label='Open game actions'
                            >
                              <MoreHorizontal className='size-4' />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end' className='w-48'>
                            {game.status === 'active' ? (
                              <>
                                {isMyTurn && (
                                  <DropdownMenuItem
                                    onClick={() => setShowPassDialog(true)}
                                    disabled={passMutation.isPending}
                                  >
                                    <SkipForward className='mr-2 size-4' /> Pass
                                  </DropdownMenuItem>
                                )}
                                {game.draw_offer !== myIdentity && (
                                  <DropdownMenuItem
                                    onClick={handleDrawOffer}
                                    disabled={drawOfferMutation.isPending}
                                  >
                                    <Handshake className='mr-2 size-4' /> Offer draw
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => setShowResignDialog(true)}>
                                  <Flag className='mr-2 size-4' /> Resign
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  onClick={handleRematch}
                                  disabled={rematchMutation.isPending}
                                >
                                  <RotateCcw className='mr-2 size-4' /> Rematch
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleDelete}>
                                  <Trash2 className='mr-2 size-4' /> Delete game
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                    banner={
                      game.draw_offer
                        ? game.draw_offer === myIdentity
                          ? (
                              <p className='text-sm text-muted-foreground'>
                                Draw offered — waiting for {opponentName}
                              </p>
                            )
                          : (
                              <DrawOfferBanner
                                opponentName={opponentName}
                                onAccept={handleDrawAccept}
                                onDecline={handleDrawDecline}
                                isAccepting={drawAcceptMutation.isPending}
                                isDeclining={drawDeclineMutation.isPending}
                              />
                            )
                        : undefined
                    }
                  />
                </div>
                <div className="flex-1 min-h-0 mt-3" style={{ containerType: 'size' }}>
                  <GoBoard
                    fen={game.fen}
                    previousFen={game.previous_fen}
                    myColor={myColor}
                    isMyTurn={isMyTurn}
                    gameStatus={game.status}
                    onMove={handleMove}
                    lastMove={lastMove}
                  />
                </div>
              </>
            ) : null}
          </div>

          {/* Right: Chat sidebar */}
          <div className="hidden min-[900px]:flex w-72 lg:w-80 flex-col border-l">
            <div className="border-b px-3 py-2">
              <h3 className="text-sm font-medium">Chat</h3>
            </div>
            <ChatMessageList
              messagesQuery={messagesQuery}
              chatMessages={chatMessages}
              isLoadingMessages={messagesQuery.isLoading}
              messagesError={messagesQuery.error}
              currentUserIdentity={myIdentity}
            />
            <ChatInput
              newMessage={newMessage}
              setNewMessage={setNewMessage}
              onSendMessage={handleSendMessage}
              isSending={sendMessageMutation.isPending}
              errorMessage={
                sendMessageMutation.error
                  ? getErrorMessage(sendMessageMutation.error, 'Failed to send')
                  : null
              }
            />
          </div>
        </Main>
      </div>

      {/* Mobile chat sheet */}
      <Sheet open={showMobileChat} onOpenChange={setShowMobileChat}>
        <SheetContent
          side="right"
          className="flex flex-col p-0 w-80"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="border-b px-3 py-2">
            <SheetTitle className="text-sm font-medium">Chat</SheetTitle>
          </SheetHeader>
          <ChatMessageList
            messagesQuery={messagesQuery}
            chatMessages={chatMessages}
            isLoadingMessages={messagesQuery.isLoading}
            messagesError={messagesQuery.error}
            currentUserIdentity={myIdentity}
          />
          <ChatInput
            newMessage={newMessage}
            setNewMessage={setNewMessage}
            onSendMessage={handleSendMessage}
            isSending={sendMessageMutation.isPending}
            errorMessage={
              sendMessageMutation.error
                ? getErrorMessage(sendMessageMutation.error, 'Failed to send')
                : null
            }
          />
        </SheetContent>
      </Sheet>

      {/* Resign confirmation */}
      <ConfirmDialog
        open={showResignDialog}
        onOpenChange={setShowResignDialog}
        title='Resign game?'
        desc={`Are you sure you want to resign? ${opponentName} will win the game.`}
        confirmText={
          resignMutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Resigning...
            </>
          ) : (
            'Resign'
          )
        }
        destructive
        handleConfirm={handleResign}
        isLoading={resignMutation.isPending}
      />

      {/* Pass confirmation */}
      <ConfirmDialog
        open={showPassDialog}
        onOpenChange={setShowPassDialog}
        title={goGame?.consecutivePasses === 1 ? 'End game?' : 'Pass turn?'}
        desc={
          goGame?.consecutivePasses === 1
            ? `${opponentName} also passed. Confirming will end the game and score the board.`
            : 'Skip your turn and pass to your opponent.'
        }
        confirmText={
          passMutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Passing...
            </>
          ) : (
            goGame?.consecutivePasses === 1 ? 'End game' : 'Pass'
          )
        }
        destructive={goGame?.consecutivePasses === 1}
        handleConfirm={handlePass}
        isLoading={passMutation.isPending}
      />

    </>
  )
}
