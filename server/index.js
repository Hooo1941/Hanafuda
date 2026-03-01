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
const privateRooms = new Map(); // 私密房间 code -> game（等待第二人加入）
const reconnectRooms = new Map(); // 等待重连的房间 roomId -> {game, disconnectedPlayerIndex, timestamp}
const RECONNECT_TIMEOUT = 5 * 60 * 1000; // 5分钟重连超时

// 生成唯一ID
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// 生成6位大写可读房间码
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return privateRooms.has(code) ? generateRoomCode() : code; // 碰撞重试
}

// 清理过期的重连房间
function cleanupExpiredReconnectRooms() {
  const now = Date.now();
  for (const [roomId, data] of reconnectRooms.entries()) {
    if (now - data.timestamp > RECONNECT_TIMEOUT) {
      console.log(`重连超时，删除房间: ${roomId}`);
      
      // 通知还在线的玩家：对手已超时，房间关闭
      const game = data.game;
      const disconnectedIndex = data.disconnectedPlayerIndex;
      const remainingIndex = 1 - disconnectedIndex;
      const remainingPlayer = game.players[remainingIndex];
      if (remainingPlayer && remainingPlayer.ws && remainingPlayer.ws.readyState === WebSocket.OPEN) {
        remainingPlayer.ws.send(JSON.stringify({
          type: 'room_closed',
          reason: 'opponent_timeout',
          message: '对手重连超时，游戏已结束'
        }));
      }
      
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

  // 心跳检测：标记连接存活
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

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

// WebSocket 心跳检测：每30秒 ping 所有连接，未响应的视为死连接并关闭
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('心跳超时，关闭死连接');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

function handleMessage(ws, playerId, message) {
  const { type, ...data } = message;

  switch (type) {
    case 'join_game':
      handleJoinGame(ws, playerId, data.gameRules);
      break;

    case 'create_room':
      handleCreateRoom(ws, playerId);
      break;

    case 'join_room':
      handleJoinRoom(ws, playerId, data.roomCode);
      break;

    case 'rejoin_game':
      handleRejoinGame(ws, playerId, data.roomId, data.oldPlayerId);
      break;

    case 'start_game':
      handleStartGame(playerId, data.gameRules);
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

function handleCreateRoom(ws, playerId) {
  const roomCode = generateRoomCode();
  const roomId = generateId();
  const game = new HanafudaGame(roomId, {});
  game.addPlayer(playerId, ws);
  game.isPrivate = true;
  game.roomCode = roomCode;
  privateRooms.set(roomCode, game);
  games.set(roomId, game);

  console.log(`私密房间创建: ${roomCode} (${roomId})`);

  ws.send(JSON.stringify({
    type: 'room_created',
    roomId: roomId,
    roomCode: roomCode,
    playerIndex: 0
  }));
}

function handleJoinRoom(ws, playerId, roomCode) {
  const code = (roomCode || '').toUpperCase().trim();
  const game = privateRooms.get(code);

  if (!game) {
    ws.send(JSON.stringify({ type: 'join_room_failed', message: '房间号不存在或已开始游戏' }));
    return;
  }
  if (game.players.length >= 2) {
    ws.send(JSON.stringify({ type: 'join_room_failed', message: '房间已满' }));
    return;
  }

  game.addPlayer(playerId, ws);
  privateRooms.delete(code); // 已满，移出私密等待池

  console.log(`玩家 ${playerId} 加入私密房间: ${code}`);

  ws.send(JSON.stringify({
    type: 'joined_game',
    roomId: game.roomId,
    playerIndex: 1,
    playersCount: 2
  }));

  // 通知房主对手已加入
  broadcastToRoom(game, { type: 'player_joined', playersCount: 2 }, playerId);

  // 双方到齐，进入规则设置
  game.players[0].ws.send(JSON.stringify({ type: 'setup_rules', isHost: true }));
  game.players[1].ws.send(JSON.stringify({ type: 'setup_rules', isHost: false }));
}

function handleJoinGame(ws, playerId, gameRules = {}) {
  // 只查找等待中的公开游戏（不匹配重连池，重连必须通过 rejoin_game）
  
  // 查找等待中的公开游戏或创建新游戏
  let game = Array.from(games.values()).find(g => g.gameState === 'waiting' && g.players.length < 2 && !g.isPrivate);

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

    // 如果两个玩家都准备好了，进入规则设置阶段
    if (game.players.length === 2) {
      console.log(`双方已到齐，等待房主设置规则: ${game.roomId}`);
      
      // 通知房主（playerIndex=0）可以设置规则
      game.players[0].ws.send(JSON.stringify({
        type: 'setup_rules',
        isHost: true
      }));
      
      // 通知访客（playerIndex=1）等待规则
      game.players[1].ws.send(JSON.stringify({
        type: 'setup_rules',
        isHost: false
      }));
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
    // 验证身份：只有原来的玩家才能重连
    const originalPlayerId = game.players[playerIndex].id;
    if (oldPlayerId !== originalPlayerId) {
      console.log(`重连被拒绝：期望 ${originalPlayerId}，实际 ${oldPlayerId}`);
      ws.send(JSON.stringify({
        type: 'rejoin_failed',
        message: '身份验证失败，无法重连到该房间'
      }));
      return;
    }
    
    // 验证通过，更新玩家连接
    game.players[playerIndex] = { id: newPlayerId, ws: ws };
    
    // 从重连池移除，放回活跃游戏池
    reconnectRooms.delete(roomId);
    games.set(roomId, game);
    
    console.log(`玩家 ${newPlayerId} 重新加入房间 ${roomId}，位置 ${playerIndex}`);
    
    // 通知重连成功
    ws.send(JSON.stringify({
      type: 'rejoin_success',
      roomId: roomId,
      playerIndex: playerIndex,
      gameRules: game.gameRules
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

function handleStartGame(playerId, gameRules = {}) {
  const game = findGameByPlayer(playerId);
  if (!game) return;
  
  // 只有房主（playerIndex=0）可以开始游戏
  const playerIdx = game.getPlayerIndex(playerId);
  if (playerIdx !== 0) {
    const player = game.players.find(p => p.id === playerId);
    if (player) {
      player.ws.send(JSON.stringify({ type: 'error', message: '只有房主可以设置规则' }));
    }
    return;
  }
  
  // 应用规则并开始
  game.applyRules(gameRules);
  game.startGame();
  console.log(`游戏开始: ${game.roomId}，规则:`, gameRules);
  
  // 把规则广播给双方，再开始
  broadcastToRoom(game, {
    type: 'game_started',
    gameRules: gameRules
  });
  
  sendGameStateToAll(game);
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
      // 通知房间内另一个玩家：对手已离开，房间关闭
      broadcastToRoom(game, {
        type: 'room_closed',
        reason: 'opponent_left',
        message: '对手已离开，房间已关闭'
      }, playerId);
      games.delete(game.roomId);
      // 同时清理私密房间池（如果还在的话）
      for (const [code, g] of privateRooms.entries()) {
        if (g === game) {
          privateRooms.delete(code);
          break;
        }
      }
      console.log(`等待阶段玩家断开，删除房间: ${game.roomId}`);
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
