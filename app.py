from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import markdown
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 128 * 1024 * 1024  # 128MB max file size

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'md'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/files', methods=['GET'])
def get_files():
    """Получить список всех загруженных .md файлов"""
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
    # Сортируем по имени
    files.sort(key=lambda x: x['name'])
    return jsonify(files)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Загрузить .md файл"""
    if 'file' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        
        # Проверяем, есть ли новое имя в запросе (для случая с дубликатом)
        new_filename_from_request = request.form.get('newFilename')
        if new_filename_from_request:
            filename = secure_filename(new_filename_from_request)
            if not filename.lower().endswith('.md'):
                filename += '.md'

        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # Если файл существует и не было запроса на переименование, возвращаем ошибку
        if os.path.exists(filepath) and not new_filename_from_request:
            return jsonify({'error': 'file_exists', 'filename': filename}), 409 # 409 Conflict

        file.save(filepath)
        return jsonify({'message': 'Файл успешно загружен', 'filename': filename}), 200
    
    return jsonify({'error': 'Недопустимый формат файла. Разрешены только .md файлы'}), 400

@app.route('/api/file/<filename>', methods=['GET', 'POST'])
def file_content(filename):
    """Получить или обновить содержимое файла"""
    filename = secure_filename(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404

    if request.method == 'POST':
        # Обновление файла
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

    # GET-запрос: получение содержимого
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            raw_content = f.read()
        
        html_content = markdown.markdown(
            raw_content,
            extensions=['fenced_code', 'tables'],
            extension_configs={'fenced_code': {}}
        )
        
        return jsonify({
            'raw_content': raw_content,
            'html_content': html_content,
            'filename': filename
        }), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при чтении файла: {str(e)}'}), 500


@app.route('/api/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    """Удалить файл"""
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
    """Переименовать файл"""
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


if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

