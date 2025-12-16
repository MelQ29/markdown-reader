from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import markdown
import difflib
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 128 * 1024 * 1024  # 128MB max file size

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'md'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def render_markdown(raw_content: str) -> str:
    """Render markdown to HTML with configured extensions."""
    return markdown.markdown(
        raw_content,
        extensions=['fenced_code', 'tables'],
        extension_configs={'fenced_code': {}}
    )

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/files', methods=['GET'])
def get_files():
    """Get list of all uploaded .md files."""
    files = []
    if os.path.exists(app.config['UPLOAD_FOLDER']):
        for filename in os.listdir(app.config['UPLOAD_FOLDER']):
            if filename.endswith('.md'):
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file_size = os.path.getsize(filepath)
                files.append({
                    'name': filename,
                    'size': file_size
                })
    # Sort by name for a stable list
    files.sort(key=lambda x: x['name'])
    return jsonify(files)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload .md file."""
    if 'file' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        
        # Check for rename request (duplicate handling)
        new_filename_from_request = request.form.get('newFilename')
        if new_filename_from_request:
            filename = secure_filename(new_filename_from_request)
            if not filename.lower().endswith('.md'):
                filename += '.md'

        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # If file exists and no rename requested, return conflict
        if os.path.exists(filepath) and not new_filename_from_request:
            return jsonify({'error': 'file_exists', 'filename': filename}), 409 # 409 Conflict

        file.save(filepath)
        return jsonify({'message': 'Файл успешно загружен', 'filename': filename}), 200
    
    return jsonify({'error': 'Недопустимый формат файла. Разрешены только .md файлы'}), 400

@app.route('/api/file/<filename>', methods=['GET', 'POST'])
def file_content(filename):
    """Get or update file content."""
    filename = secure_filename(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404

    if request.method == 'POST':
        # Update file
        data = request.get_json()
        content = data.get('content')

        if content is None:
            return jsonify({'error': 'Содержимое не найдено'}), 400

        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return jsonify({'message': 'Файл успешно сохранен'}), 200
        except Exception as e:
            return jsonify({'error': f'Ошибка при сохранении файла: {str(e)}'}), 500

    # GET request: read file content
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            raw_content = f.read()

        html_content = render_markdown(raw_content)

        return jsonify({
            'raw_content': raw_content,
            'html_content': html_content,
            'filename': filename
        }), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при чтении файла: {str(e)}'}), 500


@app.route('/api/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    """Delete file."""
    filename = secure_filename(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404
    
    try:
        os.remove(filepath)
        return jsonify({'message': 'Файл успешно удален'}), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при удалении файла: {str(e)}'}), 500

@app.route('/api/rename/<filename>', methods=['POST'])
def rename_file(filename):
    """Rename file."""
    filename = secure_filename(filename)
    old_filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    if not os.path.exists(old_filepath):
        return jsonify({'error': 'Файл для переименования не найден'}), 404

    data = request.get_json()
    new_name = data.get('newName')

    if not new_name:
        return jsonify({'error': 'Новое имя не указано'}), 400

    if not new_name.lower().endswith('.md'):
        new_name += '.md'

    new_name = secure_filename(new_name)
    new_filepath = os.path.join(app.config['UPLOAD_FOLDER'], new_name)

    if os.path.exists(new_filepath):
        return jsonify({'error': f'Файл с именем "{new_name}" уже существует'}), 409

    try:
        os.rename(old_filepath, new_filepath)
        return jsonify({'message': 'Файл успешно переименован', 'newName': new_name}), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при переименовании файла: {str(e)}'}), 500

@app.route('/api/diff', methods=['GET'])
def diff_files():
    """Return diff view for two files (raw and rendered)."""
    before_name = secure_filename(request.args.get('before', ''))
    after_name = secure_filename(request.args.get('after', ''))

    if not before_name or not after_name:
        return jsonify({'error': 'Не указаны оба файла для сравнения'}), 400

    if not before_name.lower().endswith('.md'):
        before_name += '.md'
    if not after_name.lower().endswith('.md'):
        after_name += '.md'

    before_path = os.path.join(app.config['UPLOAD_FOLDER'], before_name)
    after_path = os.path.join(app.config['UPLOAD_FOLDER'], after_name)

    if not os.path.exists(before_path):
        return jsonify({'error': f'Файл "{before_name}" не найден'}), 404
    if not os.path.exists(after_path):
        return jsonify({'error': f'Файл "{after_name}" не найден'}), 404

    try:
        with open(before_path, 'r', encoding='utf-8') as f:
            before_raw = f.read()
        with open(after_path, 'r', encoding='utf-8') as f:
            after_raw = f.read()

        before_html = render_markdown(before_raw)
        after_html = render_markdown(after_raw)

        diff_maker = difflib.HtmlDiff(wrapcolumn=120)
        raw_diff_html = diff_maker.make_table(
            before_raw.splitlines(),
            after_raw.splitlines(),
            fromdesc=before_name,
            todesc=after_name,
            context=True,
            numlines=3
        )

        return jsonify({
            'before': {
                'filename': before_name,
                'raw_content': before_raw,
                'html_content': before_html
            },
            'after': {
                'filename': after_name,
                'raw_content': after_raw,
                'html_content': after_html
            },
            'raw_diff_html': raw_diff_html
        }), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при формировании diff: {str(e)}'}), 500

@app.route('/api/diff/preview', methods=['POST'])
def diff_preview():
    """Return diff for before/after content (used before save)."""
    data = request.get_json(silent=True) or {}
    before_raw = data.get('before_content', '')
    after_raw = data.get('after_content', '')
    before_name = data.get('before_name', 'before.md')
    after_name = data.get('after_name', 'after.md')

    try:
        before_html = render_markdown(before_raw)
        after_html = render_markdown(after_raw)

        diff_maker = difflib.HtmlDiff(wrapcolumn=120)
        raw_diff_html = diff_maker.make_table(
            before_raw.splitlines(),
            after_raw.splitlines(),
            fromdesc=before_name,
            todesc=after_name,
            context=True,
            numlines=3
        )

        return jsonify({
            'before': {
                'filename': before_name,
                'raw_content': before_raw,
                'html_content': before_html
            },
            'after': {
                'filename': after_name,
                'raw_content': after_raw,
                'html_content': after_html
            },
            'raw_diff_html': raw_diff_html
        }), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при формировании diff: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

