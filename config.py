import os


class Config:
    """Base application configuration."""

    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'uploads')
    MAX_CONTENT_LENGTH = 128 * 1024 * 1024  # 128MB max file size
    ALLOWED_EXTENSIONS = {'md'}

