import os
from flask import Flask, render_template

from config import Config
from routes.api import api_bp
from services.file_service import ensure_upload_dir


def create_app() -> Flask:
    """Application factory with modular route registration."""
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Get upload directory from config
    upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
    
    # Create directory if it doesn't exist
    # For existing directories, verify it's actually a directory
    if not os.path.exists(upload_folder):
        ensure_upload_dir(upload_folder)
    elif not os.path.isdir(upload_folder):
        raise ValueError(f"Specified path '{upload_folder}' is not a directory")

    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return render_template('index.html')

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

