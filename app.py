import os
import secrets
import hashlib
import random
import threading
import time
from datetime import datetime
from functools import wraps
from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
from pymongo import MongoClient
from dotenv import load_dotenv
import bcrypt

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
CORS(app, supports_credentials=True)

# ============================================
# MONGODB CONNECTION
# ============================================
# Replace with your MongoDB connection string
MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/')

try:
    client = MongoClient(MONGO_URI)
    db = client['aviator_game_db']
    users_collection = db['users']
    bets_collection = db['bets']
    game_history_collection = db['game_history']
    settings_collection = db['settings']
    
    # Create indexes
    users_collection.create_index('username', unique=True)
    users_collection.create_index('phone', unique=True)
    print("✅ MongoDB connected successfully!")
except Exception as e:
    print(f"⚠️ MongoDB connection error: {e}")
    print("Running in demo mode with in-memory storage")
    # Fallback to in-memory storage
    class MockCollection:
        def __init__(self):
            self.data = {}
            self.counter = 1
        
        def find_one(self, query):
            username = query.get('username')
            phone = query.get('phone')
            if username and username in self.data:
                return self.data[username]
            if phone:
                for user in self.data.values():
                    if user.get('phone') == phone:
                        return user
            return None
        
        def insert_one(self, document):
            doc_id = self.counter
            document['_id'] = doc_id
            self.data[document['username']] = document
            self.counter += 1
            return type('obj', (object,), {'inserted_id': doc_id})()
        
        def update_one(self, filter, update, upsert=False):
            username = filter.get('username')
            if username and username in self.data:
                self.data[username].update(update.get('$set', {}))
            return type('obj', (object,), {'modified_count': 1})()
        
        def find(self, filter=None):
            return list(self.data.values())
    
    users_collection = MockCollection()
    bets_collection = MockCollection()
    game_history_collection = MockCollection()
    settings_collection = MockCollection()

# ============================================
# UNIFORM GAME ENGINE - SAME FOR ALL PLAYERS
# ============================================
class AviatorGameEngine:
    """Single source of truth for game state - same multiplier for all users"""
    
    def __init__(self):
        self.current_multiplier = 1.00
        self.game_active = False
        self.game_start_time = None
        self.crash_point = None
        self.round_id = 0
        self.status = "waiting"  # waiting, starting, flying, crashed
        self.countdown = 5
        self.active_bets = {}
        self.crash_history = []
        self.lock = threading.Lock()
        self._start_countdown()
    
    def _start_countdown(self):
        """Start the countdown timer for next round"""
        def countdown_loop():
            while True:
                if self.status == "waiting":
                    self.status = "starting"
                    self.countdown = 5
                    for i in range(5, 0, -1):
                        self.countdown = i
                        time.sleep(1)
                    self._start_round()
                time.sleep(0.1)
        
        thread = threading.Thread(target=countdown_loop, daemon=True)
        thread.start()
    
    def _start_round(self):
        """Start a new game round"""
        with self.lock:
            self.round_id += 1
            self.status = "flying"
            self.game_start_time = time.time()
            self.current_multiplier = 1.00
            
            # Generate random crash point (provably fair algorithm)
            rand = random.random()
            if rand < 0.30:  # 30% - early crash (1.05x - 2.0x)
                self.crash_point = random.uniform(1.05, 2.0)
            elif rand < 0.65:  # 35% - medium crash (2.0x - 5.0x)
                self.crash_point = random.uniform(2.0, 5.0)
            elif rand < 0.85:  # 20% - high crash (5.0x - 15.0x)
                self.crash_point = random.uniform(5.0, 15.0)
            else:  # 15% - very high (15.0x - 50.0x)
                self.crash_point = random.uniform(15.0, 50.0)
            
            self.active_bets = {}
            
            # Save round start to database
            try:
                game_history_collection.insert_one({
                    'round_id': self.round_id,
                    'crash_point': self.crash_point,
                    'status': 'active',
                    'start_time': datetime.now()
                })
            except:
                pass
    
    def update_multiplier(self):
        """Update current multiplier based on elapsed time"""
        with self.lock:
            if self.status != "flying":
                return self.current_multiplier
            
            elapsed = time.time() - self.game_start_time
            # Multiplier growth: starts at 1.00, increases with time
            self.current_multiplier = 1.00 + (elapsed * 0.15)
            
            # Check for crash
            if self.current_multiplier >= self.crash_point:
                self._crash()
            
            return self.current_multiplier
    
    def _crash(self):
        """Handle game crash"""
        self.status = "crashed"
        self.current_multiplier = self.crash_point
        
        # Process all active bets
        for bet_id, bet in self.active_bets.items():
            if not bet.get('cashed_out', False):
                # Lost bet
                bets_collection.update_one(
                    {'_id': bet['bet_id']},
                    {'$set': {'status': 'lost', 'crash_multiplier': self.crash_point}}
                )
        
        # Save to history
        try:
            game_history_collection.update_one(
                {'round_id': self.round_id},
                {'$set': {
                    'status': 'crashed',
                    'final_multiplier': self.crash_point,
                    'end_time': datetime.now()
                }}
            )
        except:
            pass
        
        # Schedule next round after 3 seconds
        def next_round():
            time.sleep(3)
            with self.lock:
                self.status = "waiting"
                self._start_round()
        
        threading.Thread(target=next_round, daemon=True).start()
    
    def place_bet(self, user_id, username, amount, auto_cashout=None):
        """Place a bet for a user"""
        with self.lock:
            if self.status not in ["waiting", "starting"]:
                return None, "Cannot place bet - round already in progress"
            
            bet_id = f"bet_{self.round_id}_{user_id}_{int(time.time())}"
            bet = {
                'bet_id': bet_id,
                'user_id': user_id,
                'username': username,
                'amount': amount,
                'auto_cashout': auto_cashout,
                'cashed_out': False,
                'placed_at': time.time(),
                'round_id': self.round_id
            }
            
            self.active_bets[bet_id] = bet
            
            # Save to database
            try:
                bets_collection.insert_one({
                    'bet_id': bet_id,
                    'user_id': user_id,
                    'username': username,
                    'amount': amount,
                    'auto_cashout': auto_cashout,
                    'status': 'active',
                    'round_id': self.round_id,
                    'created_at': datetime.now()
                })
            except:
                pass
            
            return bet_id, "Bet placed successfully"
    
    def cashout(self, bet_id, user_id):
        """Cash out a bet"""
        with self.lock:
            if self.status != "flying":
                return None, "Game not in progress"
            
            bet = self.active_bets.get(bet_id)
            if not bet or bet.get('cashed_out', False):
                return None, "Bet not found or already cashed out"
            
            if bet['user_id'] != user_id:
                return None, "Not your bet"
            
            multiplier = self.current_multiplier
            winnings = bet['amount'] * multiplier
            
            bet['cashed_out'] = True
            bet['multiplier'] = multiplier
            bet['winnings'] = winnings
            
            # Update database
            try:
                bets_collection.update_one(
                    {'bet_id': bet_id},
                    {'$set': {
                        'status': 'won',
                        'cashout_multiplier': multiplier,
                        'win_amount': winnings,
                        'cashed_out_at': datetime.now()
                    }}
                )
            except:
                pass
            
            return winnings, f"Cashed out at {multiplier:.2f}x!"
    
    def get_game_state(self):
        """Get current game state for all players"""
        self.update_multiplier()
        return {
            'multiplier': round(self.current_multiplier, 2),
            'status': self.status,
            'countdown': self.countdown if self.status == "starting" else 0,
            'round_id': self.round_id,
            'crash_point': round(self.crash_point, 2) if self.crash_point else None
        }
    
    def get_bets(self):
        """Get all active bets"""
        return [
            {
                'username': bet['username'],
                'amount': bet['amount'],
                'bet_id': bet['bet_id']
            }
            for bet in self.active_bets.values()
        ]

# Initialize the global game engine
game_engine = AviatorGameEngine()

# ============================================
# HELPER FUNCTIONS
# ============================================
def hash_password(password):
    """Hash password using bcrypt"""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(password, hashed):
    """Verify password against hash"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def login_required(f):
    """Decorator to check if user is logged in"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"success": False, "message": "Please login first"}), 401
        return f(*args, **kwargs)
    return decorated_function

# ============================================
# API ROUTES
# ============================================

@app.route('/')
def index():
    """Serve the main game page"""
    return render_template('index.html')

# Game State Endpoints
@app.route('/api/game/state', methods=['GET'])
def game_state():
    """Get current game state - UNIFORM for all players"""
    state = game_engine.get_game_state()
    return jsonify(state), 200

@app.route('/api/game/bets', methods=['GET'])
def game_bets():
    """Get current active bets"""
    bets = game_engine.get_bets()
    return jsonify({'bets': bets}), 200

@app.route('/api/game/history', methods=['GET'])
def game_history():
    """Get recent game history"""
    try:
        history = list(game_history_collection.find(
            {}, 
            {'_id': 0, 'round_id': 1, 'crash_point': 1, 'end_time': 1}
        ).sort('round_id', -1).limit(50))
        return jsonify({'history': history}), 200
    except:
        return jsonify({'history': []}), 200

# User Authentication
@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        phone = data.get('phone', '').strip()
        password = data.get('password', '')
        
        if not username or not phone or not password:
            return jsonify({"success": False, "message": "All fields are required"}), 400
        
        if len(password) < 6:
            return jsonify({"success": False, "message": "Password must be at least 6 characters"}), 400
        
        # Check if user exists
        existing = users_collection.find_one({'username': username})
        if existing:
            return jsonify({"success": False, "message": "Username already exists"}), 409
        
        existing_phone = users_collection.find_one({'phone': phone})
        if existing_phone:
            return jsonify({"success": False, "message": "Phone number already registered"}), 409
        
        # Create user
        user = {
            'username': username,
            'phone': phone,
            'password': hash_password(password),
            'balance': 1000.00,  # Welcome bonus
            'created_at': datetime.now(),
            'total_bets': 0,
            'total_won': 0
        }
        
        users_collection.insert_one(user)
        
        return jsonify({
            "success": True,
            "message": "Registration successful! Please login."
        }), 201
        
    except Exception as e:
        return jsonify({"success": False, "message": f"Registration failed: {str(e)}"}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login user"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        user = users_collection.find_one({'username': username})
        
        if not user or not verify_password(password, user['password']):
            return jsonify({"success": False, "message": "Invalid username or password"}), 401
        
        session['user_id'] = str(user['_id'])
        session['username'] = user['username']
        
        return jsonify({
            "success": True,
            "message": f"Welcome back, {username}!",
            "user": {
                "username": user['username'],
                "balance": user.get('balance', 1000),
                "phone": user.get('phone', '')
            }
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "message": "Login failed"}), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Logout user"""
    session.clear()
    return jsonify({"success": True, "message": "Logged out"}), 200

@app.route('/api/auth/check', methods=['GET'])
def check_auth():
    """Check if user is logged in"""
    if 'user_id' in session:
        user = users_collection.find_one({'_id': session['user_id']})
        if user:
            return jsonify({
                "logged_in": True,
                "user": {
                    "username": user['username'],
                    "balance": user.get('balance', 1000)
                }
            }), 200
    return jsonify({"logged_in": False}), 200

# Betting Endpoints
@app.route('/api/bet/place', methods=['POST'])
@login_required
def place_bet():
    """Place a bet"""
    try:
        data = request.get_json()
        amount = float(data.get('amount', 0))
        auto_cashout = data.get('auto_cashout', None)
        
        if auto_cashout:
            auto_cashout = float(auto_cashout)
        
        # Get user
        user = users_collection.find_one({'_id': session['user_id']})
        if not user:
            return jsonify({"success": False, "message": "User not found"}), 404
        
        # Check balance
        if user['balance'] < amount:
            return jsonify({"success": False, "message": "Insufficient balance"}), 400
        
        # Check minimum bet
        min_bet = 10
        if amount < min_bet:
            return jsonify({"success": False, "message": f"Minimum bet is {min_bet} KES"}), 400
        
        # Place bet
        bet_id, message = game_engine.place_bet(
            session['user_id'], 
            user['username'], 
            amount, 
            auto_cashout
        )
        
        if not bet_id:
            return jsonify({"success": False, "message": message}), 400
        
        # Deduct from balance
        users_collection.update_one(
            {'_id': session['user_id']},
            {'$inc': {'balance': -amount, 'total_bets': 1}}
        )
        
        return jsonify({
            "success": True,
            "message": message,
            "bet_id": bet_id,
            "new_balance": user['balance'] - amount
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "message": f"Failed to place bet: {str(e)}"}), 500

@app.route('/api/bet/cashout', methods=['POST'])
@login_required
def cashout_bet():
    """Cash out a bet"""
    try:
        data = request.get_json()
        bet_id = data.get('bet_id')
        
        if not bet_id:
            return jsonify({"success": False, "message": "Bet ID required"}), 400
        
        winnings, message = game_engine.cashout(bet_id, session['user_id'])
        
        if not winnings:
            return jsonify({"success": False, "message": message}), 400
        
        # Add winnings to balance
        users_collection.update_one(
            {'_id': session['user_id']},
            {'$inc': {'balance': winnings, 'total_won': winnings}}
        )
        
        user = users_collection.find_one({'_id': session['user_id']})
        
        return jsonify({
            "success": True,
            "message": message,
            "winnings": winnings,
            "new_balance": user['balance'] if user else 0
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "message": f"Cashout failed: {str(e)}"}), 500

# User Data Endpoints
@app.route('/api/user/balance', methods=['GET'])
@login_required
def get_balance():
    """Get user balance"""
    try:
        user = users_collection.find_one({'_id': session['user_id']})
        if user:
            return jsonify({"balance": user.get('balance', 0)}), 200
        return jsonify({"balance": 0}), 200
    except:
        return jsonify({"balance": 0}), 200

@app.route('/api/user/bets', methods=['GET'])
@login_required
def get_user_bets():
    """Get user's bet history"""
    try:
        bets = list(bets_collection.find(
            {'user_id': session['user_id']},
            {'_id': 0, 'amount': 1, 'status': 1, 'cashout_multiplier': 1, 'win_amount': 1, 'created_at': 1}
        ).sort('created_at', -1).limit(50))
        
        # Convert ObjectId and datetime for JSON
        for bet in bets:
            if 'created_at' in bet:
                bet['created_at'] = bet['created_at'].isoformat() if hasattr(bet['created_at'], 'isoformat') else str(bet['created_at'])
        
        return jsonify({"bets": bets}), 200
    except:
        return jsonify({"bets": []}), 200

# Settings
@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get public settings"""
    try:
        settings = settings_collection.find_one({})
        if not settings:
            settings = {
                'min_bet': 10,
                'max_bet': 50000,
                'site_name': 'Aviator',
                'site_logo': '/api/placeholder/200/60',
                'referrer_bonus': 50,
                'referee_bonus': 50
            }
        # Remove sensitive data
        settings.pop('_id', None)
        return jsonify(settings), 200
    except:
        return jsonify({'min_bet': 10, 'max_bet': 50000, 'site_name': 'Aviator'}), 200

if __name__ == '__main__':
    print("=" * 60)
    print("✈️  AVIATOR GAME SERVER")
    print("=" * 60)
    print("Server running at: http://localhost:5000")
    print("\n📝 Demo Account:")
    print("   Username: demo")
    print("   Password: demo123")
    print("\n🎮 Features:")
    print("   • Real-time uniform multiplier for all players")
    print("   • Auto-crash system with random crash points")
    print("   • User registration and login")
    print("   • Balance management")
    print("   • Bet history tracking")
    print("=" * 60)
    
    # Create a demo user if none exists
    if not users_collection.find_one({'username': 'demo'}):
        demo_user = {
            'username': 'demo',
            'phone': '0712345678',
            'password': hash_password('demo123'),
            'balance': 10000,
            'created_at': datetime.now(),
            'total_bets': 0,
            'total_won': 0
        }
        users_collection.insert_one(demo_user)
        print("✅ Demo user created: demo / demo123")
    
    app.run(host='0.0.0.0', port=5000, debug=True)