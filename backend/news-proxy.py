from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

FACT_CHECK_API_KEY = os.getenv('FACT_CHECK_API_KEY')
REQUIRED_API_KEY = os.getenv('EXTENSION_API_KEY', 'default-secret-key')

if not FACT_CHECK_API_KEY:
    print("WARNING: FACT_CHECK_API_KEY not set in .env file")

@app.route('/factcheck', methods=['GET'])
def factcheck():
    # Verify extension API key
    auth_header = request.headers.get('X-API-Key')
    if auth_header != REQUIRED_API_KEY:
        return jsonify({'error': 'Unauthorized'}), 401
    
    # Get query parameter
    query = request.args.get('query', '')
    if not query:
        return jsonify({'error': 'Missing query parameter'}), 400
    
    # Forward to Google Fact Check API
    try:
        response = requests.get(
            'https://factchecktools.googleapis.com/v1alpha1/claims:search',
            params={
                'query': query,
                'key': FACT_CHECK_API_KEY
            },
            timeout=10
        )
        
        return jsonify(response.json()), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
