import os
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "a secret key"

@app.route('/')
def index():
    return render_template('chat.html')

@app.route('/api/send_message', methods=['POST'])
def send_message():
    data = request.get_json()
    message = data.get('message')
    mode = data.get('mode', 'general')

    # Simulate bot response (replace with actual chatbot logic)
    response = f"Echo: {message}" if mode == "general" else f"Expert: {message}"

    return jsonify({
        'response': response,
        'mode': mode
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)