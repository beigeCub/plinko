/**
 * Electric Plinko — 11-box demo
 * Edit PRIZES, GAME, and BOARD to adjust the game.
 * Demo rewards have no real monetary value.
 */
(() => {
  'use strict';

  // ---------- Configuration ----------
  // The number of boxes is derived from this array. Keep the center lightning.
  const PRIZES = [
    { type: 'cash', amount: 2000 },
    { type: 'cash', amount: 1000 },
    { type: 'cash', amount: 200 },
    { type: 'fs', amount: 100 },
    { type: 'fs', amount: 40 },
    { type: 'bolt', amount: 0 },
    { type: 'fs', amount: 40 },
    { type: 'fs', amount: 100 },
    { type: 'cash', amount: 200 },
    { type: 'cash', amount: 1000 },
    { type: 'cash', amount: 2000 },
  ];

  const SLOT_COUNT = PRIZES.length; // 11
  const ROW_COUNT = SLOT_COUNT-1; // 10 rows / left-right decisions

  const GAME = {
    quantityOptions: [1, 2, 3, 5, 10],
    minBallDurationMs: 2500,
    extraBallDurationMs: 650,
    spawnIntervalMs: 440,
    highlightDurationMs: 2100,
  };

  // Coordinates are in the original 941 × 1672 canvas coordinate system.
  const BOARD = {
    width: 941,
    height: 1672,
    centerX: 470.5,
    slotLeft: 24,
    slotRight: 917,
    slotY: 857,
    slotHeight: 145,
    pegStartY: 335,
    pegStepY: 52, // 10 rows occupy roughly the same board height as 12 did
    ballStartY: 345,
    ballEndY: 948,
    
    playfield: [
      [366, 395], [576, 395], [890, 860], [48, 860],
    ],
  };

  const SLOT_WIDTH = (BOARD.slotRight - BOARD.slotLeft) / SLOT_COUNT;
  const HALF_STEP = SLOT_WIDTH / 2;
  const slotCenterX = index => BOARD.slotLeft + (index + 0.5) * SLOT_WIDTH;
  const formatAmount = amount => amount.toLocaleString('en-US');
  const rewardLabel = prize => {
    if (prize.type === 'bolt') return 'Lightning icon';
    return `${formatAmount(prize.amount)} AMD ${prize.type === 'fs' ? 'free spins' : 'instant cash'}`;
  };

  // ---------- Elements and assets ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const dropButton = document.getElementById('drop');
  const quantityControl = document.getElementById('controls');
  const statusBox = document.getElementById('statusBox');
  const winText = document.getElementById('winText');
  const landedText = document.getElementById('landed');
  const lastWinText = document.getElementById('lastWin');

  const images = {};
  const assetPaths = {
    cash: 'assets/cash_pink.png',
    fs: 'assets/free_spins_silver.png',
    bolt: 'assets/lightning_clean.png',
  };
  for (const [type, path] of Object.entries(assetPaths)) {
    const img = new Image();
    img.src = path;
    images[type] = img;
  }

  let selectedQuantity = 1;
  let playing = false;
  let waitingToSpawn = 0;
  let activeBalls = [];
  let winEffects = [];
  let previousFrameTime = 0;
  let lastSpawnTime = -Infinity;
  let ballsLanded = 0;
  let roundRewards = [];

  // ---------- Controls ----------
  for (const number of GAME.quantityOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(number);
    button.className = 'ball-option' + (number === selectedQuantity ? ' active' : '');
    button.setAttribute('aria-pressed', String(number === selectedQuantity));
    button.addEventListener('click', () => {
      if (playing) return;
      selectedQuantity = number;
      for (const option of quantityControl.children) {
        const selected = Number(option.textContent) === number;
        option.classList.toggle('active', selected);
        option.setAttribute('aria-pressed', String(selected));
      }
    });
    quantityControl.appendChild(button);
  }

  function setControlsEnabled(enabled) {
    dropButton.disabled = !enabled;
    for (const button of quantityControl.children) button.disabled = !enabled;
  }

  function beginRound() {
    if (playing) return;
    playing = true;
    waitingToSpawn = selectedQuantity;
    activeBalls = [];
    winEffects = [];
    ballsLanded = 0;
    roundRewards = [];
    lastSpawnTime = -Infinity;
    landedText.textContent = '0';
    lastWinText.textContent = '—';
    statusBox.classList.remove('win');
    statusBox.querySelectorAll('img').forEach(image => image.remove());
    winText.textContent = `DROPPING ${selectedQuantity} BALL${selectedQuantity === 1 ? '' : 'S'}…`;
    setControlsEnabled(false);
  }
  dropButton.addEventListener('click', beginRound);

  // ---------- Ball paths ----------
  // Every left or right turn is equally likely in this visual demo.
  // Ten binary turns produce eleven possible landing slots.
  function spawnBall() {
    const directions = [];
    let targetSlot = 0;

    for (let row = 0; row < ROW_COUNT; row++) {
      const direction = Math.random() < 0.5 ? -1 : 1;
      directions.push(direction);
      if (direction === 1) targetSlot++;
    }

    const points = [{ x: BOARD.centerX, y: BOARD.ballStartY }];
    let x = BOARD.centerX;
    for (let row = 0; row < ROW_COUNT; row++) {
      x += directions[row] * HALF_STEP;
      points.push({
        x,
        y: BOARD.pegStartY + 22 + row * BOARD.pegStepY,
      });
    }
    points.push({ x: slotCenterX(targetSlot), y: BOARD.ballEndY });

    activeBalls.push({
      points,
      targetSlot,
      elapsedMs: 0,
      durationMs: GAME.minBallDurationMs + Math.random() * GAME.extraBallDurationMs,
      x: BOARD.centerX,
      y: BOARD.ballStartY,
      trail: [],
    });
  }

  // Smooth Catmull–Rom interpolation makes each bounce less angular.
  function positionAlongPath(points, progress) {
    const scaled = progress * (points.length - 1);
    const i = Math.min(points.length - 2, Math.floor(scaled));
    const t = Math.min(1, scaled - i);
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const d = points[i + 1];
    const e = points[Math.min(points.length - 1, i + 2)];
    const smooth = (p0, p1, p2, p3) => 0.5 * (
      2 * p1 + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
    );
    return {
      x: smooth(a.x, b.x, d.x, e.x),
      y: b.y + (d.y - b.y) * t - 2.3 * Math.sin(t * Math.PI),
    };
  }

  // ---------- Rewards ----------
  function awardPrize(slotIndex) {
    const prize = PRIZES[slotIndex];
    const message = rewardLabel(prize);
    ballsLanded++;
    roundRewards.push(message);
    landedText.textContent = String(ballsLanded);
    lastWinText.textContent = prize.type === 'bolt' ? 'LIGHTNING' : `${formatAmount(prize.amount)} AMD`;
    statusBox.querySelectorAll('img').forEach(image => image.remove());

    const icon = document.createElement('img');
    icon.className = 'icon';
    icon.src = images[prize.type].src;
    icon.alt = '';
    statusBox.insertBefore(icon, winText);
    winText.textContent = message.toUpperCase();
    statusBox.classList.add('win');

    winEffects.push({
      slotIndex,
      elapsedMs: 0,
      durationMs: GAME.highlightDurationMs,
    });
  }

  // ---------- Rendering ----------
  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  
function drawPegBoard() {
  ctx.save();

  // Create triangular playfield
  const [
    [topLeftX, topY],
    [topRightX],
    [bottomRightX, bottomY],
    [bottomLeftX]
  ] = BOARD.playfield;

  const clip = new Path2D();

  clip.moveTo(topLeftX, topY);
  clip.lineTo(topRightX, topY);
  clip.lineTo(bottomRightX, bottomY);
  clip.lineTo(bottomLeftX, bottomY);
  clip.closePath();

  ctx.clip(clip);

  // Board background
  const background = ctx.createLinearGradient(0, 340, 0, 870);

  background.addColorStop(0, '#07152b');
  background.addColorStop(0.6, '#071830');
  background.addColorStop(1, '#06152b');

  ctx.fillStyle = background;
  ctx.fillRect(30, 335, 880, 530);

  // Subtle blue glow
  const glow = ctx.createRadialGradient(
    BOARD.centerX, 650, 20,
    BOARD.centerX, 610, 390
  );

  glow.addColorStop(0, '#1454963b');
  glow.addColorStop(1, '#01091800');

  ctx.fillStyle = glow;
  ctx.fillRect(0, 335, BOARD.width, 525);
ctx.restore();

  // Helper for drawing individual pegs
  function drawPeg(x, y) {
    const gold = ctx.createRadialGradient(
      x - 2.5, y - 3.2, 1,
      x, y, 7
    );

    gold.addColorStop(0, '#fff6d0');
    gold.addColorStop(0.3, '#ffc269');
    gold.addColorStop(0.82, '#bd6316');
    gold.addColorStop(1, '#793000');

    ctx.save();

    ctx.shadowColor = '#ffb33e';
    ctx.shadowBlur = 12;
    ctx.fillStyle = gold;

    ctx.beginPath();
    ctx.arc(x, y, 6.8, 0, Math.PI * 2);
    ctx.fill();

    // Small reflection
    ctx.fillStyle = '#fff8ca';
    ctx.beginPath();
    ctx.arc(x - 2.2, y - 2.7, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Main 10 rows of pegs
  for (let row = 0; row < ROW_COUNT; row++) {
    for (let column = 0; column <= row; column++) {
      const x =
        BOARD.centerX +
        (column - row / 2) * SLOT_WIDTH;

      const y =
        BOARD.pegStartY +
        row * BOARD.pegStepY;

      drawPeg(x, y);
    }
  }

  // // Extra decorative row to fill the bottom
  // // Does NOT change the ball path or probabilities
  // const extraRow = ROW_COUNT;

  // const extraY =
  //   BOARD.pegStartY +
  //   extraRow * BOARD.pegStepY;

  // for (let column = 0; column <= extraRow; column++) {
  //   const x =
  //     BOARD.centerX +
  //     (column - extraRow / 2) * SLOT_WIDTH;

  //   drawPeg(x, extraY);
  

  ctx.restore();
}


  function drawPrizeSlots() {
    for (let index = 0; index < SLOT_COUNT; index++) {
      const prize = PRIZES[index];
      const x = BOARD.slotLeft + index * SLOT_WIDTH + 1;
      const width = SLOT_WIDTH - 2;
      const activeGlow = winEffects
        .filter(effect => effect.slotIndex === index)
        .reduce((best, effect) => Math.max(best, 1 - effect.elapsedMs / effect.durationMs), 0);
      const highlighted = activeGlow > 0;

      ctx.save();
      ctx.shadowColor = highlighted ? '#fff9c5' : '#2b9aff';
      ctx.shadowBlur = highlighted ? 36 * activeGlow + 10 : 5;
      const gradient = ctx.createLinearGradient(x, BOARD.slotY, x, BOARD.slotY + BOARD.slotHeight);
      if (prize.type === 'bolt') {
        gradient.addColorStop(0, highlighted ? '#ffbf43' : '#7b4a07');
        gradient.addColorStop(1, '#2f1a06');
      } else if (prize.type === 'fs') {
        gradient.addColorStop(0, highlighted ? '#7686a8' : '#19273d');
        gradient.addColorStop(1, '#090f20');
      } else {
        gradient.addColorStop(0, highlighted ? '#e64d68' : '#57132e');
        gradient.addColorStop(1, '#24071f');
      }
      ctx.fillStyle = gradient;
      roundedRect(x, BOARD.slotY, width, BOARD.slotHeight, 9);
      ctx.fill();
      ctx.strokeStyle = highlighted ? '#fff6b9' : '#56b7ff';
      ctx.lineWidth = highlighted ? 3.8 : 1.75;
      ctx.stroke();
      ctx.restore();

      const image = images[prize.type];
      if (image.complete && image.naturalWidth) {
        if (prize.type === 'bolt') {
          ctx.save();
          ctx.shadowColor = '#ffb21b';
          ctx.shadowBlur = highlighted ? 35 : 15;
          ctx.drawImage(image, x + width / 2 - 22, BOARD.slotY + 13, 44, 76);
          ctx.restore();
        } else {
          const iconWidth = 90;
          const iconHeight = 70;
          ctx.drawImage(image,x + (width - iconWidth) / 2,BOARD.slotY + 10,iconWidth,iconHeight);
        }
      }
      

      if (prize.type !== 'bolt') {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `900 ${prize.amount >= 1000 ? 20 : 25}px Inter, Arial, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 5;
        ctx.fillText(formatAmount(prize.amount), x + width / 2, BOARD.slotY + 110);
        ctx.restore();
      }

      if (highlighted) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, activeGlow);
        ctx.strokeStyle = '#ffe875';
        ctx.lineWidth = 5;
        roundedRect(x - 3, BOARD.slotY - 4, width + 6, BOARD.slotHeight + 8, 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawPrizeTrayOutline() {
    ctx.save();
    ctx.shadowColor = '#009dff';
    ctx.shadowBlur = 15;
    ctx.strokeStyle = '#4fbcff';
    ctx.lineWidth = 4;
    roundedRect(21, 859, 899, 146, 16);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffdb75';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(26, 1003);
    ctx.lineTo(915, 1003);
    ctx.stroke();
    ctx.restore();
  }

  function drawWinAnnouncement() {
    if (!winEffects.length) return;
    const effect = winEffects[winEffects.length - 1];
    const remaining = 1 - effect.elapsedMs / effect.durationMs;
    const prize = PRIZES[effect.slotIndex];
    const centerX = slotCenterX(effect.slotIndex);
    const y = BOARD.slotY - 91 - 20 * (1 - remaining);
    const popupX = Math.max(173, Math.min(768, centerX));

    ctx.save();
    ctx.globalAlpha = Math.min(1, remaining * 2.5);
    ctx.shadowColor = prize.type === 'fs' ? '#79c8ff' : '#ffb356';
    ctx.shadowBlur = 18;
    const background = ctx.createLinearGradient(0, y - 22, 0, y + 26);
    background.addColorStop(0, prize.type === 'cash' ? '#70213d' : '#122d50');
    background.addColorStop(1, '#071326');
    ctx.fillStyle = background;
    roundedRect(popupX - 170, y - 28, 340, 59, 18);
    ctx.fill();
    ctx.strokeStyle = prize.type === 'cash' ? '#ffaccb' : '#7acaff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const image = images[prize.type];
    if (image.complete && image.naturalWidth) {
 const iconWidth = 90;
const iconHeight = 70;
ctx.drawImage(
  image,
  popupX - 155,
  y - iconHeight / 2,
  iconWidth,
  iconHeight
);    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 23px Inter, Arial';
    ctx.fillText(prize.type === 'bolt' ? 'LIGHTNING' : `${formatAmount(prize.amount)} AMD`, popupX + 35, y + 2);
    ctx.restore();

    if (remaining > 0.55) {
      ctx.save();
      ctx.globalAlpha = (remaining - 0.55) / 0.45;
      ctx.strokeStyle = '#fff4a8';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#ffc43c';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(centerX, BOARD.slotY + 10, 20 + (1 - remaining) * 55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawMovingBalls() {
    for (const ball of activeBalls) {
      ctx.save();
      for (let i = 1; i < ball.trail.length; i++) {
        ctx.strokeStyle = `rgba(87,210,255,${(i / ball.trail.length) * 0.18})`;
        ctx.lineWidth = 2 + (i / ball.trail.length) * 4;
        ctx.beginPath();
        ctx.moveTo(ball.trail[i - 1].x, ball.trail[i - 1].y);
        ctx.lineTo(ball.trail[i].x, ball.trail[i].y);
        ctx.stroke();
      }
      const gold = ctx.createRadialGradient(ball.x - 4, ball.y - 5, 1, ball.x, ball.y, 15);
      gold.addColorStop(0, '#fffef1');
      gold.addColorStop(0.35, '#ffe78b');
      gold.addColorStop(0.75, '#ffae25');
      gold.addColorStop(1, '#9d4a09');
      ctx.shadowColor = '#ffce5f';
      ctx.shadowBlur = 27;
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 12.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Animation ----------
  function animate(time) {
    const deltaMs = previousFrameTime ? Math.min(50, time - previousFrameTime) : 16;
    previousFrameTime = time;

    if (playing && waitingToSpawn > 0 && time - lastSpawnTime >= GAME.spawnIntervalMs) {
      spawnBall();
      waitingToSpawn--;
      lastSpawnTime = time;
    }

    for (let i = activeBalls.length - 1; i >= 0; i--) {
      const ball = activeBalls[i];
      ball.elapsedMs += deltaMs;
      const progress = Math.min(1, ball.elapsedMs / ball.durationMs);
      const location = positionAlongPath(ball.points, progress);
      ball.x = location.x;
      ball.y = location.y;
      const previous = ball.trail[ball.trail.length - 1];
      if (!previous || Math.hypot(ball.x - previous.x, ball.y - previous.y) > 9) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 11) ball.trail.shift();
      }
      if (progress >= 1) {
        awardPrize(ball.targetSlot);
        activeBalls.splice(i, 1);
      }
    }

    for (let i = winEffects.length - 1; i >= 0; i--) {
      winEffects[i].elapsedMs += deltaMs;
      if (winEffects[i].elapsedMs >= winEffects[i].durationMs) winEffects.splice(i, 1);
    }

    if (playing && waitingToSpawn === 0 && activeBalls.length === 0) {
      playing = false;
      setControlsEnabled(true);
      if (roundRewards.length > 1) {
        winText.textContent = `ROUND COMPLETE · ${ballsLanded} PRIZES`;
      }
    }

    ctx.clearRect(0, 0, BOARD.width, BOARD.height);
    drawPegBoard();
    drawMovingBalls();       // Behind prize boxes
    drawPrizeSlots();        // In front of balls
    drawPrizeTrayOutline();
    drawWinAnnouncement();   // Above everything
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // ---------- Help dialog ----------
  const modal = document.getElementById('modal');
  document.getElementById('help').addEventListener('click', () => modal.classList.add('open'));
  document.getElementById('close').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.classList.remove('open');
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') modal.classList.remove('open');
  });
})();
