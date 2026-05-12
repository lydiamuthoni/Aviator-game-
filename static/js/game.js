/**
 * AVIATOR GAME - FRONTEND LOGIC
 * Handles game mechanics, animations, and API communication
 */

// ============================================
// GAME STATE
// ============================================
let currentUser = null;
let authToken = null;
let gameState = {
    multiplier: 1.00,
    status: 'waiting', // waiting, starting, flying, crashed
    countdown: 5,
    roundId: 0,
    crashPoint: null
};
let userBalance = 0;
let activeBet = null;
let animationFrameId = null;
let gamePollInterval = null;

// ============================================
// DOM ELEMENTS
// ============================================
let canvas, ctx;
let canvasWidth, canvasHeight;
let planeX, planeY;
let planeAngle = 0;
let particles = [];
let explosionActive = false;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupCanvas();
    startGamePolling();
});

async function checkAuth() {
    try {
        const response = await fetch('/api/auth/check');
        const data = await response.json();
        
        if (data.logged_in) {
            currentUser = data.user;
            await fetchBalance();
            showGameInterface();
        } else {
            showAuthInterface();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showAuthInterface();
    }
}

async function fetchBalance() {
    try {
        const response = await fetch('/api/user/balance');
        const data = await response.json();
        userBalance = data.balance;
        updateBalanceDisplay();
    } catch (error) {
        console.error('Failed to fetch balance:', error);
    }
}

// ============================================
// AUTHENTICATION UI
// ============================================
function showAuthInterface() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="auth-container">
            <div class="auth-box">
                <div class="logo">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M3 12L21 3L15 12L21 21L3 12Z" fill="#FFB347" stroke="#FFEA80" stroke-width="1.2"/>
                        <circle cx="12" cy="12" r="2" fill="#FF8C00"/>
                    </svg>
                </div>
                <h1>AVIATOR</h1>
                
                <div class="tab-buttons">
                    <button class="tab-btn active" onclick="switchTab('login')">LOGIN</button>
                    <button class="tab-btn" onclick="switchTab('register')">REGISTER</button>
                </div>
                
                <div id="loginTab">
                    <div class="form-group">
                        <label>USERNAME</label>
                        <input type="text" id="loginUsername" placeholder="Enter username">
                    </div>
                    <div class="form-group">
                        <label>PASSWORD</label>
                        <input type="password" id="loginPassword" placeholder="Enter password">
                    </div>
                    <button class="btn-primary" onclick="handleLogin()">LOGIN & FLY ✈️</button>
                </div>
                
                <div id="registerTab" class="hide">
                    <div class="form-group">
                        <label>USERNAME</label>
                        <input type="text" id="regUsername" placeholder="Choose username">
                    </div>
                    <div class="form-group">
                        <label>PHONE NUMBER</label>
                        <input type="tel" id="regPhone" placeholder="e.g., 0712345678">
                    </div>
                    <div class="form-group">
                        <label>PASSWORD</label>
                        <input type="password" id="regPassword" placeholder="Create password">
                    </div>
                    <button class="btn-primary" onclick="handleRegister()">CREATE ACCOUNT 🎮</button>
                </div>
                
                <div id="messageArea"></div>
            </div>
        </div>
    `;
}

function switchTab(tab) {
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const tabs = document.querySelectorAll('.tab-btn');
    
    tabs.forEach(btn => btn.classList.remove('active'));
    
    if (tab === 'login') {
        loginTab.classList.remove('hide');
        registerTab.classList.add('hide');
        tabs[0].classList.add('active');
    } else {
        loginTab.classList.add('hide');
        registerTab.classList.remove('hide');
        tabs[1].classList.add('active');
    }
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const messageArea = document.getElementById('messageArea');
    
    if (!username || !password) {
        showMessage('Please enter username and password', 'error', messageArea);
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage(data.message, 'success', messageArea);
            setTimeout(() => location.reload(), 1000);
        } else {
            showMessage(data.message, 'error', messageArea);
        }
    } catch (error) {
        showMessage('Connection error', 'error', messageArea);
    }
}

async function handleRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const password = document.getElementById('regPassword').value;
    const messageArea = document.getElementById('messageArea');
    
    if (!username || !phone || !password) {
        showMessage('All fields are required', 'error', messageArea);
        return;
    }
    
    if (password.length < 6) {
        showMessage('Password must be at least 6 characters', 'error', messageArea);
        return;
    }
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, phone, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage(data.message, 'success', messageArea);
            setTimeout(() => switchTab('login'), 1500);
        } else {
            showMessage(data.message, 'error', messageArea);
        }
    } catch (error) {
        showMessage('Registration failed', 'error', messageArea);
    }
}

function showMessage(msg, type, element) {
    element.innerHTML = `<div class="${type}-message">${msg}</div>`;
    setTimeout(() => {
        if (element.innerHTML.includes(msg)) {
            element.innerHTML = '';
        }
    }, 3000);
}

// ============================================
// GAME UI
// ============================================
function showGameInterface() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="game-container">
            <header class="game-header">
                <div class="logo">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M3 12L21 3L15 12L21 21L3 12Z" fill="#FFB347" stroke="#FFEA80" stroke-width="1.2"/>
                        <circle cx="12" cy="12" r="2" fill="#FF8C00"/>
                    </svg>
                    <span>AVIATOR</span>
                </div>
                <div class="balance-display">
                    <span class="label">BALANCE</span>
                    <span class="amount" id="balanceAmount">${userBalance.toFixed(2)}</span>
                    <span class="label">KES</span>
                </div>
                <div class="header-actions">
                    <button class="icon-btn logout-btn" onclick="handleLogout()" title="Logout">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                            <polyline points="16 17 21 12 16 7"/>
                            <line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                    </button>
                </div>
            </header>
            
            <div class="main-content">
                <div class="game-area">
                    <div class="canvas-container">
                        <canvas id="gameCanvas" width="800" height="400"></canvas>
                        <div class="game-overlay" id="gameOverlay">
                            <div id="multiplierDisplay" class="multiplier-display">1.00x</div>
                            <div id="countdownDisplay" class="countdown-display" style="display: none;"></div>
                            <div id="crashMessage" class="crash-message" style="display: none;">💥 CRASHED! 💥</div>
                        </div>
                    </div>
                    
                    <div class="game-info">
                        <div class="game-status" id="gameStatus">Waiting for players...</div>
                        <div class="history-items" id="historyItems"></div>
                    </div>
                    
                    <div class="bet-panel">
                        <div class="bet-header">
                            <span class="bet-title">PLACE YOUR BET</span>
                            <span class="bet-balance">Balance: ${userBalance.toFixed(2)} KES</span>
                        </div>
                        
                        <div class="bet-amount-control">
                            <input type="number" id="betAmount" value="100" step="10" min="10">
                            <div class="amount-adjust">
                                <button class="amount-btn" onclick="adjustBet(-100)">-100</button>
                                <button class="amount-btn" onclick="adjustBet(-10)">-10</button>
                                <button class="amount-btn" onclick="adjustBet(10)">+10</button>
                                <button class="amount-btn" onclick="adjustBet(100)">+100</button>
                            </div>
                        </div>
                        
                        <div class="quick-bets">
                            <div class="quick-bet" onclick="setBetAmount(50)">50 KES</div>
                            <div class="quick-bet" onclick="setBetAmount(100)">100 KES</div>
                            <div class="quick-bet" onclick="setBetAmount(500)">500 KES</div>
                            <div class="quick-bet" onclick="setBetAmount(1000)">1000 KES</div>
                        </div>
                        
                        <div class="auto-cashout">
                            <label>Auto Cashout at</label>
                            <input type="number" id="autoCashout" value="2.0" step="0.5" min="1.1" disabled>
                            <div class="toggle-switch" id="autoToggle" onclick="toggleAutoCashout()"></div>
                        </div>
                        
                        <div class="bet-actions">
                            <button class="btn-bet" id="betBtn" onclick="placeBet()">✈️ PLACE BET</button>
                            <button class="btn-cashout" id="cashoutBtn" onclick="cashout()" disabled>💰 CASH OUT</button>
                        </div>
                        
                        <div class="active-bets" id="activeBets"></div>
                    </div>
                </div>
                
                <div class="sidebar">
                    <div class="bet-history">
                        <div class="history-header">MY BET HISTORY</div>
                        <div class="history-list" id="betHistoryList">
                            <div style="text-align: center; color: #666;">Loading...</div>
                        </div>
                    </div>
                    
                    <div class="leaderboard">
                        <div class="leaderboard-header">TOP WINNERS</div>
                        <div class="leaderboard-list" id="leaderboardList">
                            <div style="text-align: center; color: #666;">Loading...</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="toast-container" id="toastContainer"></div>
    `;
    
    setupCanvas();
    loadBetHistory();
    startGamePolling();
}

function updateBalanceDisplay() {
    const balanceSpan = document.getElementById('balanceAmount');
    if (balanceSpan) {
        balanceSpan.textContent = userBalance.toFixed(2);
    }
}

function adjustBet(amount) {
    const input = document.getElementById('betAmount');
    let newValue = parseFloat(input.value) + amount;
    newValue = Math.max(10, Math.min(newValue, userBalance));
    input.value = Math.floor(newValue);
}

function setBetAmount(amount) {
    const input = document.getElementById('betAmount');
    input.value = Math.min(amount, userBalance);
}

function toggleAutoCashout() {
    const toggle = document.getElementById('autoToggle');
    const input = document.getElementById('autoCashout');
    const isActive = toggle.classList.contains('active');
    
    if (isActive) {
        toggle.classList.remove('active');
        input.disabled = true;
    } else {
        toggle.classList.add('active');
        input.disabled = false;
    }
}

// ============================================
// CANVAS ANIMATION - THE FLIGHT MECHANICS
// ============================================
function setupCanvas() {
    canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    
    ctx = canvas.getContext('2d');
    canvasWidth = canvas.clientWidth;
    canvasHeight = canvas.clientHeight;
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    // Initialize plane position
    planeX = 50;
    planeY = canvasHeight - 100;
    
    startAnimation();
}

function startAnimation() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    function animate() {
        drawBackground();
        drawPlane();
        drawParticles();
        
        animationFrameId = requestAnimationFrame(animate);
    }
    
    animate();
}

function drawBackground() {
    // Sky gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, '#0a0f1e');
    gradient.addColorStop(1, '#0c1222');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(100 + i * 150, 50 + (i % 2) * 30, 40, 25, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Ground line
    ctx.beginPath();
    ctx.moveTo(0, canvasHeight - 50);
    ctx.lineTo(canvasWidth, canvasHeight - 50);
    ctx.strokeStyle = 'rgba(255, 140, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawPlane() {
    // Update plane position based on game state
    if (gameState.status === 'flying') {
        // Plane flies upward and right as multiplier increases
        const progress = Math.min((gameState.multiplier - 1) / 20, 0.8);
        planeX = 50 + progress * (canvasWidth - 100);
        planeY = canvasHeight - 100 - progress * (canvasHeight - 150);
        planeAngle = -progress * 30;
    } else if (gameState.status === 'crashed' && !explosionActive) {
        explosionActive = true;
        createExplosion(planeX, planeY);
    } else if (gameState.status === 'waiting') {
        // Reset plane position
        planeX = 50;
        planeY = canvasHeight - 100;
        planeAngle = 0;
        explosionActive = false;
        particles = [];
    }
    
    // Draw plane
    ctx.save();
    ctx.translate(planeX, planeY);
    ctx.rotate(planeAngle * Math.PI / 180);
    
    // Plane body
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-15, -8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-15, 8);
    ctx.closePath();
    ctx.fillStyle = '#ff8c00';
    ctx.fill();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Wing
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-20, -12);
    ctx.lineTo(-12, -12);
    ctx.fillStyle = '#e67e22';
    ctx.fill();
    
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-20, 12);
    ctx.lineTo(-12, 12);
    ctx.fill();
    
    // Cockpit
    ctx.beginPath();
    ctx.arc(15, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#87CEEB';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(13, -2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Trail
    ctx.beginPath();
    ctx.moveTo(-15, -5);
    ctx.lineTo(-30, -10);
    ctx.lineTo(-25, 0);
    ctx.lineTo(-30, 10);
    ctx.lineTo(-15, 5);
    ctx.fillStyle = 'rgba(255, 140, 0, 0.5)';
    ctx.fill();
    
    ctx.restore();
}

function createExplosion(x, y) {
    for (let i = 0; i < 30; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 1,
            size: 3 + Math.random() * 5
        });
    }
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        
        ctx.fillStyle = `rgba(255, ${100 + Math.random() * 155}, 0, ${p.life})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    }
}

function updateMultiplierDisplay() {
    const display = document.getElementById('multiplierDisplay');
    if (display) {
        display.textContent = `${gameState.multiplier.toFixed(2)}x`;
        
        // Color based on multiplier
        if (gameState.multiplier >= 10) {
            display.style.color = '#ff6b6b';
            display.style.textShadow = '0 0 40px rgba(255, 107, 107, 0.8)';
        } else if (gameState.multiplier >= 5) {
            display.style.color = '#ffb347';
            display.style.textShadow = '0 0 30px rgba(255, 179, 71, 0.8)';
        } else {
            display.style.color = '#ff8c00';
            display.style.textShadow = '0 0 20px rgba(255, 140, 0, 0.8)';
        }
    }
}

// ============================================
// GAME POLLING - GET UNIFORM STATE FROM SERVER
// ============================================
function startGamePolling() {
    if (gamePollInterval) clearInterval(gamePollInterval);
    
    gamePollInterval = setInterval(async () => {
        await fetchGameState();
        await fetchActiveBets();
    }, 200);
}

async function fetchGameState() {
    try {
        const response = await fetch('/api/game/state');
        const data = await response.json();
        
        const previousStatus = gameState.status;
        gameState = data;
        
        updateMultiplierDisplay();
        updateGameUI(previousStatus);
        
    } catch (error) {
        console.error('Failed to fetch game state:', error);
    }
}

function updateGameUI(previousStatus) {
    const statusSpan = document.getElementById('gameStatus');
    const countdownDiv = document.getElementById('countdownDisplay');
    const multiplierDiv = document.getElementById('multiplierDisplay');
    const crashMessage = document.getElementById('crashMessage');
    const betBtn = document.getElementById('betBtn');
    const cashoutBtn = document.getElementById('cashoutBtn');
    
    if (!statusSpan) return;
    
    switch (gameState.status) {
        case 'waiting':
            statusSpan.textContent = '⏳ Waiting for next round...';
            statusSpan.className = 'game-status waiting';
            countdownDiv.style.display = 'none';
            multiplierDiv.style.display = 'block';
            crashMessage.style.display = 'none';
            if (betBtn) betBtn.disabled = false;
            if (cashoutBtn) cashoutBtn.disabled = true;
            break;
            
        case 'starting':
            statusSpan.textContent = `🚀 Round starting in ${gameState.countdown}s...`;
            statusSpan.className = 'game-status starting';
            countdownDiv.style.display = 'block';
            countdownDiv.textContent = gameState.countdown;
            multiplierDiv.style.display = 'none';
            crashMessage.style.display = 'none';
            if (betBtn) betBtn.disabled = true;
            break;
            
        case 'flying':
            statusSpan.textContent = `✈️ Flying! Multiplier: ${gameState.multiplier.toFixed(2)}x`;
            statusSpan.className = 'game-status flying';
            countdownDiv.style.display = 'none';
            multiplierDiv.style.display = 'block';
            crashMessage.style.display = 'none';
            if (betBtn) betBtn.disabled = true;
            if (cashoutBtn && activeBet) cashoutBtn.disabled = false;
            break;
            
        case 'crashed':
            statusSpan.textContent = `💥 Crashed at ${gameState.multiplier.toFixed(2)}x!`;
            statusSpan.className = 'game-status crashed';
            countdownDiv.style.display = 'none';
            multiplierDiv.style.display = 'block';
            crashMessage.style.display = 'block';
            if (cashoutBtn) cashoutBtn.disabled = true;
            
            // Auto cashout check
            if (activeBet && activeBet.autoCashout && gameState.multiplier >= activeBet.autoCashout) {
                cashout();
            }
            break;
    }
}

async function fetchActiveBets() {
    try {
        const response = await fetch('/api/game/bets');
        const data = await response.json();
        
        const container = document.getElementById('activeBets');
        if (container) {
            if (data.bets.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No active bets</div>';
            } else {
                container.innerHTML = data.bets.map(bet => `
                    <div class="bet-item">
                        <span class="bet-user">${bet.username}</span>
                        <span class="bet-amount">${bet.amount.toFixed(2)} KES</span>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Failed to fetch active bets:', error);
    }
}

// ============================================
// BETTING ACTIONS
// ============================================
async function placeBet() {
    const amount = parseFloat(document.getElementById('betAmount').value);
    const autoToggle = document.getElementById('autoToggle');
    const autoCashout = autoToggle.classList.contains('active') ? 
        parseFloat(document.getElementById('autoCashout').value) : null;
    
    if (isNaN(amount) || amount < 10) {
        showToast('Minimum bet is 10 KES', 'error');
        return;
    }
    
    if (amount > userBalance) {
        showToast('Insufficient balance', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/bet/place', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, auto_cashout: autoCashout })
        });
        
        const data = await response.json();
        
        if (data.success) {
            activeBet = {
                betId: data.bet_id,
                amount: amount,
                autoCashout: autoCashout
            };
            userBalance = data.new_balance;
            updateBalanceDisplay();
            showToast(data.message, 'success');
            
            const cashoutBtn = document.getElementById('cashoutBtn');
            if (cashoutBtn && gameState.status === 'flying') {
                cashoutBtn.disabled = false;
            }
        } else {
            showToast(data.message, 'error');
        }
    } catch (error) {
        showToast('Failed to place bet', 'error');
    }
}

async function cashout() {
    if (!activeBet) {
        showToast('No active bet to cash out', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/bet/cashout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bet_id: activeBet.betId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            userBalance = data.new_balance;
            updateBalanceDisplay();
            showToast(data.message, 'success');
            activeBet = null;
            
            const cashoutBtn = document.getElementById('cashoutBtn');
            if (cashoutBtn) cashoutBtn.disabled = true;
            
            loadBetHistory();
        } else {
            showToast(data.message, 'error');
        }
    } catch (error) {
        showToast('Cashout failed', 'error');
    }
}

async function loadBetHistory() {
    try {
        const response = await fetch('/api/user/bets');
        const data = await response.json();
        
        const container = document.getElementById('betHistoryList');
        if (container) {
            if (data.bets.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #666;">No bets yet</div>';
            } else {
                container.innerHTML = data.bets.slice(0, 20).map(bet => `
                    <div class="history-entry">
                        <span class="history-bet">${bet.amount.toFixed(2)} KES</span>
                        ${bet.status === 'won' ? 
                            `<span class="history-win">+${bet.win_amount.toFixed(2)} KES</span>` :
                            `<span class="history-loss">LOST</span>`
                        }
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Failed to load bet history:', error);
    }
}

function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        location.reload();
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

// ============================================
// EXPORT FUNCTIONS FOR GLOBAL ACCESS
// ============================================
window.switchTab = switchTab;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.adjustBet = adjustBet;
window.setBetAmount = setBetAmount;
window.toggleAutoCashout = toggleAutoCashout;
window.placeBet = placeBet;
window.cashout = cashout;
window.handleLogout = handleLogout;
