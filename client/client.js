// WebSocket 连接
let ws = null;
let playerId = null;
let roomId = null;
let playerIndex = null;
let gameState = null;
let currentTurnPhase = null; // 当前回合阶段
let previousGameState = null; // 保存上一次的游戏状态，用于检测变化
let previousFieldCardIds = new Set(); // 保存上一次场牌的ID
let previousCaptureCardIds = { player: new Set(), opponent: new Set() }; // 保存上一次获得牌的ID
let reconnectAttempts = 0;
let maxReconnectAttempts = 3;
let reconnectTimeout = null;
let cardStyle = 'text'; // 'text', 'numbers', 'noNumbers'
let tooltipElement = null; // Tooltip元素
let pendingAction = null; // 连接后要执行的动作: {type: 'join'|'create'|'join_room', roomCode?}

// 类型图标和中文名称映射
const typeIcons = {
  'hikari': '✨',
  'tane': '🦋',
  'tanzaku': '🎀',
  'kasu': '🍃'
};

const typeNames = {
  'hikari': '光',
  'tane': '种',
  'tanzaku': '短',
  'kasu': '滓'
};

// 初始化
function init() {
  setupEventListeners();
  createTooltip();
  loadCardStyle();
  // 不立即连接，等用户点击"开始匹配"
}

// 连接 WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  ws = new WebSocket(`${protocol}//${host}`);

  ws.onopen = () => {
    updateStatus('已连接，正在匹配...', 'connected');
    // joinGame 在收到 connected 消息（含 playerId）后调用
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };

  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error);
    updateStatus('连接错误', 'error');
  };

  ws.onclose = () => {
    updateStatus('连接断开', 'disconnected');
    
    // 如果游戏已经开始，尝试重连
    if (roomId && gameState && gameState !== 'waiting') {
      attemptReconnect();
    }
  };
}

// 处理服务器消息
function handleMessage(message) {
  switch (message.type) {
    case 'connected':
      playerId = message.playerId;
      // 根据用户选择的入口执行对应动作
      if (pendingAction) {
        if (pendingAction.type === 'join') {
          // 先检查是否有未完成的游戏会话，有则尝试重连
          const savedRoomId = localStorage.getItem('hanafuda_roomId');
          const savedPlayerId = localStorage.getItem('hanafuda_playerId');
          if (savedRoomId && savedPlayerId) {
            console.log('发现未完成的游戏会话，尝试重连...');
            sendMessage({ type: 'rejoin_game', roomId: savedRoomId, oldPlayerId: savedPlayerId });
          } else {
            joinGame();
          }
        } else if (pendingAction.type === 'create') {
          sendMessage({ type: 'create_room' });
        } else if (pendingAction.type === 'join_room') {
          sendMessage({ type: 'join_room', roomCode: pendingAction.roomCode });
        }
        pendingAction = null;
      }
      break;

    case 'joined_game':
      roomId = message.roomId;
      playerIndex = message.playerIndex;
      
      // 保存到 localStorage 以便重连
      localStorage.setItem('hanafuda_roomId', roomId);
      localStorage.setItem('hanafuda_playerId', playerId);
      localStorage.setItem('hanafuda_playerIndex', playerIndex);
      
      if (message.reconnected) {
        updateStatus('重新连接成功！', 'playing');
        showGameScreen();
        if (message.gameRules) showRulesSummary(message.gameRules);
      } else {
        updateStatus(`等待对手... (${message.playersCount}/2)`, 'waiting');
        // 显示等待状态
        showWaitingPanel();
      }
      break;

    case 'player_joined':
      updateStatus(`对手已加入，等待规则设置... (${message.playersCount}/2)`, 'waiting');
      break;

    case 'room_created':
      roomId = message.roomId;
      playerIndex = message.playerIndex;
      localStorage.setItem('hanafuda_roomId', roomId);
      localStorage.setItem('hanafuda_playerId', playerId);
      localStorage.setItem('hanafuda_playerIndex', playerIndex);
      updateStatus('私密房间已创建，等待对手...', 'waiting');
      showWaitingPanel(message.roomCode);
      break;

    case 'join_room_failed':
      updateStatus('', '');
      // 关闭这次连接，回到主页
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
      showJoinRoomError(message.message);
      break;

    case 'setup_rules':
      // 双方到齐，进入规则设置阶段
      showRulesSetupPanel(message.isHost);
      if (message.isHost) {
        updateStatus('请设置游戏规则', 'waiting');
      } else {
        updateStatus('等待房主设置规则...', 'waiting');
      }
      break;

    case 'game_started':
      updateStatus('游戏开始！', 'playing');
      showGameScreen();
      // 重置卡牌追踪
      previousFieldCardIds = new Set();
      previousCaptureCardIds = { player: new Set(), opponent: new Set() };
      // 显示规则摘要
      if (message.gameRules) showRulesSummary(message.gameRules);
      break;

    case 'game_state':
      updateGameState(message.state);
      break;

    case 'card_played':
      // 先播放动画，再更新状态
      if (message.result.captured && message.result.captured.length > 0) {
        // 有卡牌被捕获，播放动画
        const isMyTurn = message.playerId === playerId;
        const pIdx = isMyTurn ? playerIndex : (1 - playerIndex);
        
        // 延迟更新游戏状态，让动画先播放
        setTimeout(() => {
          if (message.result.action === 'select_field_card') {
            // 只有出牌的玩家才需要选择场牌
            if (message.playerId === playerId) {
              showFieldCardSelection(message.result.matches, false);
            }
          }
        }, 100);
      } else {
        if (message.result.action === 'select_field_card') {
          // 只有出牌的玩家才需要选择场牌
          if (message.playerId === playerId) {
            showFieldCardSelection(message.result.matches, false);
          }
        }
      }
      break;

    case 'field_card_selected':
      hideFieldCardSelection();
      break;

    case 'deck_drawn':
      if (message.result.action === 'select_deck_field_card') {
        // 只有抽牌的玩家才需要选择场牌
        if (message.playerId === playerId) {
          showFieldCardSelection(message.result.matches, true);
        }
      } else if (message.result.action === 'round_end') {
        showRoundEndModal(message.result);
      } else if (message.result.action === 'koikoi_decision') {
      } else if (message.result.action === 'koikoi_decision') {
        // 检查是否配对了3张场牌
        if (message.result.captured && message.result.captured.length === 4) {
          const isMyTurn = message.playerId === playerId;
          const player = isMyTurn ? '你' : '对手';
          setTimeout(() => {
            alert(`🎉 ${player}抽牌配对了3张同月份的牌！全部获得！`);
          }, 500);
        }
      }
      break;

    case 'deck_field_card_selected':
      hideFieldCardSelection();
      if (message.result.action === 'round_end') {
        showRoundEndModal(message.result);
      }
      break;

    case 'koikoi_decision':
      if (message.result.action === 'continue_game') {
        // Only show notification to opponent, not the player who made the decision
        if (message.playerId !== playerId) {
          // 显示双方倍数变化
          const myMultiplier = message.result.opponentMultiplier; // 对于接收方来说，opponentMultiplier是自己的倍数
          const opponentMultiplier = message.result.multiplier;
          alert(`对手选择了こいこい！继续游戏\n对手倍数: ${opponentMultiplier}倍\n你的倍数: ${myMultiplier}倍`);
        }
      }
      break;
    
    case 'round_end':
      showRoundEndModal(message.result);
      break;
    
    case 'new_round_started':
      hideRoundEndModal();
      // 重置卡牌追踪
      previousFieldCardIds = new Set();
      previousCaptureCardIds = { player: new Set(), opponent: new Set() };
      const firstPlayer = message.firstPlayerIndex === playerIndex ? '你' : '对手';
      alert(`🌸 第 ${message.roundNumber} 回合开始！${firstPlayer}先手！`);
      break;

    case 'opponent_disconnected':
      updateStatus('对手断开连接，等待重连中...', 'waiting');
      showInfoMessage(message.message);
      break;
    
    case 'opponent_reconnected':
      updateStatus('游戏继续', 'playing');
      showInfoMessage(message.message);
      break;
    
    case 'game_resumed':
      updateStatus('游戏已恢复', 'playing');
      showGameScreen();
      // 重置重连尝试次数
      reconnectAttempts = 0;
      break;
    
    case 'rejoin_success':
      roomId = message.roomId;
      playerIndex = message.playerIndex;
      // 重连后 playerId 已变，更新 localStorage
      localStorage.setItem('hanafuda_roomId', roomId);
      localStorage.setItem('hanafuda_playerId', playerId);
      localStorage.setItem('hanafuda_playerIndex', playerIndex);
      updateStatus('重新连接成功！', 'playing');
      showGameScreen();
      if (message.gameRules) showRulesSummary(message.gameRules);
      reconnectAttempts = 0;
      break;
    
    case 'rejoin_failed':
      console.log('重连失败，回退到正常匹配');
      clearLocalStorage();
      // 重连失败，自动回退到正常匹配流程
      joinGame();
      break;

    case 'player_disconnected':
      alert(message.message);
      window.location.reload();
      break;

    case 'room_closed':
      alert(message.message || '房间已关闭');
      returnToHome();
      break;

    case 'error':
      alert('错误: ' + message.message);
      break;
  }
}

// 加入游戏
function joinGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'join_game' }));
  }
}

// 尝试重连
function attemptReconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    updateStatus('重连失败，请刷新页面重新匹配', 'error');
    clearLocalStorage();
    return;
  }
  
  reconnectAttempts++;
  updateStatus(`正在尝试重连 (${reconnectAttempts}/${maxReconnectAttempts})...`, 'connecting');
  
  // 延迟重连，避免频繁请求
  reconnectTimeout = setTimeout(() => {
    const savedRoomId = localStorage.getItem('hanafuda_roomId');
    const savedPlayerId = localStorage.getItem('hanafuda_playerId');
    
    if (savedRoomId && savedPlayerId) {
      console.log(`尝试重连到房间: ${savedRoomId}`);
      connectWebSocket();
      
      // 等待连接建立
      const checkConnection = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(checkConnection);
          // 发送重连请求
          ws.send(JSON.stringify({
            type: 'rejoin_game',
            roomId: savedRoomId,
            oldPlayerId: savedPlayerId
          }));
        }
      }, 100);
    } else {
      updateStatus('无法重连，缺少房间信息', 'error');
    }
  }, 2000 * reconnectAttempts); // 递增延迟
}

// 清除本地存储
function clearLocalStorage() {
  localStorage.removeItem('hanafuda_roomId');
  localStorage.removeItem('hanafuda_playerId');
  localStorage.removeItem('hanafuda_playerIndex');
}

// 显示信息提示
function showInfoMessage(message) {
  const infoPanel = document.getElementById('info-panel');
  if (infoPanel) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'info-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = 'background: #4CAF50; color: white; padding: 10px; margin: 10px 0; border-radius: 5px; text-align: center;';
    infoPanel.insertBefore(messageDiv, infoPanel.firstChild);
    
    // 3秒后自动消失
    setTimeout(() => {
      messageDiv.remove();
    }, 3000);
  }
}

// 发送消息
function sendMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// 更新状态栏
function updateStatus(text, status) {
  const statusText = document.getElementById('status-text');
  statusText.textContent = text;
  statusText.className = status;
}

// 显示游戏界面
function showGameScreen() {
  document.getElementById('waiting-room').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
}

// 显示等待室（匹配中）
function showWaitingRoom() {
  document.getElementById('waiting-room').style.display = 'block';
  document.getElementById('game-screen').style.display = 'none';
}

// 返回主页（重置所有状态）
function returnToHome() {
  // 关闭现有连接
  if (ws) {
    ws.onclose = null; // 防止触发重连
    ws.close();
    ws = null;
  }
  
  // 清除重连定时器
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  // 重置所有状态变量
  playerId = null;
  roomId = null;
  playerIndex = null;
  gameState = null;
  currentTurnPhase = null;
  previousGameState = null;
  previousFieldCardIds = new Set();
  previousCaptureCardIds = { player: new Set(), opponent: new Set() };
  reconnectAttempts = 0;
  pendingAction = null;
  
  // 清除 localStorage
  clearLocalStorage();
  
  // 切换界面：显示等待室的 pre-match 面板
  document.getElementById('game-screen').style.display = 'none';
  document.getElementById('waiting-room').style.display = 'block';
  document.getElementById('pre-match-panel').style.display = 'block';
  document.getElementById('waiting-panel').style.display = 'none';
  document.getElementById('rules-setup-panel').style.display = 'none';
  
  // 隐藏所有弹窗
  hideFieldCardSelection();
  const koikoiModal = document.getElementById('koikoi-modal');
  if (koikoiModal) koikoiModal.style.display = 'none';
  const roundEndModal = document.getElementById('round-end-modal');
  if (roundEndModal) roundEndModal.style.display = 'none';
  
  updateStatus('未连接', 'disconnected');
}

// 进入等待对手状态（隐藏开始按钮，显示spinner）
function showWaitingPanel(roomCode) {
  document.getElementById('pre-match-panel').style.display = 'none';
  document.getElementById('waiting-panel').style.display = 'block';
  document.getElementById('rules-setup-panel').style.display = 'none';

  const codeDisplay = document.getElementById('room-code-display');
  if (roomCode) {
    document.getElementById('room-code-value').textContent = roomCode;
    codeDisplay.style.display = 'block';
  } else {
    codeDisplay.style.display = 'none';
  }
}

// 显示加入房间失败提示
function showJoinRoomError(msg) {
  const input = document.getElementById('join-room-input');
  const existing = document.getElementById('join-room-error');
  if (existing) existing.remove();
  const err = document.createElement('div');
  err.id = 'join-room-error';
  err.className = 'join-room-error';
  err.textContent = msg || '加入失败';
  input.parentElement.appendChild(err);
  setTimeout(() => err.remove(), 3000);
}

// 进入规则设置阶段
function showRulesSetupPanel(isHost) {
  document.getElementById('pre-match-panel').style.display = 'none';
  document.getElementById('waiting-panel').style.display = 'none';
  document.getElementById('rules-setup-panel').style.display = 'block';

  // 规则控件：房主可编辑，访客只读
  const inputs = document.querySelectorAll('#rules-setup-panel input, #rules-setup-panel select');
  inputs.forEach(el => { el.disabled = !isHost; });

  document.getElementById('confirm-rules-btn').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-waiting-rules').style.display = isHost ? 'none' : 'block';
  document.getElementById('rules-panel-title').textContent = isHost ? '游戏规则设置（你是房主）' : '游戏规则（房主设置中）';
}

// 在游戏界面右侧面板显示本局规则摘要
function showRulesSummary(gameRules) {
  const firstPlayerText = { rotate: '轮换', winner: '赢家先手', loser: '输家先手' };
  const koikoiText = { self: '自己+1', opponent: '对方+1', none: '不加倍' };

  document.getElementById('rules-summary-content').innerHTML = `
    <div>花见/月见酒：${gameRules.enableHanamiTsukimi ? '启用' : '禁用'}</div>
    <div>先手规则：${firstPlayerText[gameRules.firstPlayerRule] || gameRules.firstPlayerRule}</div>
    <div>Koi-Koi倍数：${koikoiText[gameRules.koikoiMultiplierRule] || gameRules.koikoiMultiplierRule}</div>
  `;
  document.getElementById('rules-summary').style.display = 'block';
}

function updateGameState(state) {
  gameState = state;
  currentTurnPhase = state.turnPhase;
  
  // 更新分数 - 使用 roundScores 和 totalScores
  document.getElementById('player-round-score').textContent = state.roundScores[state.playerIndex];
  document.getElementById('player-total-score').textContent = state.totalScores[state.playerIndex];
  document.getElementById('opponent-round-score').textContent = state.roundScores[1 - state.playerIndex];
  document.getElementById('opponent-total-score').textContent = state.totalScores[1 - state.playerIndex];
  
  // 更新倍数
  document.getElementById('player-multiplier').textContent = state.multipliers[state.playerIndex];
  document.getElementById('opponent-multiplier').textContent = state.multipliers[1 - state.playerIndex];
  
  // 更新操作历史
  if (state.actionHistory) {
    updateActionHistory(state.actionHistory);
  }
  
  // 更新对手手牌数量
  document.getElementById('opponent-hand-count').textContent = state.opponentHandCount;
  
  // 更新牌堆数量
  document.getElementById('deck-count').textContent = state.deckCount;
  
  // 更新回合指示器
  updateTurnIndicator(state);
  
  // 渲染手牌
  const canPlayCard = state.currentPlayerIndex === state.playerIndex && state.turnPhase === 'play_hand';
  renderHand(state.hand, canPlayCard);
  
  // 渲染场牌
  renderField(state.field);
  
  // 渲染获得牌（按类型分类）
  renderCapturesByType('player', state.captures);
  renderCapturesByType('opponent', state.opponentCaptures);
  
  // 显示当前役种
  if (state.currentYakus && state.currentYakus.length >= 2) {
    displayCurrentYakus('player', state.currentYakus[state.playerIndex]);
    displayCurrentYakus('opponent', state.currentYakus[1 - state.playerIndex]);
  } else {
    displayCurrentYakus('player', []);
    displayCurrentYakus('opponent', []);
  }
  
  // 处理需要选择场牌的情况（包括重连恢复）
  if (state.currentPlayerIndex === state.playerIndex) {
    const modal = document.getElementById('select-field-modal');
    const modalVisible = modal && modal.style.display === 'flex';
    if (state.turnPhase === 'select_hand_field' && state.matchedFieldCards && state.matchedFieldCards.length > 0 && !modalVisible) {
      showFieldCardSelection(state.matchedFieldCards, false);
    } else if (state.turnPhase === 'select_deck_field' && state.matchedFieldCards && state.matchedFieldCards.length > 0 && !modalVisible) {
      showFieldCardSelection(state.matchedFieldCards, true);
    }
  }
  
  // 处理Koi-Koi决策
  if (state.koikoiState.canKoikoi && state.koikoiState.player === state.playerIndex) {
    if (state.koikoiState.yakus && state.koikoiState.yakus.length > 0) {
      showKoikoiModal(state.koikoiState.yakus, state.multipliers[state.playerIndex]);
    }
  }
}

// 更新回合指示器
function updateTurnIndicator(state) {
  const turnIndicator = document.getElementById('turn-indicator');
  
  if (!turnIndicator) {
    return;
  }
  
  if (state.currentPlayerIndex === state.playerIndex) {
    if (state.turnPhase === 'play_hand') {
      turnIndicator.textContent = '你的回合 - 请出牌';
      turnIndicator.className = 'turn-indicator my-turn';
    } else if (state.turnPhase === 'select_hand_field') {
      turnIndicator.textContent = '请选择要配对的场牌';
      turnIndicator.className = 'turn-indicator my-turn';
    } else if (state.turnPhase === 'draw_deck') {
      turnIndicator.textContent = '你的回合 - 点击抽牌';
      turnIndicator.className = 'turn-indicator my-turn';
      // 自动抽牌
      setTimeout(() => {
        sendMessage({ type: 'draw_from_deck' });
      }, 800);
    } else if (state.turnPhase === 'select_deck_field') {
      turnIndicator.textContent = '请选择要配对的场牌';
      turnIndicator.className = 'turn-indicator my-turn';
    } else if (state.turnPhase === 'koikoi_decision') {
      turnIndicator.textContent = '请做出Koi-Koi决策';
      turnIndicator.className = 'turn-indicator my-turn';
    }
  } else {
    turnIndicator.textContent = '对手的回合';
    turnIndicator.className = 'turn-indicator opponent-turn';
  }
}

// 显示当前役种
function displayCurrentYakus(player, yakus) {
  const displayId = player === 'player' ? 'player-yaku-display' : 'opponent-yaku-display';
  const container = document.getElementById(displayId);
  
  if (!container) {
    return;
  }
  
  container.innerHTML = '';
  
  if (yakus && yakus.length > 0) {
    container.classList.add('has-yaku');
    yakus.forEach(yaku => {
      const item = document.createElement('span');
      item.className = 'yaku-display-item';
      item.textContent = `${yaku.name} ${yaku.points}点`;
      container.appendChild(item);
    });
  } else {
    container.classList.remove('has-yaku');
  }
}

// 渲染手牌
function renderHand(hand, canPlay) {
  const container = document.getElementById('hand-cards');
  
  if (!container) {
    return;
  }
  
  container.innerHTML = '';
  
  hand.forEach(card => {
    const cardElement = createCardElement(card, false);
    // 只有在能出牌且确实是play_hand阶段时才允许点击
    if (canPlay && currentTurnPhase === 'play_hand') {
      cardElement.addEventListener('click', () => playCard(card.id));
      cardElement.style.cursor = 'pointer';
    } else {
      cardElement.classList.add('disabled');
      cardElement.style.cursor = 'not-allowed';
    }
    container.appendChild(cardElement);
  });
}

// 渲染场牌
function renderField(field) {
  const container = document.getElementById('field-cards');
  
  if (!container) {
    return;
  }
  
  // 获取当前场牌的ID集合
  const currentFieldCardIds = new Set(field.map(c => c.id));
  
  container.innerHTML = '';
  
  field.forEach((card) => {
    const cardElement = createCardElement(card, false);
    cardElement.classList.add('disabled');
    
    // 如果这张牌的ID不在之前的场牌列表中，说明是新加入的
    if (!previousFieldCardIds.has(card.id)) {
      cardElement.classList.add('newly-added');
      setTimeout(() => {
        cardElement.classList.remove('newly-added');
      }, 500);
    }
    
    container.appendChild(cardElement);
  });
  
  // 更新保存的场牌ID列表
  previousFieldCardIds = currentFieldCardIds;
}

// 按类型渲染获得牌
function renderCapturesByType(player, captures) {
  const types = ['hikari', 'tane', 'tanzaku', 'kasu'];
  
  // 初始化该玩家的卡牌ID集合（如果不存在）
  if (!previousCaptureCardIds[player]) {
    previousCaptureCardIds[player] = new Set();
  }
  
  // 获取当前所有获得牌的ID
  const currentCaptureIds = new Set(captures.map(c => c.id));
  
  types.forEach(type => {
    const cardsOfType = captures.filter(c => c.type === type);
    const containerId = `${player}-captures-${type}`;
    const countId = `${player}-${type}-count`;
    const container = document.getElementById(containerId);
    const countElement = document.getElementById(countId);
    
    if (container && countElement) {
      container.innerHTML = '';
      countElement.textContent = cardsOfType.length;
      
      cardsOfType.forEach((card) => {
        const cardElement = createCardElement(card, true, true); // 第三个参数表示是获得牌
        cardElement.classList.add('disabled');
        
        // 如果这张牌的ID不在之前的获得牌列表中，说明是新获得的
        if (!previousCaptureCardIds[player].has(card.id)) {
          cardElement.classList.add('newly-added');
          // 500ms后移除动画类
          setTimeout(() => {
            cardElement.classList.remove('newly-added');
          }, 500);
        }
        
        container.appendChild(cardElement);
      });
    }
  });
  
  // 更新保存的获得牌ID列表
  previousCaptureCardIds[player] = currentCaptureIds;
}

// 创建牌元素
function createCardElement(card, small = false, isCaptured = false) {
  const div = document.createElement('div');
  div.className = `card ${card.type}`;
  div.dataset.month = card.month;
  div.dataset.type = card.type;
  
  if (small) {
    div.className += ' small';
  }
  
  // 根据当前样式渲染
  if (cardStyle === 'text') {
    // 文字模式
    // 为赤短和青短添加特殊样式类
    if (card.type === 'tanzaku' && card.subtype) {
      if (card.subtype === 'aka') {
        div.classList.add('tanzaku-aka');
      } else if (card.subtype === 'ao') {
        div.classList.add('tanzaku-ao');
      }
    }
    
    const typeBadge = document.createElement('div');
    typeBadge.className = 'card-type-badge';
    typeBadge.textContent = card.typeName || typeNames[card.type];
    
    // 为赤短和青短添加特殊标识
    if (card.type === 'tanzaku' && card.subtype) {
      const subtypeBadge = document.createElement('div');
      subtypeBadge.className = 'card-subtype-badge';
      if (card.subtype === 'aka') {
        subtypeBadge.textContent = '赤';
        subtypeBadge.classList.add('aka-badge');
      } else if (card.subtype === 'ao') {
        subtypeBadge.textContent = '青';
        subtypeBadge.classList.add('ao-badge');
      }
      div.appendChild(subtypeBadge);
    }
    
    const monthDiv = document.createElement('div');
    monthDiv.className = 'card-month';
    monthDiv.textContent = `${card.month}月`;
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'card-name';
    nameDiv.textContent = card.name;

    // 只有非获得牌才显示右上角的类型标识
    if (!isCaptured) {
      div.appendChild(typeBadge);
    }
    div.appendChild(monthDiv);
    div.appendChild(nameDiv);
  } else {
    // 图片模式
    div.classList.add('image-style');
    
    const img = document.createElement('img');
    const filename = getCardImageFilename(card);
    const folder = cardStyle; // 'numbers' or 'noNumbers'
    img.src = `cards/${folder}/${filename}.svg`;
    img.alt = `${card.month}月 ${card.name}`;
    img.onerror = () => {
      console.error(`Failed to load image: cards/${folder}/${filename}.svg`);
      img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="%23ddd"/><text x="50" y="75" text-anchor="middle" font-size="12">图片加载失败</text></svg>';
    };
    
    div.appendChild(img);
    
    // 添加tooltip事件
    div.addEventListener('mouseenter', (e) => {
      showTooltip(card, div);
    });
    
    div.addEventListener('mouseleave', () => {
      hideTooltip();
    });
  }
  
  return div;
}

// 玩家出牌
function playCard(cardId) {
  if (currentTurnPhase !== 'play_hand') {
    return;
  }
  
  sendMessage({
    type: 'play_card',
    cardId: cardId
  });
}

// 显示场牌选择对话框
function showFieldCardSelection(matches, isFromDeck = false) {
  const modal = document.getElementById('select-field-modal');
  const optionsContainer = document.getElementById('field-card-options');
  optionsContainer.innerHTML = '';
  
  matches.forEach(card => {
    const cardElement = createCardElement(card, false);
    cardElement.addEventListener('click', () => {
      if (isFromDeck) {
        selectDeckFieldCard(card.id);
      } else {
        selectFieldCard(card.id);
      }
      hideFieldCardSelection();
    });
    optionsContainer.appendChild(cardElement);
  });
  
  modal.style.display = 'flex';
}

// 隐藏场牌选择对话框
function hideFieldCardSelection() {
  const modal = document.getElementById('select-field-modal');
  modal.style.display = 'none';
}

// 选择场牌（手牌阶段）
function selectFieldCard(fieldCardId) {
  sendMessage({
    type: 'select_field_card',
    fieldCardId: fieldCardId
  });
}

// 选择场牌（抽牌阶段）
function selectDeckFieldCard(fieldCardId) {
  sendMessage({
    type: 'select_deck_field_card',
    fieldCardId: fieldCardId
  });
}

// 显示 Koi-Koi 决策对话框
function showKoikoiModal(yakus, multiplier) {
  const modal = document.getElementById('koikoi-modal');
  const yakuList = document.getElementById('yaku-list');
  const multiplierSpan = document.getElementById('koikoi-multiplier');
  const pointsSpan = document.getElementById('koikoi-points');
  
  yakuList.innerHTML = '';
  let totalPoints = 0;
  
  yakus.forEach(yaku => {
    const item = document.createElement('div');
    item.className = 'yaku-item';
    item.innerHTML = `
      <span class="yaku-name">${yaku.name}</span>
      <span class="yaku-points">${yaku.points}点</span>
    `;
    yakuList.appendChild(item);
    totalPoints += yaku.points;
  });
  
  multiplierSpan.textContent = multiplier;
  pointsSpan.textContent = totalPoints * multiplier;
  modal.style.display = 'flex';
}

// 显示回合结束对话框
function showRoundEndModal(result) {
  const modal = document.getElementById('round-end-modal');
  
  // 确定胜者
  const playerPoints = result.points[playerIndex];
  const opponentPoints = result.points[1 - playerIndex];
  const winnerAnnouncement = document.getElementById('winner-announcement');
  
  // 检查是否是游戏结束（有人达到100分）
  const isGameEnd = result.isGameEnd || false;
  
  if (isGameEnd) {
    // 游戏结束
    if (result.winner === playerIndex) {
      winnerAnnouncement.textContent = '🎊 恭喜！你赢得了最终胜利！🎊';
      winnerAnnouncement.className = 'winner-announcement winner';
    } else if (result.winner === (1 - playerIndex)) {
      winnerAnnouncement.textContent = '😢 游戏结束，对手获胜！';
      winnerAnnouncement.className = 'winner-announcement loser';
    } else {
      winnerAnnouncement.textContent = '🤝 游戏结束，双方平局！';
      winnerAnnouncement.className = 'winner-announcement tie';
    }
  } else {
    // 仅回合结束
    if (playerPoints > opponentPoints) {
      winnerAnnouncement.textContent = '🎉 你赢了本回合！🎉';
      winnerAnnouncement.className = 'winner-announcement winner';
    } else if (playerPoints < opponentPoints) {
      winnerAnnouncement.textContent = '😢 对手赢了本回合！';
      winnerAnnouncement.className = 'winner-announcement loser';
    } else {
      winnerAnnouncement.textContent = '🤝 本回合平局！';
      winnerAnnouncement.className = 'winner-announcement tie';
    }
  }
  
  // 显示回合数
  document.getElementById('modal-round-number').textContent = result.roundNumber || 1;
  
  // 玩家役种
  const playerYakusContainer = document.getElementById('player-yakus');
  playerYakusContainer.innerHTML = '';
  result.yakus[playerIndex].forEach(yaku => {
    const item = document.createElement('div');
    item.className = 'yaku-item';
    item.innerHTML = `
      <span class="yaku-name">${yaku.name}</span>
      <span class="yaku-points">${yaku.points}点</span>
    `;
    playerYakusContainer.appendChild(item);
  });
  if (result.yakus[playerIndex].length === 0) {
    playerYakusContainer.innerHTML = '<p>无役</p>';
  }
  
  // 对手役种
  const opponentYakusContainer = document.getElementById('opponent-yakus');
  opponentYakusContainer.innerHTML = '';
  result.yakus[1 - playerIndex].forEach(yaku => {
    const item = document.createElement('div');
    item.className = 'yaku-item';
    item.innerHTML = `
      <span class="yaku-name">${yaku.name}</span>
      <span class="yaku-points">${yaku.points}点</span>
    `;
    opponentYakusContainer.appendChild(item);
  });
  if (result.yakus[1 - playerIndex].length === 0) {
    opponentYakusContainer.innerHTML = '<p>无役</p>';
  }
  
  // 倍数
  document.getElementById('player-round-multiplier').textContent = result.multipliers[playerIndex];
  document.getElementById('opponent-round-multiplier').textContent = result.multipliers[1 - playerIndex];
  
  // 本回合得分
  document.getElementById('player-round-points').textContent = playerPoints;
  document.getElementById('opponent-round-points').textContent = opponentPoints;
  
  // 总分
  document.getElementById('modal-player-total-score').textContent = result.totalScores[playerIndex];
  document.getElementById('modal-opponent-total-score').textContent = result.totalScores[1 - playerIndex];
  
  // 修改按钮文字
  const playAgainBtn = document.getElementById('play-again-btn');
  if (isGameEnd) {
    playAgainBtn.textContent = '🎊 游戏已结束 🎊';
    playAgainBtn.disabled = true;
    playAgainBtn.style.opacity = '0.5';
    playAgainBtn.style.cursor = 'not-allowed';
  } else {
    playAgainBtn.textContent = '🌸 再来一局 🌸';
    playAgainBtn.disabled = false;
    playAgainBtn.style.opacity = '1';
    playAgainBtn.style.cursor = 'pointer';
  }
  
  modal.style.display = 'flex';
}

// 隐藏回合结束对话框
function hideRoundEndModal() {
  const modal = document.getElementById('round-end-modal');
  modal.style.display = 'none';
}

// 设置事件监听器
function setupEventListeners() {
  // 开始匹配按钮
  document.getElementById('start-matchmaking-btn').addEventListener('click', () => {
    updateStatus('连接中...', 'connecting');
    showWaitingPanel();
    document.getElementById('waiting-message').textContent = '正在匹配...';
    pendingAction = { type: 'join' };
    connectWebSocket();
  });

  // 创建私密房间按钮
  document.getElementById('create-room-btn').addEventListener('click', () => {
    updateStatus('连接中...', 'connecting');
    showWaitingPanel();
    document.getElementById('waiting-message').textContent = '正在创建房间...';
    pendingAction = { type: 'create' };
    connectWebSocket();
  });

  // 加入私密房间按钮
  document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('join-room-input').value.trim().toUpperCase();
    if (!code) {
      showJoinRoomError('请输入房间号');
      return;
    }
    updateStatus('连接中...', 'connecting');
    // 不提前切换界面，等服务器确认后再切
    pendingAction = { type: 'join_room', roomCode: code };
    connectWebSocket();
  });

  // 房间号输入框回车
  document.getElementById('join-room-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-room-btn').click();
  });

  // 房主确认规则按钮
  document.getElementById('confirm-rules-btn').addEventListener('click', () => {
    const gameRules = {
      enableHanamiTsukimi: document.getElementById('rule-hanami-tsukimi').checked,
      firstPlayerRule: document.getElementById('rule-first-player').value,
      koikoiMultiplierRule: document.getElementById('rule-koikoi-multiplier').value
    };
    sendMessage({ type: 'start_game', gameRules });
    document.getElementById('confirm-rules-btn').disabled = true;
    document.getElementById('confirm-rules-btn').textContent = '等待游戏开始...';
  });
  
  // Koi-Koi 继续按钮
  document.getElementById('koikoi-continue').addEventListener('click', () => {
    sendMessage({
      type: 'koikoi_decision',
      continueGame: true
    });
    document.getElementById('koikoi-modal').style.display = 'none';
  });
  
  // Koi-Koi 结束按钮
  document.getElementById('koikoi-end').addEventListener('click', () => {
    sendMessage({
      type: 'koikoi_decision',
      continueGame: false
    });
    document.getElementById('koikoi-modal').style.display = 'none';
  });
  
  // 再来一局按钮
  document.getElementById('play-again-btn').addEventListener('click', () => {
    sendMessage({
      type: 'start_new_round'
    });
  });
  
  // 牌面样式切换按钮
  document.querySelectorAll('.style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.style;
      switchCardStyle(style);
    });
  });
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', init);

// 更新操作历史
function updateActionHistory(history) {
  // 直接渲染合并的历史记录
  renderMergedHistory(history);
}

// 渲染合并的历史记录
function renderMergedHistory(history) {
  const container = document.getElementById('merged-history');
  const listElement = container.querySelector('.history-list');
  
  if (!listElement) return;
  
  listElement.innerHTML = '';
  
  if (history.length === 0) {
    listElement.innerHTML = '<div style="color: #999; font-size: 0.85em; text-align: center; padding: 10px;">暂无记录</div>';
    return;
  }
  
  // 按时间戳排序，最新的在最前面
  const sortedHistory = [...history].sort((a, b) => b.timestamp - a.timestamp);
  
  sortedHistory.forEach(item => {
    const historyItem = document.createElement('div');
    const isPlayer = item.playerIndex === playerIndex;
    historyItem.className = `history-item ${isPlayer ? 'player' : 'opponent'}`;
    
    const playerLabel = isPlayer ? '你' : '对手';
    let content = '';
    
    switch (item.type) {
      case 'played':
        const playedCard = item.card ? `${item.card.month}月-${item.card.name}` : '未知牌';
        content = `<div class="history-item-action">${playerLabel} 出牌: ${playedCard}</div>`;
        if (item.matchedCard) {
          content += `<div class="history-item-cards">配对: ${item.matchedCard.month}月-${item.matchedCard.name}</div>`;
        }
        break;
      case 'drawn':
        const drawnCard = item.card ? `${item.card.month}月-${item.card.name}` : '未知牌';
        content = `<div class="history-item-action">${playerLabel} 抽牌: ${drawnCard}</div>`;
        if (item.matchedCard) {
          content += `<div class="history-item-cards">配对: ${item.matchedCard.month}月-${item.matchedCard.name}</div>`;
        }
        break;
      case 'captured':
        if (item.cards && item.cards.length > 0) {
          const cardNames = item.cards.map(c => `${c.month}月-${c.name}`).join(', ');
          content = `<div class="history-item-action">${playerLabel} 获得牌</div>`;
          content += `<div class="history-item-cards">${cardNames}</div>`;
        }
        break;
      case 'koikoi':
        content = `<div class="history-item-action">${playerLabel} 喊了こいこい！</div>`;
        content += `<div class="history-item-cards">倍数变为 ${item.multiplier}×</div>`;
        break;
      default:
        content = `<div class="history-item-action">${playerLabel}: ${item.action || '未知操作'}</div>`;
    }
    
    historyItem.innerHTML = content;
    listElement.appendChild(historyItem);
  });
}

// ==================== 卡牌动画系统 ====================

// 获取元素在页面上的绝对位置
function getAbsolutePosition(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height
  };
}

// 创建动画卡牌
function createAnimationCard(cardData, startPos) {
  const animLayer = document.getElementById('card-animation-layer');
  const cardElement = createCardElement(cardData, false);
  
  cardElement.style.position = 'absolute';
  cardElement.style.left = startPos.x - startPos.width / 2 + 'px';
  cardElement.style.top = startPos.y - startPos.height / 2 + 'px';
  cardElement.style.width = startPos.width + 'px';
  cardElement.style.height = startPos.height + 'px';
  cardElement.classList.add('card-animation');
  
  animLayer.appendChild(cardElement);
  return cardElement;
}

// 动画移动卡牌
function animateCard(cardData, fromElement, toElement, onComplete) {
  if (!fromElement || !toElement) {
    if (onComplete) onComplete();
    return;
  }
  
  const startPos = getAbsolutePosition(fromElement);
  const endPos = getAbsolutePosition(toElement);
  
  const animCard = createAnimationCard(cardData, startPos);
  
  // 强制重排以确保初始样式生效
  animCard.offsetHeight;
  
  // 开始动画
  animCard.classList.add('flying');
  animCard.style.left = endPos.x - endPos.width / 2 + 'px';
  animCard.style.top = endPos.y - endPos.height / 2 + 'px';
  animCard.style.width = endPos.width + 'px';
  animCard.style.height = endPos.height + 'px';
  
  // 动画结束后清理
  setTimeout(() => {
    animCard.remove();
    if (onComplete) onComplete();
  }, 600);
}

// 批量动画移动多张卡牌
function animateCards(cards, fromElement, toElement, onComplete) {
  if (!cards || cards.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  
  let completed = 0;
  const onSingleComplete = () => {
    completed++;
    if (completed === cards.length && onComplete) {
      onComplete();
    }
  };
  
  cards.forEach((card, index) => {
    setTimeout(() => {
      animateCard(card, fromElement, toElement, onSingleComplete);
    }, index * 100); // 每张卡牌延迟100ms
  });
}

// 从手牌动画到获取区
function animateHandCardToCapture(cardData, playerIdx) {
  const handElement = document.querySelector('.hand-cards');
  const captureType = cardData.type;
  const captureElement = playerIdx === playerIndex 
    ? document.getElementById(`player-captures-${captureType}`)
    : document.getElementById(`opponent-captures-${captureType}`);
  
  animateCard(cardData, handElement, captureElement);
}

// 从场上牌动画到获取区
function animateFieldCardToCapture(cardData, playerIdx) {
  const fieldCard = Array.from(document.querySelectorAll('.field-cards .card'))
    .find(el => {
      const month = parseInt(el.dataset.month);
      return month === cardData.month;
    });
  
  const captureType = cardData.type;
  const captureElement = playerIdx === playerIndex 
    ? document.getElementById(`player-captures-${captureType}`)
    : document.getElementById(`opponent-captures-${captureType}`);
  
  if (fieldCard && captureElement) {
    animateCard(cardData, fieldCard, captureElement);
  }
}

// 从牌堆动画到场上
function animateDeckCardToField(cardData) {
  const deckElement = document.querySelector('.deck-area');
  const fieldElement = document.querySelector('.field-cards');
  
  animateCard(cardData, deckElement, fieldElement);
}

// 从牌堆动画到获取区
function animateDeckCardToCapture(cardData, playerIdx) {
  const deckElement = document.querySelector('.deck-area');
  const captureType = cardData.type;
  const captureElement = playerIdx === playerIndex 
    ? document.getElementById(`player-captures-${captureType}`)
    : document.getElementById(`opponent-captures-${captureType}`);
  
  animateCard(cardData, deckElement, captureElement);
}

// ========== 牌面样式切换功能 ==========

// 创建tooltip元素
function createTooltip() {
  tooltipElement = document.createElement('div');
  tooltipElement.className = 'card-tooltip';
  document.body.appendChild(tooltipElement);
}

// 从localStorage加载牌面样式
function loadCardStyle() {
  const saved = localStorage.getItem('hanafuda_cardStyle');
  if (saved && ['text', 'numbers', 'noNumbers'].includes(saved)) {
    cardStyle = saved;
  }
  updateStyleButtons();
}

// 保存牌面样式到localStorage
function saveCardStyle() {
  localStorage.setItem('hanafuda_cardStyle', cardStyle);
}

// 切换牌面样式
function switchCardStyle(style) {
  if (!['text', 'numbers', 'noNumbers'].includes(style)) {
    console.error('Invalid card style:', style);
    return;
  }
  
  cardStyle = style;
  saveCardStyle();
  updateStyleButtons();
  
  // 重新渲染所有牌面
  if (gameState) {
    renderHand(gameState.hand, gameState.currentPlayerIndex === playerIndex && currentTurnPhase === 'play_hand');
    renderField(gameState.field);
    renderCapturesByType('player', gameState.captures);
    renderCapturesByType('opponent', gameState.opponentCaptures);
  }
}

// 更新按钮激活状态
function updateStyleButtons() {
  document.querySelectorAll('.style-btn').forEach(btn => {
    if (btn.dataset.style === cardStyle) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// 获取牌的图片文件名
function getCardImageFilename(card) {
  // 每个月份有4张牌，按实际顺序编号0-3
  // 文件名格式：月份+索引，如10、11、12、13（1月的4张牌）
  
  const month = card.month;
  const type = card.type;
  const name = card.name;
  
  // 每个月份的牌序号映射（根据实际牌的类型）
  const monthCardMappings = {
    1: { hikari: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },  // 光、短、滓、滓
    2: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },    // 种、短、滓、滓
    3: { hikari: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },  // 光、短、滓、滓
    4: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },    // 种、短、滓、滓
    5: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },    // 种、短、滓、滓
    6: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },    // 种、短、滓、滓
    7: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },    // 种、短、滓、滓
    8: { hikari: 0, tane: 1, kasu1: 2, kasu2: 3 },     // 光、种、滓、滓
    9: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },    // 种、短、滓、滓
    10: { tane: 0, tanzaku: 1, kasu1: 2, kasu2: 3 },   // 种、短、滓、滓
    11: { hikari: 0, tane: 1, tanzaku: 2, kasu: 3 },   // 光、种、短、滓（只有1张滓）
    12: { hikari: 0, kasu1: 1, kasu2: 2, kasu3: 3 }    // 光、滓、滓、滓
  };
  
  const mapping = monthCardMappings[month];
  let index;
  
  if (type === 'kasu') {
    // 处理滓牌
    if (month === 11) {
      // 11月只有1张滓
      index = mapping.kasu;
    } else if (month === 12) {
      // 12月有3张滓
      if (name === '桐滓1') index = mapping.kasu1;
      else if (name === '桐滓2') index = mapping.kasu2;
      else if (name === '桐滓3') index = mapping.kasu3;
    } else {
      // 其他月份有2张滓
      if (name.includes('2')) {
        index = mapping.kasu2;
      } else {
        index = mapping.kasu1;
      }
    }
  } else {
    // 光、种、短牌直接查找
    index = mapping[type];
  }
  
  return `${month}${index}`;
}

// 显示tooltip
function showTooltip(card, element) {
  if (cardStyle === 'text') return; // 文字模式不需要tooltip
  
  const monthNames = ['', '松', '梅', '樱', '藤', '菖蒲', '牡丹', '萩', '芒', '菊', '枫', '柳', '桐'];
  const tooltipContent = `
    <span class="tooltip-month">${card.month}月 (${monthNames[card.month]})</span>
    <span class="tooltip-type">${card.typeName || typeNames[card.type]}</span>
    <span class="tooltip-name">${card.name}</span>
  `;
  
  tooltipElement.innerHTML = tooltipContent;
  tooltipElement.classList.add('show');
  
  // 定位tooltip（fixed定位，使用视口坐标）
  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - 8;
  
  // 边界检查
  if (left < 5) left = 5;
  if (left + tooltipRect.width > window.innerWidth - 5) {
    left = window.innerWidth - tooltipRect.width - 5;
  }
  if (top < 5) {
    top = rect.bottom + 8; // 如果上方空间不够，显示在下方
  }
  
  tooltipElement.style.left = left + 'px';
  tooltipElement.style.top = top + 'px';
}

// 隐藏tooltip
function hideTooltip() {
  tooltipElement.classList.remove('show');
}
