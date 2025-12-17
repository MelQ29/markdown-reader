import os
from flask import Flask, render_template

from config import Config
from routes.api import api_bp
from services.file_service import ensure_upload_dir


def create_app() -> Flask:
    """Application factory with modular route registration."""
    app = Flask(__name__)
    app.config.from_object(Config)
    ensure_upload_dir(app.config['UPLOAD_FOLDER'])

    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return render_template('index.html')

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

