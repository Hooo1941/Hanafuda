const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const HanafudaGame = require('./game');

const app = express();
const PORT = process.env.PORT || 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, '../client')));

const server = app.listen(PORT, () => {
  console.log(`花札服务器运行在 http://localhost:${PORT}`);
});

// WebSocket服务器
const wss = new WebSocket.Server({ server });

// 游戏房间管理
const games = new Map(); // 正在进行的游戏
const reconnectRooms = new Map(); // 等待重连的房间 roomId -> {game, disconnectedPlayerIndex, timestamp}
const RECONNECT_TIMEOUT = 5 * 60 * 1000; // 5分钟重连超时

// 生成唯一ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// 清理过期的重连房间
function cleanupExpiredReconnectRooms() {
  const now = Date.now();
  for (const [roomId, data] of reconnectRooms.entries()) {
    if (now - data.timestamp > RECONNECT_TIMEOUT) {
      console.log(`重连超时，删除房间: ${roomId}`);
      reconnectRooms.delete(roomId);
    }
  }
}

// 定期清理过期房间
setInterval(cleanupExpiredReconnectRooms, 30000); // 每30秒清理一次

// 广播消息给房间内所有玩家
function broadcastToRoom(game, message, excludePlayer = null) {
  game.players.forEach(player => {
    if (player.id !== excludePlayer && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// 发送游戏状态给所有玩家
function sendGameStateToAll(game) {
  game.players.forEach((player, index) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: 'game_state',
        state: game.getGameState(index)
      }));
    }
  });
}

wss.on('connection', (ws) => {
  const playerId = generateId();
  console.log(`玩家连接: ${playerId}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, playerId, message);
    } catch (error) {
      console.error('消息处理错误:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    console.log(`玩家断开: ${playerId}`);
    handleDisconnect(playerId);
  });

  // 发送玩家ID
  ws.send(JSON.stringify({ 
    type: 'connected', 
    playerId: playerId 
  }));
});

function handleMessage(ws, playerId, message) {
  const { type, ...data } = message;

  switch (type) {
    case 'join_game':
      handleJoinGame(ws, playerId, data.gameRules);
      break;

    case 'rejoin_game':
      handleRejoinGame(ws, playerId, data.roomId, data.oldPlayerId);
      break;

    case 'play_card':
      handlePlayCard(playerId, data.cardId);
      break;

    case 'select_field_card':
      handleSelectFieldCard(playerId, data.fieldCardId);
      break;

    case 'draw_from_deck':
      handleDrawFromDeck(playerId);
      break;

    case 'select_deck_field_card':
      handleSelectDeckFieldCard(playerId, data.fieldCardId, data.drawnCardId);
      break;

    case 'koikoi_decision':
      handleKoikoiDecision(playerId, data.continueGame);
      break;

    case 'start_new_round':
      handleStartNewRound(playerId);
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

function handleJoinGame(ws, playerId, gameRules = {}) {
  // 优先查找等待重连的房间
  let reconnectData = null;
  for (const [roomId, data] of reconnectRooms.entries()) {
    reconnectData = data;
    reconnectRooms.delete(roomId); // 从重连池中移除
    console.log(`匹配到等待重连的房间: ${roomId}`);
    break;
  }

  if (reconnectData) {
    // 匹配到等待重连的房间
    const game = reconnectData.game;
    const emptyPlayerIndex = reconnectData.disconnectedPlayerIndex;
    
    // 添加新玩家到空位
    game.players[emptyPlayerIndex] = { id: playerId, ws: ws };
    games.set(game.roomId, game); // 重新放入活跃游戏池
    
    console.log(`玩家 ${playerId} 加入等待重连的房间 ${game.roomId}，占据位置 ${emptyPlayerIndex}`);
    
    // 通知新玩家
    ws.send(JSON.stringify({
      type: 'joined_game',
      roomId: game.roomId,
      playerIndex: emptyPlayerIndex,
      playersCount: 2,
      reconnected: true
    }));
    
    // 通知另一位玩家对手已回来
    const otherPlayerIndex = 1 - emptyPlayerIndex;
    const otherPlayer = game.players[otherPlayerIndex];
    if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
      otherPlayer.ws.send(JSON.stringify({
        type: 'opponent_reconnected',
        message: '对手已重新连接'
      }));
    }
    
    // 游戏恢复进行
    broadcastToRoom(game, {
      type: 'game_resumed'
    });
    
    // 发送当前游戏状态给所有玩家
    sendGameStateToAll(game);
    
    return;
  }
  
  // 没有等待重连的房间，查找等待中的普通游戏或创建新游戏
  let game = Array.from(games.values()).find(g => g.gameState === 'waiting' && g.players.length < 2);

  if (!game) {
    // 创建新游戏，传入游戏规则
    const roomId = generateId();
    game = new HanafudaGame(roomId, gameRules);
    games.set(roomId, game);
    console.log(`创建新房间: ${roomId}，规则:`, gameRules);
  }

  // 添加玩家
  if (game.addPlayer(playerId, ws)) {
    const playerIndex = game.getPlayerIndex(playerId);
    
    ws.send(JSON.stringify({
      type: 'joined_game',
      roomId: game.roomId,
      playerIndex: playerIndex,
      playersCount: game.players.length
    }));

    // 通知其他玩家
    broadcastToRoom(game, {
      type: 'player_joined',
      playersCount: game.players.length
    }, playerId);

    // 如果两个玩家都准备好了，开始游戏
    if (game.players.length === 2) {
      game.startGame();
      console.log(`游戏开始: ${game.roomId}`);
      
      broadcastToRoom(game, {
        type: 'game_started'
      });

      // 发送初始游戏状态
      sendGameStateToAll(game);
    }
  } else {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Game is full'
    }));
  }
}

function handleRejoinGame(ws, newPlayerId, roomId, oldPlayerId) {
  // 先检查重连池中是否有该房间
  const reconnectData = reconnectRooms.get(roomId);
  
  if (reconnectData) {
    const game = reconnectData.game;
    const playerIndex = reconnectData.disconnectedPlayerIndex;
    
    // 更新玩家连接
    game.players[playerIndex] = { id: newPlayerId, ws: ws };
    
    // 从重连池移除，放回活跃游戏池
    reconnectRooms.delete(roomId);
    games.set(roomId, game);
    
    console.log(`玩家 ${newPlayerId} 重新加入房间 ${roomId}，位置 ${playerIndex}`);
    
    // 通知重连成功
    ws.send(JSON.stringify({
      type: 'rejoin_success',
      roomId: roomId,
      playerIndex: playerIndex
    }));
    
    // 通知对手
    const otherPlayerIndex = 1 - playerIndex;
    const otherPlayer = game.players[otherPlayerIndex];
    if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
      otherPlayer.ws.send(JSON.stringify({
        type: 'opponent_reconnected',
        message: '对手已重新连接'
      }));
    }
    
    // 恢复游戏
    broadcastToRoom(game, {
      type: 'game_resumed'
    });
    
    sendGameStateToAll(game);
  } else {
    // 房间不存在或已过期
    ws.send(JSON.stringify({
      type: 'rejoin_failed',
      message: '房间不存在或已过期，请重新匹配'
    }));
  }
}

function handlePlayCard(playerId, cardId) {
  const game = findGameByPlayer(playerId);
  if (!game) {
    return;
  }

  const result = game.playCard(playerId, cardId);
  
  if (result.success) {
    // 广播游戏状态
    broadcastToRoom(game, {
      type: 'card_played',
      playerId: playerId,
      result: result
    });

    sendGameStateToAll(game);
  } else {
    const player = game.players.find(p => p.id === playerId);
    if (player) {
      player.ws.send(JSON.stringify({
        type: 'error',
        message: result.error
      }));
    }
  }
}

function handleSelectFieldCard(playerId, fieldCardId) {
  const game = findGameByPlayer(playerId);
  if (!game) {
    return;
  }

  const result = game.selectFieldCard(playerId, fieldCardId);
  
  if (result.success) {
    broadcastToRoom(game, {
      type: 'field_card_selected',
      playerId: playerId,
      result: result
    });

    sendGameStateToAll(game);
  }
}

function handleDrawFromDeck(playerId) {
  const game = findGameByPlayer(playerId);
  if (!game) {
    return;
  }

  const result = game.drawFromDeck(playerId);
  
  if (result.success) {
    broadcastToRoom(game, {
      type: 'deck_drawn',
      playerId: playerId,
      result: result
    });

    sendGameStateToAll(game);
    
    // 如果回合结束，通知所有玩家
    if (result.action === 'round_end') {
      broadcastToRoom(game, {
        type: 'round_end',
        result: result
      });
    }
  }
}

function handleSelectDeckFieldCard(playerId, fieldCardId, drawnCardId) {
  const game = findGameByPlayer(playerId);
  if (!game) {
    return;
  }

  const result = game.selectDeckFieldCard(playerId, fieldCardId, drawnCardId);
  
  if (result.success) {
    broadcastToRoom(game, {
      type: 'deck_field_card_selected',
      playerId: playerId,
      result: result
    });

    sendGameStateToAll(game);
    
    // 如果回合结束，通知所有玩家
    if (result.action === 'round_end') {
      broadcastToRoom(game, {
        type: 'round_end',
        result: result
      });
    }
  }
}

function handleKoikoiDecision(playerId, continueGame) {
  const game = findGameByPlayer(playerId);
  if (!game) {
    return;
  }

  const result = game.koikoiDecision(playerId, continueGame);
  
  if (result.success) {
    broadcastToRoom(game, {
      type: 'koikoi_decision',
      playerId: playerId,
      continueGame: continueGame,
      result: result
    });

    sendGameStateToAll(game);

    if (result.action === 'round_end') {
      // 回合结束，通知所有玩家显示结算界面
      broadcastToRoom(game, {
        type: 'round_end',
        result: result
      });
    }
  }
}

function handleStartNewRound(playerId) {
  const game = findGameByPlayer(playerId);
  if (!game) {
    return;
  }

  // 检查游戏是否处于回合结束或游戏结束状态
  if (game.gameState !== 'round_end' && game.gameState !== 'game_end') {
    const player = game.players.find(p => p.id === playerId);
    if (player) {
      player.ws.send(JSON.stringify({
        type: 'error',
        message: '游戏还未结束，无法开始新回合'
      }));
    }
    return;
  }

  // 如果游戏已经结束（有人达到100分），不允许继续
  if (game.gameState === 'game_end') {
    const player = game.players.find(p => p.id === playerId);
    if (player) {
      player.ws.send(JSON.stringify({
        type: 'error',
        message: '游戏已结束，已有玩家达到100分'
      }));
    }
    return;
  }

  const result = game.startNewRound();
  
  if (result.success) {
    console.log(`开始新回合: ${game.roomId}, 回合 ${result.roundNumber}, 先手玩家 ${result.firstPlayer}`);
    
    // 通知所有玩家新回合开始
    broadcastToRoom(game, {
      type: 'new_round_started',
      roundNumber: result.roundNumber,
      firstPlayerIndex: result.firstPlayer
    });

    // 发送新的游戏状态
    sendGameStateToAll(game);
  }
}

function handleDisconnect(playerId) {
  // 先检查活跃游戏池
  let game = findGameByPlayer(playerId);
  let fromReconnectPool = false;
  
  // 如果活跃池没找到，检查重连池
  if (!game) {
    for (const [roomId, data] of reconnectRooms.entries()) {
      if (data.game.players.some(p => p.id === playerId)) {
        game = data.game;
        fromReconnectPool = true;
        break;
      }
    }
  }
  
  if (game) {
    const playerIndex = game.getPlayerIndex(playerId);
    
    // 如果游戏还在等待阶段（还没开始），直接删除
    if (game.gameState === 'waiting') {
      games.delete(game.roomId);
      console.log(`删除等待中的房间: ${game.roomId}`);
      return;
    }
    
    // 检查房间是否已经在重连池中（说明另一个玩家已经断线）
    if (fromReconnectPool || reconnectRooms.has(game.roomId)) {
      // 两个玩家都断线了，直接删除房间
      reconnectRooms.delete(game.roomId);
      games.delete(game.roomId);
      console.log(`两个玩家都断线，删除房间: ${game.roomId}`);
      return;
    }
    
    // 只有一个玩家断线，将房间放入重连池
    console.log(`玩家 ${playerId} 断开连接，房间 ${game.roomId} 放入重连池`);
    
    // 从活跃游戏池移除
    games.delete(game.roomId);
    
    // 放入重连池
    reconnectRooms.set(game.roomId, {
      game: game,
      disconnectedPlayerIndex: playerIndex,
      timestamp: Date.now()
    });
    
    // 通知另一个玩家
    broadcastToRoom(game, {
      type: 'opponent_disconnected',
      message: '对手已断开连接，等待重连中...'
    }, playerId);
  }
}

function findGameByPlayer(playerId) {
  for (const game of games.values()) {
    if (game.players.some(p => p.id === playerId)) {
      return game;
    }
  }
  return null;
}

console.log('花札 Koi-Koi 服务器启动成功!');
