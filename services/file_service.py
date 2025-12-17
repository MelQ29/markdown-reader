import os
from typing import Dict, List

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename


def ensure_upload_dir(upload_folder: str) -> None:
    """Create upload directory if it does not exist."""
    os.makedirs(upload_folder, exist_ok=True)


def sanitize_filename(filename: str, ensure_md: bool = True) -> str:
    """Sanitize filename and optionally enforce .md extension.
    
    Args:
        filename: Input filename to sanitize
        ensure_md: If True, ensures filename ends with .md extension
    
    Returns:
        Sanitized filename safe for filesystem use
    """
    target = filename
    # Add .md extension if missing and ensure_md is True
    if ensure_md and target and not target.lower().endswith('.md'):
        target += '.md'

    # Use werkzeug's secure_filename to sanitize path components
    cleaned = secure_filename(target)

    # Re-check extension after sanitization (may have been removed)
    if ensure_md and cleaned and not cleaned.lower().endswith('.md'):
        cleaned += '.md'

    return cleaned


def allowed_file(filename: str, allowed_extensions: set) -> bool:
    """Validate filename extension against allowed types."""
    return (
        '.' in filename
        and filename.rsplit('.', 1)[1].lower() in allowed_extensions
    )


def build_filepath(upload_folder: str, filename: str) -> str:
    """Build absolute path for file inside upload directory."""
    return os.path.join(upload_folder, filename)


def list_markdown_files(upload_folder: str) -> List[Dict[str, int]]:
    """Return list of markdown files with sizes.
    
    Args:
        upload_folder: Directory path to scan for .md files
    
    Returns:
        Sorted list of dictionaries with 'name' and 'size' keys
    """
    files: List[Dict[str, int]] = []
    if os.path.exists(upload_folder):
        for name in os.listdir(upload_folder):
            # Only include .md files
            if name.endswith('.md'):
                path = build_filepath(upload_folder, name)
                files.append({'name': name, 'size': os.path.getsize(path)})
    # Sort alphabetically by filename
    files.sort(key=lambda item: item['name'])
    return files


def save_uploaded_file(file: FileStorage, filepath: str) -> None:
    """Persist uploaded file."""
    file.save(filepath)


def read_file_content(filepath: str) -> str:
    """Read markdown file content."""
    with open(filepath, 'r', encoding='utf-8') as handler:
        return handler.read()


def write_file_content(filepath: str, content: str) -> None:
    """Write content to markdown file."""
    with open(filepath, 'w', encoding='utf-8') as handler:
        handler.write(content)


def remove_file(filepath: str) -> None:
    """Delete markdown file."""
    os.remove(filepath)


def rename_file(old_path: str, new_path: str) -> None:
    """Rename markdown file."""
    os.rename(old_path, new_path)

