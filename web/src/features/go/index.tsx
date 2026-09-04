// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  useAuthStore,
  usePageTitle,
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
  GameChatPanels,
  GameResignDialog,
  GameDeleteDialog,
  GamePlaceholderPage,
  useGameChatMessages,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useFormat,
  getAppPath,
} from '@mochi/web'
import { MoreHorizontal, Trash2, Loader2, Flag, Handshake, RotateCcw, SkipForward, MessageCircle } from 'lucide-react'
import { GoGame } from '@/lib/go-engine'
import { useSidebarContext } from '@/context/sidebar-context'
import { setLastGame } from '@/hooks/useGameStorage'
import { useGameWebsocket } from '@/hooks/useGameWebsocket'
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
  useScoreAcceptMutation,
  useScoreResumeMutation,
} from '@/hooks/useGames'
import { GameEmptyState } from './components/game-empty-state'
import { GoBoard } from './components/go-board'
import { DrawOfferBanner } from './components/draw-offer-banner'
import { ScoringBanner } from './components/scoring-banner'
import { ChatMessageList } from './components/chat-message-list'


export function GoGameView() {
  const { t } = useLingui()
  const { formatNumber } = useFormat()
  usePageTitle(t`Go`)

  const navigate = useNavigate()
  const { openNewGameDialog, setWebsocketStatus } = useSidebarContext()
  const [newMessage, setNewMessage] = useState('')
  const [showResignDialog, setShowResignDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
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
        (g) => g.id === selectedGameId
      ) ?? null,
    [games, selectedGameId]
  )

  // Cleared on switch and on the game's own position change: the marker is set
  // only from our own play, so it is stale both on the next game (drawn
  // wherever a stone/piece happens to sit) and once the opponent replies.
  useEffect(() => {
    setLastMove(null)
  }, [selectedGameId, selectedGame?.fen])

  // Game detail
  const {
    data: gameDetail,
    isLoading: isLoadingDetail,
    error: gameDetailError,
    refetch: refetchGameDetail,
  } = useGameDetailQuery(selectedGameId)

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
    const scored = ['finished', 'draw', 'scoring']
    if (!game || !goGame || !scored.includes(game.status)) return null
    return goGame.score(game.komi)
  }, [game, goGame])

  // Messages
  const messagesQuery = useInfiniteMessagesQuery(selectedGame?.id)
  const chatMessages = useGameChatMessages(messagesQuery.data?.pages)

  // Send message
  const sendMessageMutation = useSendMessageMutation({
    onSuccess: () => {
      setNewMessage('')
    },
  })

  // Move
  const moveMutation = useMoveMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to make move`))
    },
  })

  // Pass
  const passMutation = usePassMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to pass`))
    },
  })

  // Resign
  const resignMutation = useResignMutation({
    onSuccess: () => {
      setShowResignDialog(false)
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to resign`))
    },
  })

  // Draw
  const drawOfferMutation = useDrawOfferMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to offer draw`))
    },
  })
  const drawAcceptMutation = useDrawAcceptMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to accept draw`))
    },
  })
  // Scoring agreement
  const scoreAcceptMutation = useScoreAcceptMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to accept score`))
    },
  })
  const scoreResumeMutation = useScoreResumeMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to resume play`))
    },
  })
  const drawDeclineMutation = useDrawDeclineMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to decline draw`))
    },
  })

  // Rematch
  const rematchMutation = useCreateGameMutation({
    onSuccess: (data) => {
      void navigate({ to: '/$gameId', params: { gameId: data.id } })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to create rematch`))
    },
  })

  // Delete
  const deleteGameMutation = useDeleteGameMutation({
    onSuccess: () => {
      setShowDeleteDialog(false)
      toast.success(t`Game deleted`)
      void navigate({ to: '/' })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to delete game`))
    },
  })

  // WebSocket
  const { status, retries } = useGameWebsocket(
    selectedGame?.id,
    // From the detail row: the list never carries key, so passing
    // selectedGame?.key was always undefined and made the websocket manager
    // refetch /view just to learn it.
    game?.key
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

    passMutation.mutate({
      gameId: selectedGame.id,
      fen: newGame.board,
      sgf: newSgf,
      status: isGameOver ? 'scoring' : undefined,
      score_black: scoreResult?.black,
      score_white: scoreResult?.white,
    })
  }, [game, selectedGame, goGame, myColor, passMutation])

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

  const handleScoreAccept = () => {
    if (!selectedGame) return
    scoreAcceptMutation.mutate({ gameId: selectedGame.id })
  }

  const handleScoreResume = () => {
    if (!selectedGame) return
    scoreResumeMutation.mutate({ gameId: selectedGame.id })
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
      <GamePlaceholderPage title={t`Go`} mainClassName="p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-square max-w-[560px] w-full" />
      </GamePlaceholderPage>
    )
  }

  if (!selectedGame) {
    return (
      <GamePlaceholderPage title={t`Go`}>
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
      </GamePlaceholderPage>
    )
  }

  const opponentName = game
    ? game.identity === myIdentity
      ? game.opponent_name
      : game.identity_name
    : ''

  // Inline rather than a helper taking `t`: the Lingui macro only rewrites
  // templates tagged with the identifier destructured from useLingui(), so a
  // `t` passed as a parameter is a different binding and none of these is
  // extracted or rendered.
  const headline = (() => {
    if (!game) return ''

    if (game.status === 'finished') {
      if (score?.winner) {
        const winnerColor = score.winner === 'black' ? t`Black` : t`White`
        // Both through formatNumber: white's score includes komi and is
        // fractional, so a raw interpolation renders 6.5 where 6,5 is expected.
        const black = formatNumber(score.black)
        const white = formatNumber(score.white)
        return t`${winnerColor} wins — B:${black} W:${white}`
      }

      // A tie now records status 'draw', but a peer on an older build still
      // writes 'finished' with a winner nobody earned. Read the score, not it.
      if (score) return t`Draw`

      if (game.winner) {
        return game.winner === myIdentity ? t`You win!` : t`${opponentName} wins`
      }

      return t`Game over`
    }

    if (game.status === 'draw') return t`Draw`

    if (game.status === 'scoring') return t`Counting — agree the score or play on`

    if (game.status === 'resigned') {
      return game.winner === myIdentity
        ? t`${opponentName} resigned — you win!`
        : t`You resigned — ${opponentName} wins`
    }

    return isMyTurn ? t`Your move` : t`${opponentName}'s move`
  })()

  const opponentFingerprint = game
    ? game.identity === myIdentity
      ? game.opponent
      : game.identity
    : ''
  // The opponent's avatar and style come through this app's own game-bound
  // player-asset route, never a cross-app fetch from the people app.
  const opponentAssetUrl = (asset: 'avatar' | 'style') =>
    opponentFingerprint && selectedGameId
      ? `${getAppPath()}/${selectedGameId}/-/user/${opponentFingerprint}/asset/${asset}`
      : null

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <Main className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: Board */}
          <div className="flex flex-1 flex-col px-2 sm:px-4 pb-2 min-h-0">
            {isLoadingDetail ? (
              <Skeleton className="aspect-square max-w-[560px] w-full mx-auto" />
            ) : gameDetailError ? (
              <GeneralError
                error={gameDetailError}
                minimal
                mode="inline"
                reset={refetchGameDetail}
              />
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
                    opponentName={opponentName}
                    opponentAvatarUrl={opponentAssetUrl('avatar')}
                    opponentStyleUrl={opponentAssetUrl('style')}
                    status={headline}
                    stats={
                      <>
                        <GameHeaderStat
                          icon={<GameHeaderStoneDot color={myColor === 'b' ? 'black' : 'white'} />}
                          label={myColor === 'b' ? t`Black` : t`White`}
                        />
                        {game.status === 'active' && (
                          <>
                            <GameHeaderStat
                              icon={<GameHeaderStoneDot color='black' />}
                              value={game.captures_black}
                              srLabel={t`Black captures:`}
                            />
                            <GameHeaderStat
                              icon={<GameHeaderStoneDot color='white' />}
                              value={game.captures_white}
                              srLabel={t`White captures:`}
                            />
                          </>
                        )}
                      </>
                    }
                    actions={
                      <>
                        <IconButton
                          variant='ghost'
                          className='lg:hidden'
                          onClick={() => setShowMobileChat(true)}
                          label={t`Open chat panel`}
                        >
                          <MessageCircle className='size-4' />
                        </IconButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              variant='ghost'
                              label={t`Open game actions`}
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
                                    <SkipForward className='me-2 size-4' /> <Trans>Pass</Trans>
                                  </DropdownMenuItem>
                                )}
                                {game.draw_offer !== myIdentity && (
                                  <DropdownMenuItem
                                    onClick={handleDrawOffer}
                                    disabled={drawOfferMutation.isPending}
                                  >
                                    <Handshake className='me-2 size-4' /> <Trans>Offer draw</Trans>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => setShowResignDialog(true)}>
                                  <Flag className='me-2 size-4' /> <Trans>Resign</Trans>
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  onClick={handleRematch}
                                  disabled={rematchMutation.isPending}
                                >
                                  <RotateCcw className='me-2 size-4' /> <Trans>Rematch</Trans>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setShowDeleteDialog(true)}>
                                  <Trash2 className='me-2 size-4' /> <Trans>Delete game</Trans>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                    banner={
                      game.status === 'scoring'
                        ? game.scoring === myIdentity
                          ? (
                              <p className='text-sm text-muted-foreground'>
                                <Trans>Score accepted — waiting for {opponentName}</Trans>
                              </p>
                            )
                          : (
                              <ScoringBanner
                                black={game.score_black ?? 0}
                                white={game.score_white ?? 0}
                                waiting={Boolean(game.scoring)}
                                onAccept={handleScoreAccept}
                                onResume={handleScoreResume}
                                isAccepting={scoreAcceptMutation.isPending}
                                isResuming={scoreResumeMutation.isPending}
                              />
                            )
                        : game.draw_offer
                        ? game.draw_offer === myIdentity
                          ? (
                              <p className='text-sm text-muted-foreground'>
                                <Trans>Draw offered — waiting for {opponentName}</Trans>
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

          {/* Right: Chat sidebar, plus the mobile sheet through its portal */}
          <GameChatPanels
            sidebarClassName="hidden lg:flex w-72 xl:w-80"
            title={<Trans>Chat</Trans>}
            messageList={
              <ChatMessageList
                key={selectedGame.id}
                messagesQuery={messagesQuery}
                chatMessages={chatMessages}
                isLoadingMessages={messagesQuery.isLoading}
                messagesError={messagesQuery.error}
                currentUserIdentity={myIdentity}
              />
            }
            newMessage={newMessage}
            setNewMessage={setNewMessage}
            onSendMessage={handleSendMessage}
            isSending={sendMessageMutation.isPending}
            sendErrorMessage={
              sendMessageMutation.error
                ? getErrorMessage(sendMessageMutation.error, t`Failed to send`)
                : null
            }
            sheetOpen={showMobileChat}
            onSheetOpenChange={setShowMobileChat}
          />
        </Main>
      </div>

      <GameResignDialog
        open={showResignDialog}
        onOpenChange={setShowResignDialog}
        opponentName={opponentName}
        onConfirm={handleResign}
        isPending={resignMutation.isPending}
      />

      <GameDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        isPending={deleteGameMutation.isPending}
      />

      {/* Pass confirmation */}
      <ConfirmDialog
        open={showPassDialog}
        onOpenChange={setShowPassDialog}
        title={goGame?.consecutivePasses === 1 ? t`End game?` : t`Pass turn?`}
        desc={
          goGame?.consecutivePasses === 1
            ? t`${opponentName} also passed. Confirming will count the board and propose a score for you both to agree.`
            : t`Skip your turn and pass to your opponent.`
        }
        confirmText={
          passMutation.isPending ? (
            <>
              <Loader2 className="me-2 size-4 animate-spin" />
              <Trans>Passing...</Trans>
            </>
          ) : (
            goGame?.consecutivePasses === 1 ? t`End game` : t`Pass`
          )
        }
        destructive={goGame?.consecutivePasses === 1}
        handleConfirm={handlePass}
        isLoading={passMutation.isPending}
      />

    </>
  )
}
