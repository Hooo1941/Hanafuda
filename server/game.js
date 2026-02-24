// 花札（Hanafuda）游戏逻辑
class HanafudaGame {
  constructor(roomId, gameRules = {}) {
    this.roomId = roomId;
    this.players = [];
    this.deck = [];
    this.field = [];
    this.playerHands = [[], []];
    this.playerCaptures = [[], []];
    this.currentPlayerIndex = 0;
    this.gameState = 'waiting'; // waiting, playing, round_end, game_end
    this.roundScores = [0, 0]; // 本回合得分
    this.totalScores = [0, 0]; // 总得分
    this.selectedHandCard = null;
    this.matchedFieldCards = [];
    this.drawnCard = null; // 从牌堆抽到的牌
    this.koikoiState = { player: null, canKoikoi: false };
    this.koikoiMultiplier = [1, 1]; // 每个玩家的倍数
    this.koikoiCount = [0, 0]; // 每个玩家喊Koi-Koi的次数
    this.turnPhase = 'play_hand'; // play_hand, select_hand_field, draw_deck, select_deck_field, koikoi_decision
    this.currentYakus = [[], []]; // 当前每个玩家的役种
    this.previousYakus = [[], []]; // 上一次的役种（用于判断是否有新役种）
    this.roundNumber = 0; // 回合数
    this.firstPlayerIndex = 0; // 先手玩家索引
    this.actionHistory = []; // 操作历史
    this.roundWinner = null; // 上一回合的赢家
    
    // 游戏规则配置
    this.gameRules = {
      enableHanamiTsukimi: gameRules.enableHanamiTsukimi !== false, // 默认启用花见酒和月见酒
      firstPlayerRule: gameRules.firstPlayerRule || 'rotate', // rotate, winner, loser
      koikoiMultiplierRule: gameRules.koikoiMultiplierRule || 'self' // self, opponent, none
    };
    
    console.log('游戏规则已设置:', this.gameRules);
    
    this.initializeDeck();
  }

  // 按月份排序
  sortByMonth(cards) {
    return cards.sort((a, b) => {
      if (a.month !== b.month) {
        return a.month - b.month;
      }
      // 同月份按类型排序：hikari > tane > tanzaku > kasu
      const typeOrder = { 'hikari': 0, 'tane': 1, 'tanzaku': 2, 'kasu': 3 };
      return typeOrder[a.type] - typeOrder[b.type];
    });
  }

  // 初始化48张花札牌
  initializeDeck() {
    const cardTypes = [
      // 光札 (20点) - 5张
      { month: 1, type: 'hikari', typeName: '光', name: '松鹤', points: 20 },
      { month: 3, type: 'hikari', typeName: '光', name: '樱幕', points: 20 },
      { month: 8, type: 'hikari', typeName: '光', name: '芒月', points: 20 },
      { month: 11, type: 'hikari', typeName: '光', name: '柳雨', points: 20 },
      { month: 12, type: 'hikari', typeName: '光', name: '桐凤', points: 20 },
      
      // 種札 (10点) - 9张
      { month: 2, type: 'tane', typeName: '种', name: '梅莺', points: 10 },
      { month: 4, type: 'tane', typeName: '种', name: '藤杜鹃', points: 10 },
      { month: 5, type: 'tane', typeName: '种', name: '菖蒲桥', points: 10 },
      { month: 6, type: 'tane', typeName: '种', name: '牡丹蝶', points: 10 },
      { month: 7, type: 'tane', typeName: '种', name: '萩猪', points: 10 },
      { month: 8, type: 'tane', typeName: '种', name: '芒雁', points: 10 },
      { month: 9, type: 'tane', typeName: '种', name: '菊酒杯', points: 10 },
      { month: 10, type: 'tane', typeName: '种', name: '枫鹿', points: 10 },
      { month: 11, type: 'tane', typeName: '种', name: '柳燕', points: 10 },
      
      // 短冊札 (5点) - 10张
      { month: 1, type: 'tanzaku', typeName: '短', subtype: 'aka', name: '松短', points: 5 },
      { month: 2, type: 'tanzaku', typeName: '短', subtype: 'aka', name: '梅短', points: 5 },
      { month: 3, type: 'tanzaku', typeName: '短', subtype: 'aka', name: '樱短', points: 5 },
      { month: 4, type: 'tanzaku', typeName: '短', subtype: 'murasaki', name: '藤短', points: 5 },
      { month: 5, type: 'tanzaku', typeName: '短', subtype: 'murasaki', name: '菖蒲短', points: 5 },
      { month: 6, type: 'tanzaku', typeName: '短', subtype: 'ao', name: '牡丹短', points: 5 },
      { month: 7, type: 'tanzaku', typeName: '短', subtype: 'murasaki', name: '萩短', points: 5 },
      { month: 9, type: 'tanzaku', typeName: '短', subtype: 'ao', name: '菊短', points: 5 },
      { month: 10, type: 'tanzaku', typeName: '短', subtype: 'ao', name: '枫短', points: 5 },
      { month: 11, type: 'tanzaku', typeName: '短', subtype: 'red', name: '柳短', points: 5 },
      
      // カス札 (1点) - 24张
      { month: 1, type: 'kasu', typeName: '滓', name: '松滓1', points: 1 },
      { month: 1, type: 'kasu', typeName: '滓', name: '松滓2', points: 1 },
      { month: 2, type: 'kasu', typeName: '滓', name: '梅滓1', points: 1 },
      { month: 2, type: 'kasu', typeName: '滓', name: '梅滓2', points: 1 },
      { month: 3, type: 'kasu', typeName: '滓', name: '樱滓1', points: 1 },
      { month: 3, type: 'kasu', typeName: '滓', name: '樱滓2', points: 1 },
      { month: 4, type: 'kasu', typeName: '滓', name: '藤滓1', points: 1 },
      { month: 4, type: 'kasu', typeName: '滓', name: '藤滓2', points: 1 },
      { month: 5, type: 'kasu', typeName: '滓', name: '菖蒲滓1', points: 1 },
      { month: 5, type: 'kasu', typeName: '滓', name: '菖蒲滓2', points: 1 },
      { month: 6, type: 'kasu', typeName: '滓', name: '牡丹滓1', points: 1 },
      { month: 6, type: 'kasu', typeName: '滓', name: '牡丹滓2', points: 1 },
      { month: 7, type: 'kasu', typeName: '滓', name: '萩滓1', points: 1 },
      { month: 7, type: 'kasu', typeName: '滓', name: '萩滓2', points: 1 },
      { month: 8, type: 'kasu', typeName: '滓', name: '芒滓1', points: 1 },
      { month: 8, type: 'kasu', typeName: '滓', name: '芒滓2', points: 1 },
      { month: 9, type: 'kasu', typeName: '滓', name: '菊滓1', points: 1 },
      { month: 9, type: 'kasu', typeName: '滓', name: '菊滓2', points: 1 },
      { month: 10, type: 'kasu', typeName: '滓', name: '枫滓1', points: 1 },
      { month: 10, type: 'kasu', typeName: '滓', name: '枫滓2', points: 1 },
      { month: 11, type: 'kasu', typeName: '滓', name: '柳滓', points: 1 },
      { month: 12, type: 'kasu', typeName: '滓', name: '桐滓1', points: 1 },
      { month: 12, type: 'kasu', typeName: '滓', name: '桐滓2', points: 1 },
      { month: 12, type: 'kasu', typeName: '滓', name: '桐滓3', points: 1 },
    ];

    this.deck = cardTypes.map((card, index) => ({
      id: index,
      ...card
    }));
  }

  // 洗牌
  shuffle() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  // 检查场上是否有4张同月份的牌
  checkFourOfSameMonth() {
    const monthCount = {};
    this.field.forEach(card => {
      monthCount[card.month] = (monthCount[card.month] || 0) + 1;
    });
    
    // 如果有任何月份出现4次，返回true
    return Object.values(monthCount).some(count => count === 4);
  }

  // 发牌
  deal() {
    let attempts = 0;
    const maxAttempts = 100; // 防止无限循环
    
    while (attempts < maxAttempts) {
      this.shuffle();
      
      // 每位玩家8张手牌
      this.playerHands[0] = this.deck.splice(0, 8);
      this.playerHands[1] = this.deck.splice(0, 8);
      
      // 场上8张牌
      this.field = this.deck.splice(0, 8);
      
      // 检查场上是否有4张同月份的牌
      if (this.checkFourOfSameMonth()) {
        // 重新初始化牌组并重新发牌
        console.log('场上有4张同月份的牌，重新发牌...');
        this.initializeDeck();
        attempts++;
        continue;
      }
      
      // 发牌成功，排序后退出
      this.playerHands[0] = this.sortByMonth(this.playerHands[0]);
      this.playerHands[1] = this.sortByMonth(this.playerHands[1]);
      this.field = this.sortByMonth(this.field);
      break;
    }
    
    if (attempts >= maxAttempts) {
      console.error('无法找到合适的发牌方式，使用最后一次发牌结果');
    }
    
    // 剩余24张作为牌堆
  }

  // 添加玩家
  addPlayer(playerId, ws) {
    if (this.players.length < 2) {
      this.players.push({ id: playerId, ws });
      return true;
    }
    return false;
  }

  // 开始新回合
  startNewRound() {
    // 根据规则决定先手
    if (this.roundNumber === 0) {
      // 第一局随机选择先手
      this.firstPlayerIndex = Math.floor(Math.random() * 2);
    } else {
      // 后续回合根据规则决定先手
      switch (this.gameRules.firstPlayerRule) {
        case 'rotate':
          // 轮换：每回合交替先手
          this.firstPlayerIndex = 1 - this.firstPlayerIndex;
          break;
        case 'winner':
          // 赢的先手：上回合赢家先手（平局不变）
          if (this.roundWinner !== null && this.roundWinner !== -1) {
            this.firstPlayerIndex = this.roundWinner;
          }
          break;
        case 'loser':
          // 输的先手：上回合输家先手（平局不变）
          if (this.roundWinner !== null && this.roundWinner !== -1) {
            this.firstPlayerIndex = 1 - this.roundWinner;
          }
          break;
      }
    }
    
    this.roundNumber++;
    this.currentPlayerIndex = this.firstPlayerIndex;
    
    // 重置回合数据
    this.deck = [];
    this.field = [];
    this.playerHands = [[], []];
    this.playerCaptures = [[], []];
    this.roundScores = [0, 0];
    this.selectedHandCard = null;
    this.matchedFieldCards = [];
    this.drawnCard = null;
    this.koikoiState = { player: null, canKoikoi: false };
    this.koikoiMultiplier = [1, 1];
    this.koikoiCount = [0, 0];
    this.turnPhase = 'play_hand';
    this.currentYakus = [[], []];
    this.previousYakus = [[], []]; // 重置上一次役种记录
    this.actionHistory = []; // 重置操作历史
    
    // 重新初始化牌组
    this.initializeDeck();
    this.deal();
    this.gameState = 'playing';
    
    return {
      success: true,
      roundNumber: this.roundNumber,
      firstPlayer: this.firstPlayerIndex
    };
  }

  // 开始游戏（第一次）
  startGame() {
    if (this.players.length === 2) {
      return this.startNewRound();
    }
    return false;
  }

  // 获取当前玩家索引
  getPlayerIndex(playerId) {
    return this.players.findIndex(p => p.id === playerId);
  }

  // 检查是否轮到该玩家
  isPlayerTurn(playerId) {
    return this.getPlayerIndex(playerId) === this.currentPlayerIndex;
  }

  // 玩家出牌（第一阶段）
  playCard(playerId, cardId) {
    if (!this.isPlayerTurn(playerId)) {
      return { success: false, error: '不是你的回合' };
    }

    if (this.turnPhase !== 'play_hand') {
      return { success: false, error: '当前阶段不能出牌' };
    }

    const playerIndex = this.getPlayerIndex(playerId);
    const hand = this.playerHands[playerIndex];
    const cardIndex = hand.findIndex(c => c.id === cardId);
    
    if (cardIndex === -1) {
      return { success: false, error: '手牌中没有这张牌' };
    }

    const card = hand[cardIndex];
    
    // 查找场上相同月份的牌
    const matchingCards = this.field.filter(c => c.month === card.month);
    
    if (matchingCards.length === 0) {
      // 没有匹配的牌，直接放到场上
      hand.splice(cardIndex, 1);
      this.field.push(card);
      this.field = this.sortByMonth(this.field); // 排序
      this.selectedHandCard = null;
      this.turnPhase = 'draw_deck';
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'played',
        card: card,
        timestamp: Date.now()
      });
      
      return { 
        success: true, 
        action: 'no_match',
        card: card,
        nextPhase: 'draw_deck'
      };
    } else if (matchingCards.length === 1) {
      // 只有一张匹配，自动配对
      hand.splice(cardIndex, 1);
      const fieldCardIndex = this.field.findIndex(c => c.id === matchingCards[0].id);
      const fieldCard = this.field.splice(fieldCardIndex, 1)[0];
      this.playerCaptures[playerIndex].push(card, fieldCard);
      this.field = this.sortByMonth(this.field); // 排序
      this.selectedHandCard = null;
      this.turnPhase = 'draw_deck';
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'played',
        card: card,
        matchedCard: fieldCard,
        timestamp: Date.now()
      });
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'captured',
        cards: [card, fieldCard],
        timestamp: Date.now()
      });
      
      return {
        success: true,
        action: 'auto_match',
        card: card,
        matchedCard: fieldCard,
        captured: [card, fieldCard],
        nextPhase: 'draw_deck'
      };
    } else if (matchingCards.length === 3) {
      // 场上有3张同月份的牌，全部获得
      hand.splice(cardIndex, 1);
      
      // 移除场上所有匹配的牌
      matchingCards.forEach(fieldCard => {
        const idx = this.field.findIndex(c => c.id === fieldCard.id);
        if (idx !== -1) {
          this.field.splice(idx, 1);
        }
      });
      
      this.field = this.sortByMonth(this.field); // 排序
      
      // 将手牌和场上3张牌都加入获得牌堆
      const capturedCards = [card, ...matchingCards];
      this.playerCaptures[playerIndex].push(...capturedCards);
      
      this.selectedHandCard = null;
      this.turnPhase = 'draw_deck';
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'played',
        card: card,
        matchedCard: null,
        matchedAll: true,
        timestamp: Date.now()
      });
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'captured',
        cards: capturedCards,
        timestamp: Date.now()
      });
      
      return {
        success: true,
        action: 'match_three',
        card: card,
        matchedCards: matchingCards,
        captured: capturedCards,
        nextPhase: 'draw_deck'
      };
    } else {
      // 多张匹配，需要玩家选择
      this.selectedHandCard = card;
      this.matchedFieldCards = matchingCards;
      hand.splice(cardIndex, 1); // 先从手牌移除
      this.turnPhase = 'select_hand_field';
      return {
        success: true,
        action: 'select_field_card',
        card: card,
        matches: matchingCards,
        nextPhase: 'select_hand_field'
      };
    }
  }

  // 选择场上的牌进行配对（手牌配对阶段）
  selectFieldCard(playerId, fieldCardId) {
    if (!this.isPlayerTurn(playerId)) {
      return { success: false, error: '不是你的回合' };
    }

    if (this.turnPhase !== 'select_hand_field') {
      return { success: false, error: '当前阶段不能选择场牌' };
    }

    if (!this.selectedHandCard || this.matchedFieldCards.length === 0) {
      return { success: false, error: '无效的状态' };
    }

    const playerIndex = this.getPlayerIndex(playerId);
    const fieldCard = this.matchedFieldCards.find(c => c.id === fieldCardId);
    
    if (!fieldCard) {
      return { success: false, error: '无效的场牌' };
    }

    // 从场上移除选中的牌
    const fieldIndex = this.field.findIndex(c => c.id === fieldCardId);
    if (fieldIndex !== -1) {
      this.field.splice(fieldIndex, 1);
    }
    this.field = this.sortByMonth(this.field); // 排序

    // 添加到玩家的获得牌堆
    this.playerCaptures[playerIndex].push(this.selectedHandCard, fieldCard);

    const captured = [this.selectedHandCard, fieldCard];
    
    // 记录操作
    this.actionHistory.push({
      playerIndex: playerIndex,
      type: 'played',
      card: this.selectedHandCard,
      matchedCard: fieldCard,
      timestamp: Date.now()
    });
    this.actionHistory.push({
      playerIndex: playerIndex,
      type: 'captured',
      cards: captured,
      timestamp: Date.now()
    });
    
    this.selectedHandCard = null;
    this.matchedFieldCards = [];
    this.turnPhase = 'draw_deck';

    return {
      success: true,
      action: 'field_card_selected',
      captured: captured,
      nextPhase: 'draw_deck'
    };
  }

  // 从牌堆抽牌（第二阶段）
  drawFromDeck(playerId) {
    if (!this.isPlayerTurn(playerId)) {
      return { success: false, error: '不是你的回合' };
    }

    if (this.turnPhase !== 'draw_deck') {
      return { success: false, error: '当前阶段不能抽牌' };
    }

    const playerIndex = this.getPlayerIndex(playerId);
    const drawnCard = this.deck.shift();
    this.drawnCard = drawnCard;
    
    // 查找场上相同月份的牌
    const matchingCards = this.field.filter(c => c.month === drawnCard.month);
    
    if (matchingCards.length === 0) {
      // 没有匹配，放到场上
      this.field.push(drawnCard);
      this.field = this.sortByMonth(this.field); // 排序
      this.drawnCard = null;
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'drawn',
        card: drawnCard,
        timestamp: Date.now()
      });
      
      return this.checkYakuAndNextTurn(playerIndex, drawnCard, []);
    } else if (matchingCards.length === 1) {
      // 自动配对
      const fieldCardIndex = this.field.findIndex(c => c.id === matchingCards[0].id);
      const fieldCard = this.field.splice(fieldCardIndex, 1)[0];
      this.field = this.sortByMonth(this.field); // 排序
      this.playerCaptures[playerIndex].push(drawnCard, fieldCard);
      this.drawnCard = null;
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'drawn',
        card: drawnCard,
        matchedCard: fieldCard,
        timestamp: Date.now()
      });
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'captured',
        cards: [drawnCard, fieldCard],
        timestamp: Date.now()
      });
      
      return this.checkYakuAndNextTurn(playerIndex, drawnCard, [drawnCard, fieldCard]);
    } else if (matchingCards.length === 3) {
      // 场上有3张同月份的牌，全部获得
      // 移除场上所有匹配的牌
      matchingCards.forEach(fieldCard => {
        const idx = this.field.findIndex(c => c.id === fieldCard.id);
        if (idx !== -1) {
          this.field.splice(idx, 1);
        }
      });
      
      this.field = this.sortByMonth(this.field); // 排序
      
      // 将抽到的牌和场上3张牌都加入获得牌堆
      const capturedCards = [drawnCard, ...matchingCards];
      this.playerCaptures[playerIndex].push(...capturedCards);
      
      this.drawnCard = null;
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'drawn',
        card: drawnCard,
        matchedCard: null,
        matchedAll: true,
        timestamp: Date.now()
      });
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'captured',
        cards: capturedCards,
        timestamp: Date.now()
      });
      
      return this.checkYakuAndNextTurn(playerIndex, drawnCard, capturedCards);
    } else {
      // 多张匹配（2张），需要选择
      this.matchedFieldCards = matchingCards;
      this.turnPhase = 'select_deck_field';
      return {
        success: true,
        action: 'select_deck_field_card',
        drawnCard: drawnCard,
        matches: matchingCards,
        nextPhase: 'select_deck_field'
      };
    }
  }

  // 选择抽到的牌与场上的牌配对
  selectDeckFieldCard(playerId, fieldCardId) {
    if (!this.isPlayerTurn(playerId)) {
      return { success: false, error: '不是你的回合' };
    }

    if (this.turnPhase !== 'select_deck_field') {
      return { success: false, error: '当前阶段不能选择场牌' };
    }

    const playerIndex = this.getPlayerIndex(playerId);
    const fieldCard = this.matchedFieldCards.find(c => c.id === fieldCardId);
    
    if (!fieldCard || !this.drawnCard) {
      return { success: false, error: '无效的状态' };
    }

    // 从场上移除
    const fieldIndex = this.field.findIndex(c => c.id === fieldCardId);
    if (fieldIndex !== -1) {
      this.field.splice(fieldIndex, 1);
    }
    this.field = this.sortByMonth(this.field); // 排序

    this.playerCaptures[playerIndex].push(this.drawnCard, fieldCard);
    
    const captured = [this.drawnCard, fieldCard];
    const drawnCard = this.drawnCard;
    
    // 记录操作
    this.actionHistory.push({
      playerIndex: playerIndex,
      type: 'drawn',
      card: drawnCard,
      matchedCard: fieldCard,
      timestamp: Date.now()
    });
    this.actionHistory.push({
      playerIndex: playerIndex,
      type: 'captured',
      cards: captured,
      timestamp: Date.now()
    });
    
    this.drawnCard = null;
    this.matchedFieldCards = [];
    
    return this.checkYakuAndNextTurn(playerIndex, drawnCard, captured);
  }

  // 检查役种并决定下一步
  checkYakuAndNextTurn(playerIndex, lastCard, captured) {
    const yakus = this.checkYaku(playerIndex);
    const previousYakus = this.previousYakus[playerIndex];
    
    // 检查是否有新的役种或现有役种点数增加
    const hasNewYaku = this.hasNewOrImprovedYaku(yakus, previousYakus);
    
    if (yakus.length > 0 && hasNewYaku) {
      // 有新的役种或役种点数增加，可以选择Koi-Koi或结束
      // 即使是最后一张手牌，只要有新役，也应该给玩家选择的机会
      this.currentYakus[playerIndex] = yakus;
      this.koikoiState = {
        player: playerIndex,
        canKoikoi: true,
        yakus: yakus
      };
      this.turnPhase = 'koikoi_decision';
      
      return {
        success: true,
        action: 'koikoi_decision',
        drawnCard: lastCard,
        captured: captured,
        yakus: yakus,
        totalPoints: this.calculateYakuPoints(yakus),
        multiplier: this.koikoiMultiplier[playerIndex],
        nextPhase: 'koikoi_decision'
      };
    }
    
    // 没有新役种时，检查是否双方手牌都已打完
    if (this.playerHands[0].length === 0 && this.playerHands[1].length === 0) {
      // 手牌打完且没有新役，回合结束，双方都记0分
      return this.endRound(null, 'hands_empty');
    }
    
    // 没有役种或没有新役种，更新当前役种并轮到下一位玩家
    this.currentYakus[playerIndex] = yakus;
    this.currentPlayerIndex = 1 - this.currentPlayerIndex;
    this.turnPhase = 'play_hand';
    return {
      success: true,
      action: 'next_turn',
      drawnCard: lastCard,
      captured: captured,
      nextPlayer: this.currentPlayerIndex,
      nextPhase: 'play_hand'
    };
  }

  // Koi-Koi决策
  koikoiDecision(playerId, continueGame) {
    const playerIndex = this.getPlayerIndex(playerId);
    
    if (this.koikoiState.player !== playerIndex) {
      return { success: false, error: '不是你的Koi-Koi决策' };
    }

    if (this.turnPhase !== 'koikoi_decision') {
      return { success: false, error: '当前阶段不能做Koi-Koi决策' };
    }

    if (continueGame) {
      // 选择继续游戏（こいこい）
      this.koikoiCount[playerIndex]++;
      
      // 根据规则增加倍数
      if (this.gameRules.koikoiMultiplierRule === 'self') {
        // 自己倍数+1
        this.koikoiMultiplier[playerIndex] = 1 + this.koikoiCount[playerIndex];
      } else if (this.gameRules.koikoiMultiplierRule === 'opponent') {
        // 对方倍数+1
        const opponentIndex = 1 - playerIndex;
        this.koikoiMultiplier[opponentIndex]++;
      }
      // else if === 'none': 都不加倍，不做任何操作
      
      // 保存当前役种作为下次比较的基准
      this.previousYakus[playerIndex] = [...this.currentYakus[playerIndex]];
      
      this.koikoiState = { player: null, canKoikoi: false };
      this.currentPlayerIndex = 1 - this.currentPlayerIndex;
      this.turnPhase = 'play_hand';
      
      // 记录操作
      this.actionHistory.push({
        playerIndex: playerIndex,
        type: 'koikoi',
        multiplier: this.koikoiMultiplier[playerIndex],
        opponentMultiplier: this.koikoiMultiplier[1 - playerIndex],
        timestamp: Date.now()
      });
      
      return {
        success: true,
        action: 'continue_game',
        nextPlayer: this.currentPlayerIndex,
        multiplier: this.koikoiMultiplier[playerIndex],
        opponentMultiplier: this.koikoiMultiplier[1 - playerIndex],
        koikoiCount: this.koikoiCount[playerIndex],
        nextPhase: 'play_hand'
      };
    } else {
      // 选择结束游戏
      return this.endRound(playerIndex);
    }
  }

  // 检查役种
  checkYaku(playerIndex) {
    const captures = this.playerCaptures[playerIndex];
    const yakus = [];

    // 光札相关
    const hikariCards = captures.filter(c => c.type === 'hikari');
    const hikariCount = hikariCards.length;

    if (hikariCount === 5) {
      yakus.push({ name: '五光', points: 15 });
    } else if (hikariCount === 4 && !hikariCards.some(c => c.month === 11)) {
      yakus.push({ name: '四光', points: 10 });
    } else if (hikariCount === 4) {
      yakus.push({ name: '雨四光', points: 8 });
    } else if (hikariCount === 3 && !hikariCards.some(c => c.month === 11)) {
      yakus.push({ name: '三光', points: 6 });
    }

    // 種札相关
    const taneCards = captures.filter(c => c.type === 'tane');
    if (taneCards.length >= 5) {
      yakus.push({ name: '种', points: 1 + (taneCards.length - 5) });
    }

    // 猪鹿蝶
    const ino = taneCards.some(c => c.month === 7);
    const shika = taneCards.some(c => c.month === 10);
    const cho = taneCards.some(c => c.month === 6);
    if (ino && shika && cho) {
      yakus.push({ name: '猪鹿蝶', points: 5 });
    }

    // 花見で一杯・月見で一杯
    if (this.gameRules.enableHanamiTsukimi) {
      const sakuraMaku = captures.some(c => c.month === 3 && c.type === 'hikari');
      const kikuSakazuki = captures.some(c => c.month === 9 && c.type === 'tane');
      const susukiTsuki = captures.some(c => c.month === 8 && c.type === 'hikari');
      
      if (sakuraMaku && kikuSakazuki) {
        yakus.push({ name: '花见酒', points: 3 });
      }
      if (susukiTsuki && kikuSakazuki) {
        yakus.push({ name: '月见酒', points: 3 });
      }
    }

    // 短冊札相关
    const tanzakuCards = captures.filter(c => c.type === 'tanzaku');
    const akaTan = captures.filter(c => c.type === 'tanzaku' && c.subtype === 'aka');
    const aoTan = captures.filter(c => c.type === 'tanzaku' && c.subtype === 'ao');
    
    if (akaTan.length === 3) {
      yakus.push({ name: '赤短', points: 6 });
    }
    if (aoTan.length === 3) {
      yakus.push({ name: '青短', points: 6 });
    }
    if (tanzakuCards.length >= 5) {
      yakus.push({ name: '短册', points: 1 + (tanzakuCards.length - 5) });
    }

    // カス札相关
    const kasuCards = captures.filter(c => c.type === 'kasu');
    if (kasuCards.length >= 10) {
      yakus.push({ name: '滓', points: 1 + (kasuCards.length - 10) });
    }

    return yakus;
  }

  // 计算役种总分（带倍数）
  calculateYakuPoints(yakus) {
    return yakus.reduce((sum, yaku) => sum + yaku.points, 0);
  }

  // 检查是否有新的役种或现有役种的点数增加
  hasNewOrImprovedYaku(currentYakus, previousYakus) {
    // 如果之前没有役种，现在有了，说明是新役种
    if (previousYakus.length === 0 && currentYakus.length > 0) {
      return true;
    }
    
    // 检查每个当前役种
    for (const currentYaku of currentYakus) {
      const prevYaku = previousYakus.find(y => y.name === currentYaku.name);
      
      if (!prevYaku) {
        // 这是一个新的役种
        return true;
      }
      
      if (currentYaku.points > prevYaku.points) {
        // 现有役种的点数增加了（如短册从5张变6张）
        return true;
      }
    }
    
    return false;
  }

  // 结束回合
  // winnerIndex: 指定获胜者索引（有人选择结束游戏）
  // reason: 结束原因 ('player_choice', 'hands_empty')
  endRound(winnerIndex = null, reason = 'hands_empty') {
    const yakus0 = this.checkYaku(0);
    const yakus1 = this.checkYaku(1);
    const basePoints0 = this.calculateYakuPoints(yakus0);
    const basePoints1 = this.calculateYakuPoints(yakus1);
    
    let points0 = 0;
    let points1 = 0;
    
    // 如果指定了获胜者（有人选择结束游戏），只有那个人得分
    if (winnerIndex !== null) {
      if (winnerIndex === 0) {
        points0 = basePoints0 * this.koikoiMultiplier[0];
        points1 = 0;
      } else {
        points0 = 0;
        points1 = basePoints1 * this.koikoiMultiplier[1];
      }
    } else {
      // 手牌用完，双方都记0分
      points0 = 0;
      points1 = 0;
    }

    this.roundScores[0] = points0;
    this.roundScores[1] = points1;
    this.totalScores[0] += points0;
    this.totalScores[1] += points1;

    // 记录本回合赢家（用于下回合先手判断）
    if (points0 > points1) {
      this.roundWinner = 0;
    } else if (points1 > points0) {
      this.roundWinner = 1;
    } else {
      this.roundWinner = -1; // 平局
    }

    this.turnPhase = 'round_end';
    this.gameState = 'round_end';

    // 检查是否有玩家达到100分
    const isGameEnd = this.totalScores[0] >= 100 || this.totalScores[1] >= 100;
    let winner = null;
    
    if (isGameEnd) {
      this.gameState = 'game_end';
      if (this.totalScores[0] > this.totalScores[1]) {
        winner = 0;
      } else if (this.totalScores[1] > this.totalScores[0]) {
        winner = 1;
      } else {
        winner = -1; // 平局
      }
    }

    return {
      success: true,
      action: 'round_end',
      yakus: [yakus0, yakus1],
      basePoints: [basePoints0, basePoints1],
      multipliers: this.koikoiMultiplier,
      points: [points0, points1],
      roundScores: [points0, points1],
      totalScores: this.totalScores,
      roundNumber: this.roundNumber,
      isGameEnd: isGameEnd,
      winner: winner
    };
  }

  // 获取游戏状态
  getGameState(playerIndex) {
    return {
      roomId: this.roomId,
      gameState: this.gameState,
      playerIndex: playerIndex,
      currentPlayerIndex: this.currentPlayerIndex,
      hand: this.playerHands[playerIndex] || [],
      opponentHandCount: this.playerHands[1 - playerIndex]?.length || 0,
      field: this.field,
      captures: this.playerCaptures[playerIndex] || [],
      opponentCaptures: this.playerCaptures[1 - playerIndex] || [],
      deckCount: this.deck.length,
      roundScores: this.roundScores,
      totalScores: this.totalScores,
      koikoiState: this.koikoiState,
      turnPhase: this.turnPhase,
      multipliers: this.koikoiMultiplier,
      koikoiCounts: this.koikoiCount,
      currentYakus: this.currentYakus,
      roundNumber: this.roundNumber,
      firstPlayerIndex: this.firstPlayerIndex,
      actionHistory: this.actionHistory
    };
  }
}

module.exports = HanafudaGame;
