import os

from flask import Blueprint, current_app, jsonify, request

from services.diff_service import build_diff_payload
from services.file_service import (
    allowed_file,
    build_filepath,
    list_markdown_files,
    read_file_content,
    remove_file,
    rename_file,
    sanitize_filename,
    save_uploaded_file,
    write_file_content,
)
from services.markdown_service import render_markdown

api_bp = Blueprint('api', __name__)


@api_bp.route('/api/files', methods=['GET'])
def get_files():
    """Get list of all markdown files in the upload directory."""
    upload_folder = current_app.config['UPLOAD_FOLDER']
    files = list_markdown_files(upload_folder)
    return jsonify(files)


@api_bp.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload .md file with duplicate handling.
    
    Returns 409 if file exists and no new filename provided.
    Returns 400 if file format is invalid or file is missing.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400

    allowed_extensions = current_app.config['ALLOWED_EXTENSIONS']
    if file and allowed_file(file.filename, allowed_extensions):
        filename = sanitize_filename(file.filename)

        # Check if client provided alternative filename (for duplicate handling)
        new_filename_from_request = request.form.get('newFilename')
        if new_filename_from_request:
            filename = sanitize_filename(new_filename_from_request)

        upload_folder = current_app.config['UPLOAD_FOLDER']
        filepath = build_filepath(upload_folder, filename)

        # Return conflict if file exists and no alternative name provided
        if os.path.exists(filepath) and not new_filename_from_request:
            return jsonify({'error': 'file_exists', 'filename': filename}), 409

        save_uploaded_file(file, filepath)
        return jsonify({'message': 'Файл успешно загружен', 'filename': filename}), 200

    return jsonify({'error': 'Недопустимый формат файла. Разрешены только .md файлы'}), 400


@api_bp.route('/api/file/<filename>', methods=['GET', 'POST'])
def file_content(filename):
    """Get or update file content.
    
    GET: Returns raw markdown content and rendered HTML.
    POST: Updates file content with provided text.
    """
    safe_name = sanitize_filename(filename)
    upload_folder = current_app.config['UPLOAD_FOLDER']
    filepath = build_filepath(upload_folder, safe_name)

    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404

    if request.method == 'POST':
        # Update file content
        data = request.get_json() or {}
        content = data.get('content')

        if content is None:
            return jsonify({'error': 'Содержимое не найдено'}), 400

        try:
            write_file_content(filepath, content)
            return jsonify({'message': 'Файл успешно сохранен'}), 200
        except Exception as exc:  # pragma: no cover - defensive
            return jsonify({'error': f'Ошибка при сохранении файла: {str(exc)}'}), 500

    # GET: Read and render file
    try:
        raw_content = read_file_content(filepath)
        html_content = render_markdown(raw_content)
        return jsonify({
            'raw_content': raw_content,
            'html_content': html_content,
            'filename': safe_name
        }), 200
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({'error': f'Ошибка при чтении файла: {str(exc)}'}), 500


@api_bp.route('/api/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    """Delete file."""
    safe_name = sanitize_filename(filename)
    upload_folder = current_app.config['UPLOAD_FOLDER']
    filepath = build_filepath(upload_folder, safe_name)

    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404

    try:
        remove_file(filepath)
        return jsonify({'message': 'Файл успешно удален'}), 200
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({'error': f'Ошибка при удалении файла: {str(exc)}'}), 500


@api_bp.route('/api/rename/<filename>', methods=['POST'])
def rename_file_route(filename):
    """Rename a markdown file.
    
    Returns 409 if target filename already exists.
    Returns 400 if new name is not provided or invalid.
    """
    safe_name = sanitize_filename(filename)
    upload_folder = current_app.config['UPLOAD_FOLDER']
    old_filepath = build_filepath(upload_folder, safe_name)

    if not os.path.exists(old_filepath):
        return jsonify({'error': 'Файл для переименования не найден'}), 404

    data = request.get_json() or {}
    new_name_raw = data.get('newName')
    new_name = sanitize_filename(new_name_raw or '')

    if not new_name:
        return jsonify({'error': 'Новое имя не указано'}), 400

    new_filepath = build_filepath(upload_folder, new_name)

    # Check if target filename already exists
    if os.path.exists(new_filepath):
        return jsonify({'error': f'Файл с именем "{new_name}" уже существует'}), 409

    try:
        rename_file(old_filepath, new_filepath)
        return jsonify({'message': 'Файл успешно переименован', 'newName': new_name}), 200
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({'error': f'Ошибка при переименовании файла: {str(exc)}'}), 500


@api_bp.route('/api/diff', methods=['GET'])
def diff_files():
    """Return diff view for two files (raw and rendered).
    
    Query parameters:
    - before: filename of the original file
    - after: filename of the modified file
    
    Returns diff payload with raw content, rendered HTML, and diff table.
    """
    before_name = request.args.get('before', '')
    after_name = request.args.get('after', '')

    before_name = sanitize_filename(before_name)
    after_name = sanitize_filename(after_name)

    # Validate after sanitization to catch inputs that collapse to empty names
    if not before_name or not after_name:
        return jsonify({'error': 'Не указаны оба файла для сравнения'}), 400

    upload_folder = current_app.config['UPLOAD_FOLDER']
    before_path = build_filepath(upload_folder, before_name)
    after_path = build_filepath(upload_folder, after_name)

    if not os.path.exists(before_path):
        return jsonify({'error': f'Файл "{before_name}" не найден'}), 404
    if not os.path.exists(after_path):
        return jsonify({'error': f'Файл "{after_name}" не найден'}), 404

    try:
        before_raw = read_file_content(before_path)
        after_raw = read_file_content(after_path)
        payload = build_diff_payload(
            before_raw, after_raw, before_name, after_name, render_markdown
        )
        return jsonify(payload), 200
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({'error': f'Ошибка при формировании diff: {str(exc)}'}), 500


@api_bp.route('/api/diff/preview', methods=['POST'])
def diff_preview():
    """Return diff for before/after content (used before save).
    
    Request body should contain:
    - before_content: original markdown text
    - after_content: modified markdown text
    - before_name: display name for original (optional)
    - after_name: display name for modified (optional)
    
    Used to show diff preview modal before saving changes.
    """
    data = request.get_json(silent=True) or {}
    before_raw = data.get('before_content', '')
    after_raw = data.get('after_content', '')
    before_name = data.get('before_name', 'before.md')
    after_name = data.get('after_name', 'after.md')

    try:
        payload = build_diff_payload(
            before_raw, after_raw, before_name, after_name, render_markdown
        )
        return jsonify(payload), 200
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({'error': f'Ошибка при формировании diff: {str(exc)}'}), 500

