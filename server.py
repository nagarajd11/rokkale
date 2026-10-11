import os
import json
import mimetypes
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOMS_FILE = os.path.join(BASE_DIR, 'rooms.json')

# Initialize rooms.json if it doesn't exist
DEFAULT_ROOM = {
    "id": "ROOM-9142",
    "name": "Apartment Friends Ledger",
    "category": "Shared Expenses",
    "members": [
        {"id": "m_rahul", "name": "Rahul", "upi": "rahul@okhdfcbank", "phone": "+91 98765 11111", "color": "#10b981"},
        {"id": "m_aryan", "name": "Aryan", "upi": "aryan@paytm", "phone": "+91 98765 22222", "color": "#3b82f6"},
        {"id": "m_vikram", "name": "Vikram", "upi": "vikram@upi", "phone": "+91 98765 33333", "color": "#8b5cf6"},
        {"id": "m_sneha", "name": "Sneha", "upi": "sneha@oksbi", "phone": "+91 98765 44444", "color": "#ec4899"}
    ],
    "transactions": [
        {
            "id": "tx_101",
            "lenderId": "m_rahul",
            "borrowerId": "m_aryan",
            "amount": 650,
            "description": "Swiggy Dinner Order 🍕",
            "status": "active",
            "createdAt": "2026-10-11T17:00:00.000Z",
            "settledAt": None,
            "settledBy": None,
            "method": "",
            "note": ""
        },
        {
            "id": "tx_102",
            "lenderId": "m_vikram",
            "borrowerId": "m_rahul",
            "amount": 400,
            "description": "Cab to Airport 🚗",
            "status": "awaiting_confirmation",
            "createdAt": "2026-10-11T19:00:00.000Z",
            "settledAt": None,
            "settledBy": None,
            "method": "UPI",
            "note": "Rahul reported payment sent via GPay"
        }
    ],
    "createdAt": "2026-10-11T16:00:00.000Z"
}

def load_rooms():
    if os.path.exists(ROOMS_FILE):
        try:
            with open(ROOMS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return [DEFAULT_ROOM]

def save_rooms(data):
    with open(ROOMS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# Make sure rooms.json exists initially
if not os.path.exists(ROOMS_FILE):
    save_rooms([DEFAULT_ROOM])

class RokkaLERequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS for cross-device mobile support
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # API: Get Rooms or single Room
        if path == '/api/rooms':
            rooms = load_rooms()
            room_id = params.get('id', [None])[0]
            if room_id:
                clean_id = room_id.strip().upper()
                found = next((r for r in rooms if r['id'] == clean_id), None)
                if found:
                    self.send_json(found)
                else:
                    self.send_json({"error": "Room not found"}, 404)
            else:
                self.send_json(rooms)
            return

        # Serve static files from BASE_DIR
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')
        try:
            payload = json.loads(post_data) if post_data else {}
        except Exception:
            payload = {}

        rooms = load_rooms()

        # API: Create or update room
        if path == '/api/rooms/save':
            room_id = payload.get('id')
            if not room_id:
                self.send_json({"error": "Missing room ID"}, 400)
                return

            idx = next((i for i, r in enumerate(rooms) if r['id'] == room_id), -1)
            if idx >= 0:
                rooms[idx] = payload
            else:
                rooms.append(payload)

            save_rooms(rooms)
            self.send_json({"success": True, "room": payload})
            return

        # API: Add member to room
        if path == '/api/rooms/add-member':
            room_id = payload.get('roomId')
            member = payload.get('member')
            found = next((r for r in rooms if r['id'] == room_id), None)
            if not found or not member:
                self.send_json({"error": "Invalid room or member"}, 400)
                return

            found['members'].append(member)
            save_rooms(rooms)
            self.send_json({"success": True, "room": found})
            return

        # API: Record transaction in room
        if path == '/api/rooms/transaction':
            room_id = payload.get('roomId')
            tx = payload.get('transaction')
            found = next((r for r in rooms if r['id'] == room_id), None)
            if not found or not tx:
                self.send_json({"error": "Invalid room or transaction"}, 400)
                return

            found['transactions'].insert(0, tx)
            save_rooms(rooms)
            self.send_json({"success": True, "room": found})
            return

        # API: Settle transaction
        if path == '/api/rooms/settle':
            room_id = payload.get('roomId')
            tx_id = payload.get('txId')
            settled_by = payload.get('settledBy')
            amount = payload.get('amount')
            method = payload.get('method', 'UPI')
            note = payload.get('note', '')

            found = next((r for r in rooms if r['id'] == room_id), None)
            if not found:
                self.send_json({"error": "Room not found"}, 404)
                return

            tx = next((t for t in found['transactions'] if t['id'] == tx_id), None)
            if not tx:
                self.send_json({"error": "Transaction not found"}, 404)
                return

            # Lender verification
            if tx['lenderId'] != settled_by:
                self.send_json({"error": "Only lender can settle this transaction"}, 403)
                return

            if amount < tx['amount']:
                remaining = tx['amount'] - amount
                tx['status'] = 'settled'
                tx['settledAt'] = payload.get('timestamp')
                tx['settledBy'] = settled_by
                tx['method'] = method
                tx['note'] = f"Partial settlement of ₹{amount}. {note}"

                # New remaining transaction
                new_tx = {
                    "id": f"tx_{int(amount)}_{tx_id}",
                    "lenderId": tx['lenderId'],
                    "borrowerId": tx['borrowerId'],
                    "amount": remaining,
                    "description": f"Remaining balance for {tx['description']}",
                    "status": "active",
                    "createdAt": payload.get('timestamp'),
                    "settledAt": None,
                    "settledBy": None,
                    "method": "",
                    "note": ""
                }
                found['transactions'].insert(0, new_tx)
            else:
                tx['status'] = 'settled'
                tx['settledAt'] = payload.get('timestamp')
                tx['settledBy'] = settled_by
                tx['method'] = method
                tx['note'] = note or f"Verified received via {method}"

            save_rooms(rooms)
            self.send_json({"success": True, "room": found})
            return

        # API: Notify lender that borrower paid
        if path == '/api/rooms/notify-paid':
            room_id = payload.get('roomId')
            tx_id = payload.get('txId')

            found = next((r for r in rooms if r['id'] == room_id), None)
            if not found:
                self.send_json({"error": "Room not found"}, 404)
                return

            tx = next((t for t in found['transactions'] if t['id'] == tx_id), None)
            if tx:
                tx['status'] = 'awaiting_confirmation'
                tx['note'] = 'Payment reported sent. Awaiting lender confirmation.'
                save_rooms(rooms)
                self.send_json({"success": True, "room": found})
            else:
                self.send_json({"error": "Transaction not found"}, 404)
            return

        # API: Delete transaction
        if path == '/api/rooms/delete-transaction':
            room_id = payload.get('roomId')
            tx_id = payload.get('txId')
            found = next((r for r in rooms if r['id'] == room_id), None)
            if not found or not tx_id:
                self.send_json({"error": "Invalid room or transaction"}, 400)
                return

            found['transactions'] = [t for t in found['transactions'] if t['id'] != tx_id]
            save_rooms(rooms)
            self.send_json({"success": True, "room": found})
            return

        # API: Join Room by Code & Name
        if path == '/api/rooms/join':
            room_id = (payload.get('roomId') or '').strip().upper()
            user_name = (payload.get('userName') or '').strip()
            upi_id = (payload.get('upi') or '').strip()

            found = next((r for r in rooms if r['id'] == room_id), None)
            if not found:
                self.send_json({"error": f"Room '{room_id}' not found. Please check code."}, 404)
                return

            # If user_name provided, match or add member
            matched_member = None
            if user_name:
                for m in found.get('members', []):
                    if m.get('name', '').lower() == user_name.lower():
                        matched_member = m
                        if upi_id and not m.get('upi'):
                            m['upi'] = upi_id
                        break

                if not matched_member:
                    colors = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4']
                    color = colors[len(found.get('members', [])) % len(colors)]
                    import time
                    new_id = f"m_{int(time.time() * 1000) % 100000}"
                    matched_member = {
                        "id": new_id,
                        "name": user_name,
                        "upi": upi_id,
                        "phone": "",
                        "color": color
                    }
                    found['members'].append(matched_member)

                save_rooms(rooms)

            self.send_json({
                "success": True,
                "room": found,
                "memberId": matched_member.get('id') if matched_member else None
            })
            return

        self.send_json({"error": "Unknown API route"}, 404)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

if __name__ == '__main__':
    os.chdir(BASE_DIR)
    server = HTTPServer(('0.0.0.0', PORT), RokkaLERequestHandler)
    print(f"RokkaLE Server running on http://0.0.0.0:{PORT}")
    server.serve_forever()
