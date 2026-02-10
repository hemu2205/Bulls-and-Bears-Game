"""
Bulls & Bears — Main Application Entry Point
A professional-grade 5-letter word puzzle platform.
Run: python main.py
"""

from flask import Flask, request, jsonify, send_from_directory, session
import mysql.connector
import os
import random
import datetime
import json
from werkzeug.security import generate_password_hash, check_password_hash

# ─── App Configuration ───────────────────────────────────────────────
app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.getenv("SECRET_KEY", "bulls-bears-secret-2026-prod")

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", "root"),
    "database": os.getenv("DB_NAME", "Bulls_Bears_Game_Scores"),
    "port": int(os.getenv("DB_PORT", 3306)),
}

# ─── Word Bank ────────────────────────────────────────────────────────
WORD_BANK = [
    "APPLE","BEACH","BRAIN","BREAD","BRUSH","CHAIR","CHEST","CHORD","CLICK","CLOCK",
    "CLOUD","DANCE","DIARY","DRINK","DRIVE","EARTH","FEAST","FIELD","FRUIT","GLASS",
    "GRAIN","GRAPE","GREEN","GHOST","HEART","HOUSE","JUICE","LIGHT","LEMON","MELON",
    "MONEY","MUSIC","NIGHT","OCEAN","PARTY","PIZZA","PHONE","PHOTO","PIANO","PILOT",
    "PLANE","PLANT","PLATE","POWER","RADIO","RIVER","ROBOT","SHIRT","SHOES","SPACE",
    "SPOON","STORM","SUGAR","SWEET","TABLE","TIGER","TOAST","TOUCH","TOWER","TRACK",
    "TRADE","TRAIN","TREAT","TRUCK","TRUST","TRUTH","UNCLE","UNION","UNITY","VALUE",
    "VIDEO","VISIT","VOICE","WASTE","WATCH","WATER","WHALE","WHITE","WHOLE","WOMAN",
    "WORLD","WRITE","YOUTH","ZEBRA","AMBER","BADGE","BLANK","BLAZE","BLOOM","CARRY",
    "CHARM","CLIMB","CORAL","CRASH","CROWN","CURVE","DREAM","ELBOW","FLAME","FLASH",
    "FLOAT","FROST","GLOBE","GRILL","HAPPY","HAVEN","HONOR","IMAGE","IVORY","JOLLY",
    "KNEEL","LAUGH","MAPLE","MEDAL","NOBLE","OASIS","PEARL","QUEST","REIGN","RIDGE",
    "ROYAL","SCALE","SHADE","SHINE","SLOPE","SMART","SMILE","SOLAR","SPARK","SPELL",
    "SPINE","SPOKE","STAGE","STAIR","STAMP","STAND","STEEL","STERN","STONE","STOVE",
    "STYLE","SWAMP","SWING","THICK","THORN","THUMB","TRAIL","TREND","TRIAL","TULIP",
    "TWIST","URBAN","VALVE","VIGOR","VIVID","VOCAL","WEAVE","WHEAT","YIELD","YOUNG",
]

VALID_WORDS = set(w.upper() for w in WORD_BANK)

# ─── Database Helpers ─────────────────────────────────────────────────
def get_db():
    """Get a fresh database connection."""
    return mysql.connector.connect(**DB_CONFIG)


def init_database():
    """Auto-initialize database, tables, and seed words on startup."""
    try:
        # Create database if not exists
        conn = mysql.connector.connect(
            host=DB_CONFIG["host"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"],
            port=DB_CONFIG["port"],
        )
        cursor = conn.cursor()
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_CONFIG['database']}")
        conn.commit()
        cursor.close()
        conn.close()

        # Create tables
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                display_name VARCHAR(100) DEFAULT NULL,
                email VARCHAR(120) DEFAULT NULL,
                role VARCHAR(10) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS words (
                id INT AUTO_INCREMENT PRIMARY KEY,
                word VARCHAR(5) NOT NULL UNIQUE
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                score DECIMAL(10, 2) NOT NULL,
                attempts INT NOT NULL,
                result VARCHAR(10) NOT NULL,
                time_taken INT DEFAULT 0,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                game_id INT DEFAULT NULL,
                guess VARCHAR(5) NOT NULL,
                feedback VARCHAR(255) NOT NULL,
                attempt_number INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        conn.commit()

        # Migration: add columns if missing
        for col_sql in [
            "ALTER TABLE users ADD COLUMN display_name VARCHAR(100) DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN email VARCHAR(120) DEFAULT NULL",
            "ALTER TABLE scores ADD COLUMN time_taken INT DEFAULT 0",
            "ALTER TABLE scores MODIFY COLUMN score DECIMAL(10,2)",
        ]:
            try:
                cursor.execute(col_sql)
                conn.commit()
            except mysql.connector.Error:
                pass

        # Seed words
        cursor.execute("SELECT COUNT(*) FROM words")
        count = cursor.fetchone()[0]
        if count == 0:
            for word in WORD_BANK:
                try:
                    cursor.execute("INSERT IGNORE INTO words (word) VALUES (%s)", (word,))
                except Exception:
                    pass
            conn.commit()
            print(f"[INIT] Seeded {len(WORD_BANK)} words.")
        else:
            print(f"[INIT] Words table has {count} entries.")

        cursor.close()
        conn.close()
        print("[INIT] Database ready.")

    except mysql.connector.Error as err:
        print(f"[INIT ERROR] {err}")
        print("[INIT] App will start but DB operations may fail.")


# ─── Static Routes ────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(".", path)


# ─── Auth Endpoints ──────────────────────────────────────────────────
@app.route("/api/register", methods=["POST"])
def register():
    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or username).strip()
    email = (data.get("email") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters."}), 400

    role = "admin" if "admin" in username.lower() else "user"
    pw_hash = generate_password_hash(password)

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, display_name, email, role) VALUES (%s,%s,%s,%s,%s)",
            (username, pw_hash, display_name, email, role),
        )
        conn.commit()
        return jsonify({"message": "Account created successfully!", "role": role}), 201
    except mysql.connector.IntegrityError:
        return jsonify({"error": "Username already taken."}), 409
    except mysql.connector.Error as err:
        return jsonify({"error": str(err)}), 500
    finally:
        cursor.close()
        conn.close()


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Enter both username and password."}), 400

    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE username = %s", (username,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()

    if user and check_password_hash(user["password_hash"], password):
        session["user_id"] = user["id"]
        session["username"] = user["username"]
        session["role"] = user.get("role", "user")
        return jsonify({
            "message": "Login successful",
            "username": user["username"],
            "display_name": user.get("display_name") or user["username"],
            "email": user.get("email") or "",
            "role": session["role"],
        })

    return jsonify({"error": "Invalid username or password."}), 401


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})


@app.route("/api/me", methods=["GET"])
def me():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401

    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, username, display_name, email, role, created_at FROM users WHERE id = %s", (session["user_id"],))
    user = cursor.fetchone()
    cursor.close()
    conn.close()

    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401

    return jsonify({
        "username": user["username"],
        "display_name": user.get("display_name") or user["username"],
        "email": user.get("email") or "",
        "role": user.get("role", "user"),
        "member_since": str(user["created_at"]) if user.get("created_at") else "",
    })


# ─── Profile Endpoints ───────────────────────────────────────────────
@app.route("/api/profile", methods=["PUT"])
def update_profile():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401

    data = request.json or {}
    display_name = (data.get("display_name") or "").strip()
    email = (data.get("email") or "").strip()

    if not display_name:
        return jsonify({"error": "Display name is required."}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE users SET display_name=%s, email=%s WHERE id=%s",
            (display_name, email, session["user_id"]),
        )
        conn.commit()
        return jsonify({"message": "Profile updated successfully!"})
    except mysql.connector.Error as err:
        return jsonify({"error": str(err)}), 500
    finally:
        cursor.close()
        conn.close()


# ─── Game Endpoints ──────────────────────────────────────────────────
MAX_ATTEMPTS = 6
MAX_TIME = 240  # 4 minutes in seconds


@app.route("/api/start_game", methods=["POST"])
def start_game():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401

    # Pull a random word from the database
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT word FROM words ORDER BY RAND() LIMIT 1")
    result = cursor.fetchone()
    cursor.close()
    conn.close()

    if not result:
        # Fallback to in-memory word bank
        target = random.choice(WORD_BANK)
    else:
        target = result[0].upper()

    # Store a new game_id (using score record at game end)
    session["target_word"] = target
    session["start_time"] = datetime.datetime.now().timestamp()
    session["attempts"] = 0
    session["game_active"] = True

    return jsonify({"message": "Game started", "max_time": MAX_TIME, "max_attempts": MAX_ATTEMPTS})


@app.route("/api/guess", methods=["POST"])
def guess():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401
    if not session.get("game_active"):
        return jsonify({"error": "No active game. Start a new game first."}), 400

    data = request.json or {}
    guess_word = (data.get("guess") or "").upper().strip()
    target_word = session["target_word"]

    if len(guess_word) != 5 or not guess_word.isalpha():
        return jsonify({"error": "Guess must be exactly 5 letters."}), 400

    session["attempts"] += 1
    attempt_num = session["attempts"]

    # ── Bulls & Bears Feedback ──
    feedback = ["gray"] * 5
    target_chars = list(target_word)
    guess_chars = list(guess_word)

    # Pass 1: Exact matches (Bulls / Green)
    for i in range(5):
        if guess_chars[i] == target_chars[i]:
            feedback[i] = "green"
            target_chars[i] = None
            guess_chars[i] = None

    # Pass 2: Wrong position (Bears / Yellow)
    for i in range(5):
        if guess_chars[i] is not None and guess_chars[i] in target_chars:
            feedback[i] = "yellow"
            target_chars[target_chars.index(guess_chars[i])] = None

    # Log attempt
    user_id = session["user_id"]
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO attempts (user_id, guess, feedback, attempt_number) VALUES (%s,%s,%s,%s)",
            (user_id, guess_word, json.dumps(feedback), attempt_num),
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"[LOG ERROR] {e}")

    # ── Check game state ──
    elapsed = datetime.datetime.now().timestamp() - session["start_time"]
    game_over = False
    result_status = "PLAYING"
    score = 0.0

    if elapsed > MAX_TIME:
        game_over = True
        result_status = "LOSS"
    elif all(f == "green" for f in feedback):
        game_over = True
        result_status = "WIN"
        time_saved = max(0, MAX_TIME - elapsed)
        score = round(1.0 + time_saved * 0.1, 2)
    elif attempt_num >= MAX_ATTEMPTS:
        game_over = True
        result_status = "LOSS"

    if game_over:
        session["game_active"] = False
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO scores (user_id, score, attempts, result, time_taken) VALUES (%s,%s,%s,%s,%s)",
                (user_id, score, attempt_num, result_status, int(elapsed)),
            )
            conn.commit()
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[SCORE ERROR] {e}")

    return jsonify({
        "feedback": feedback,
        "game_over": game_over,
        "score": score,
        "attempts": attempt_num,
        "result": result_status,
        "correct_word": target_word if game_over else None,
        "time_taken": round(elapsed, 1),
    })


# ─── Leaderboard ─────────────────────────────────────────────────────
@app.route("/api/leaderboard", methods=["GET"])
def leaderboard():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT u.username,
               COALESCE(u.display_name, u.username) AS display_name,
               s.score, s.attempts, s.result, s.time_taken, s.played_at
        FROM scores s
        JOIN users u ON s.user_id = u.id
        WHERE s.result = 'WIN'
        ORDER BY s.score DESC, s.time_taken ASC
        LIMIT 20
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    # Serialize datetimes
    for r in rows:
        if r.get("played_at"):
            r["played_at"] = str(r["played_at"])
        if r.get("score"):
            r["score"] = float(r["score"])

    return jsonify(rows)


# ─── Player Stats ────────────────────────────────────────────────────
@app.route("/api/stats", methods=["GET"])
def player_stats():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401

    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    uid = session["user_id"]

    cursor.execute("SELECT COUNT(*) AS total FROM scores WHERE user_id = %s", (uid,))
    total = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(*) AS wins FROM scores WHERE user_id = %s AND result='WIN'", (uid,))
    wins = cursor.fetchone()["wins"]

    cursor.execute("SELECT MAX(score) AS best FROM scores WHERE user_id = %s AND result='WIN'", (uid,))
    best_row = cursor.fetchone()
    best = float(best_row["best"]) if best_row and best_row["best"] else 0

    cursor.close()
    conn.close()

    return jsonify({
        "total_games": total,
        "wins": wins,
        "losses": total - wins,
        "best_score": best,
        "win_rate": round((wins / total * 100), 1) if total > 0 else 0,
    })


# ─── Entry Point ─────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  Bulls & Bears — Word Puzzle Platform")
    print("=" * 50)
    init_database()
    app.run(debug=True, host="0.0.0.0", port=5000)
