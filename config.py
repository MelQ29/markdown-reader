import os


class Config:
    """Base application configuration."""

    # Working directory - if specified, used instead of UPLOAD_FOLDER
    # All operations (read, edit, save) are performed on files in this directory
    WORK_DIR = os.environ.get('WORK_DIR', None)
    
    # Upload directory (used only if WORK_DIR is not specified)
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'uploads')
    
    # Maximum file size for uploads (128MB)
    MAX_CONTENT_LENGTH = 128 * 1024 * 1024
    # Allowed file extensions
    ALLOWED_EXTENSIONS = {'md'}
    
    @staticmethod
    def get_work_directory():
        """Returns working directory (WORK_DIR or UPLOAD_FOLDER as fallback)."""
        work_dir = os.environ.get('WORK_DIR', None)
        if work_dir:
            return os.path.abspath(work_dir)
        upload_folder = os.environ.get('UPLOAD_FOLDER', 'uploads')
        return os.path.abspath(upload_folder)

