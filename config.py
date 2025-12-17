import os


class Config:
    """Base application configuration."""

    # Upload directory for backend file operations (if needed in future)
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'uploads')
    
    # Maximum file size for uploads (128MB)
    MAX_CONTENT_LENGTH = 128 * 1024 * 1024
    # Allowed file extensions
    ALLOWED_EXTENSIONS = {'md'}

