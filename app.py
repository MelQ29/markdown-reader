import os
from flask import Flask, render_template

from config import Config
from routes.api import api_bp
from services.file_service import ensure_upload_dir


def create_app() -> Flask:
    """Application factory with modular route registration."""
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Get working directory from config (WORK_DIR env var or default UPLOAD_FOLDER)
    work_dir = Config.get_work_directory()
    app.config['WORK_DIR'] = work_dir
    
    # Create directory if it doesn't exist
    # For existing directories, verify it's actually a directory
    if not os.path.exists(work_dir):
        ensure_upload_dir(work_dir)
    elif not os.path.isdir(work_dir):
        raise ValueError(f"Specified path '{work_dir}' is not a directory")

    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return render_template('index.html')

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

